import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The crontab, edited — the one place a scheduled line is added to this box or taken off it.
 *
 * The sync's reader (`schedules-cron-read.service.ts`) answers "what does the box schedule"; this
 * answers "put this line in" and "take that line out". The two share one parsing rule deliberately:
 * a line written here must read back through the reader as the SAME command, byte for byte, or the
 * registry would hold a row the next sync cannot match and its badges would flap.
 *
 * **`tabfile` is the seam that keeps a probe off the operator's box.** Every function here takes an
 * optional path and, when it is given, reads and writes THAT FILE instead of the `crontab` command —
 * for reads and writes alike, never one without the other. A door that honoured the flag for its read
 * and not its write would edit the real crontab from a probe.
 *
 * **The edit is surgical.** Nothing here rebuilds a table from a registry: a line whose command
 * does not match what was asked about is carried through untouched, comments and blanks and all. A
 * line nobody has tracked yet is exactly what the next sync ADOPTS, so a door that dropped it would
 * delete the operator's work in the name of tidying up.
 *
 * **One lock around the whole read-modify-write** — the shape `wire-hook` holds on `settings.json`,
 * so two doors that overlap cannot lose one of the two edits. wire-hook's lock comes from
 * `fcntl.flock`, which the kernel drops when its holder dies; Node has no flock, so this writes the
 * holder's pid into the sidecar and takes over one whose holder is gone.
 */

const CRONTAB_TIMEOUT_MS = 5_000;
const CRONTAB_MAX_BUFFER = 1024 * 1024;

/** A schedule is five fields, or one macro (`@reboot`, `@daily`) standing in for all five. */
const FIELDS_PER_SCHEDULE = 5;
const MACRO_FIELD = /^@[a-zA-Z]+$/;

/** Outside a `--tabfile`, a change to the live crontab takes the door's own sidecar, here. */
const LIVE_LOCK_PATH = path.join(os.homedir(), '.cloudcli', 'cron-door.lock');

/** How long a door waits for another door before giving up, and how often it looks again. */
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_POLL_MS = 50;

/** A sidecar that names no live pid is given this long before its torn write is read as abandoned. */
const TORN_SIDECAR_STALE_MS = 2_000;

/** The prefix every staging directory carries, so the cleanup below can prove which tree it removes. */
const SCRATCH_PREFIX = path.join(os.tmpdir(), 'cron-door-');

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A child's output as a string: `execFile` declares a `string | Buffer` union for this call. */
function readOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/**
 * A schedule or a command as the table holds it — and therefore as the registry hashes it: one line,
 * every run of whitespace collapsed to a single space, trimmed at both ends. The door needs it for
 * the row too: a row's id is the sha1 of its COMMAND, and the command the sync reads back off the box
 * is this spelling, so a row built from the operator's raw typing would hash to an id no sync ever
 * computes.
 */
export function normaliseField(text: string): string {
  return text.trim().split(/\s+/).join(' ');
}

/** A line this editor must not mistake for a job: blank, a comment, or a NAME=VALUE assignment. */
function isJobLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  return !/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed);
}

/** The command a table line runs, or null when the line carries no job at all. */
function commandOf(line: string): string | null {
  if (!isJobLine(line)) return null;

  const tokens = line.trim().split(/\s+/);
  const scheduleFields = MACRO_FIELD.test(tokens[0]) ? 1 : FIELDS_PER_SCHEDULE;
  if (tokens.length <= scheduleFields) return null;

  const command = tokens.slice(scheduleFields).join(' ');
  return command === '' ? null : command;
}

/** A table's text as its lines, without the trailing-newline sentinel, so appending is a push. */
function toLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Those lines back as text, every one of them newline-terminated: cron wants the final one. */
function toText(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * The table with one line for this command: its expression replaced in place when a line with that
 * EXACT command is already there, the line appended when it is not, and exactly one such line either
 * way — so running the same `add` twice leaves one line, not two. The contract's id hashes the
 * command, which is why one command is one line here and a second, differently scheduled line for
 * the same command is dropped rather than kept.
 *
 * The pure pair take the same optional `tabfile` as the rest of this file — one argument list the
 * door hands every primitive — and ignore it: string surgery has no file to choose between.
 */
export function upsertLine(text: string, expression: string, command: string, tabfile?: string): string {
  const wanted = normaliseField(command);
  const replacement = `${normaliseField(expression)} ${wanted}`;
  const kept: string[] = [];
  let written = false;

  for (const line of toLines(text)) {
    if (commandOf(line) !== wanted) {
      kept.push(line);
      continue;
    }

    // A duplicate of this very command — a door from before this rule, or a hand edit. One
    // survives and it is the one just written; the rest go, or the result is still two lines.
    if (written) continue;
    kept.push(replacement);
    written = true;
  }

  if (!written) kept.push(replacement);
  return toText(kept);
}

/** The table without every line whose command is this one, matched exactly. Everything else stays. */
export function removeLine(text: string, command: string): string {
  const wanted = normaliseField(command);
  return toText(toLines(text).filter((line) => commandOf(line) !== wanted));
}

/**
 * The table as it stands: the given file, or the live crontab through `crontab -l`.
 *
 * A table that does not exist is the empty string, never an error — which is what `crontab -l` means
 * by exiting 1 with `no crontab for <user>`. Every other failure is raised: a door that read an
 * unreadable crontab as empty would rewrite the table from nothing.
 */
export async function readTab(tabfile?: string): Promise<string> {
  if (tabfile !== undefined) {
    try {
      return await fs.readFile(tabfile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  try {
    const { stdout } = await execFileAsync('crontab', ['-l'], {
      timeout: CRONTAB_TIMEOUT_MS,
      maxBuffer: CRONTAB_MAX_BUFFER,
    });
    return readOutput(stdout);
  } catch (error) {
    if (isMissingCrontab(error)) return '';
    throw error;
  }
}

/** `crontab -l` on a user who has never installed one: exit 1, and that one sentence. */
function isMissingCrontab(error: unknown): boolean {
  // `execFile` puts the child's EXIT STATUS on `code` — a number — where Node's errno type declares a
  // string, so the field is read as what it actually holds rather than as what the type says.
  const failure = error as { code?: unknown; stderr?: unknown };
  const said = typeof failure.stderr === 'string' ? failure.stderr : '';
  return failure.code === 1 && /no crontab for/i.test(said);
}

/**
 * The table as this text, in the given file or installed as the live crontab.
 *
 * There is no file to write for the live one, only the `crontab` command's staging protocol, so the
 * text goes to a scratch directory and is handed over by path. The cleanup is guarded by the prefix
 * `mkdtemp` was given: a removal here must be provably of the tree this call made.
 */
export async function writeTab(text: string, tabfile?: string): Promise<void> {
  const body = text === '' || text.endsWith('\n') ? text : `${text}\n`;

  if (tabfile !== undefined) {
    await fs.writeFile(tabfile, body, 'utf8');
    return;
  }

  const staging = await fs.mkdtemp(SCRATCH_PREFIX);
  const staged = path.join(staging, 'crontab');

  try {
    await fs.writeFile(staged, body, 'utf8');
    await execFileAsync('crontab', [staged], {
      timeout: CRONTAB_TIMEOUT_MS,
      maxBuffer: CRONTAB_MAX_BUFFER,
    });
  } finally {
    if (staging.startsWith(SCRATCH_PREFIX)) {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}

/** Whether a pid belongs to a process that is still there — `EPERM` is another user's, and alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether the sidecar's holder is gone and the sidecar may be taken over. A pid the kernel still
 * knows is never taken from, however long it has held the lock; a sidecar naming no pid is a create
 * torn off mid-write, waited out for a moment so a door two instructions into its own is not
 * mistaken for a corpse.
 */
async function isAbandoned(lockPath: string): Promise<boolean> {
  const holder = await fs.readFile(lockPath, 'utf8').catch(() => null);
  if (holder === null) return true; // It went away while we looked: the next open attempt settles it.

  const pid = Number.parseInt(holder.trim(), 10);
  if (Number.isInteger(pid) && pid > 0) return !isProcessAlive(pid);

  const stat = await fs.stat(lockPath).catch(() => null);
  return stat !== null && Date.now() - stat.mtimeMs > TORN_SIDECAR_STALE_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Take the sidecar, waiting for a live holder and taking over one whose holder has died. */
async function acquireLock(lockPath: string): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    const handle = await fs
      .open(lockPath, 'wx')
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return null;
        throw error;
      });

    if (handle !== null) {
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      return;
    }

    if (Date.now() >= deadline) {
      // Another door holds it, or the sidecar cannot be removed; neither improves by waiting longer.
      throw new Error(`${lockPath} could not be taken in ${LOCK_TIMEOUT_MS} ms`);
    }

    // Judged here, removed immediately: a takeover can only drop a holder that is still gone. A
    // sidecar that will NOT come away — root-owned, or in a read-only directory — falls through to
    // the wait instead: retrying that unlink with no pause is a spin, not a lock.
    if (await isAbandoned(lockPath)) {
      const taken = await fs.unlink(lockPath).then(() => true, () => false);
      if (taken) continue;
    }

    await delay(LOCK_POLL_MS);
  }
}

/**
 * Run one read-modify-write with nobody else inside it: the sidecar beside the target file, or the
 * door's own for the live crontab. The whole change is held and released in a `finally`, so a throw
 * from the work still opens the door behind it; only a sidecar naming THIS process is removed.
 */
export async function withLock<T>(tabfile: string | null, fn: () => Promise<T>): Promise<T> {
  const lockPath = tabfile === null ? LIVE_LOCK_PATH : `${tabfile}.lock`;
  await acquireLock(lockPath);

  try {
    return await fn();
  } finally {
    const holder = await fs.readFile(lockPath, 'utf8').catch(() => null);
    if (holder !== null && Number.parseInt(holder.trim(), 10) === process.pid) {
      await fs.unlink(lockPath).catch((error: unknown) => {
        process.stderr.write(`cron door: could not release ${lockPath}: ${messageOf(error)}\n`);
      });
    }
  }
}
