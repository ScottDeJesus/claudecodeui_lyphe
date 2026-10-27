import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { userFacingEnv } from '@/shared/child-env.js';
import type { NormalizedMessage } from '@/shared/types.js';

import { groupTurns, renderTurn, type NumberedTurn } from './transcript-turns.js';

/**
 * How the companion reads anything longer than one turn: a chat's turns are rendered to a markdown file under her
 * scratch and a dactyl answers one fixed brief about it. The dactyl numbers the lines it is handed, so its `L<n>` is
 * a line of the file written here; its 16,000-byte budget and quote lines pass through untouched. What a turn is, and
 * which turns a question is about, lives in `transcript-turns.ts`.
 * Consumers: `read-tools.ts` (`read_session`, `ask_dactyl`) and `feeds/focus-feed.ts`, in the companion module.
 */

//----------------- THE FOUR FIXED BRIEFS ------------

/** The brief for the digest of a long last reply. Consumer: `read-tools.ts`'s `read_session` with scope `last_turn`. */
export const LAST_TURN_DIGEST_BRIEF =
  'What did this reply report: what got done, what changed, what it needs from the operator. Count any list and give each item in one line. At most 15 lines; cite L<n>.';

/** The brief for the digest of a session's last ten turns. Consumer: `read-tools.ts`'s `read_session` with scope `recent`. */
export const RECENT_DIGEST_BRIEF =
  'What has this session been doing: the threads of work, the decisions made, what is still open. At most 15 lines; cite L<n>.';

/** The brief for a phrase search, with `<phrase>` where the phrase goes — fill it with `phraseDigestBrief`. Consumer: `read-tools.ts`'s `read_session` with a phrase for scope. */
export const PHRASE_DIGEST_BRIEF = 'What does this session say about: <phrase>? At most 12 lines; cite L<n>.';

/** The brief for a focus session's finished reply. Consumer: `feeds/focus-feed.ts`, which hands the digest to her as the session's news. */
export const FOCUS_NEWS_BRIEF =
  'In at most 5 lines: what this reply reports was done, what changed, and what it needs from the operator; cite L<n>.';

/** The longest phrase a brief carries, in characters: it is a topic, and the brief is a sentence. */
const PHRASE_MAX_CHARACTERS = 200;

/**
 * `PHRASE_DIGEST_BRIEF` with the phrase in it, folded to one line, cut at 200 characters, and placed by a replacer
 * function so a `$&` in it stays text. Consumer: `read-tools.ts`, for the phrase scope of `read_session`.
 */
export function phraseDigestBrief(phrase: string): string {
  const topic = phrase.replace(/\s+/g, ' ').trim().slice(0, PHRASE_MAX_CHARACTERS);
  return PHRASE_DIGEST_BRIEF.replace('<phrase>', () => topic);
}

//----------------- RENDERING TURNS TO A FILE ------------

/**
 * Writes `rows` — as `sessionsService.fetchHistory` answers them — to `file` as markdown and answers how many turns
 * it holds: a heading per turn, his text and the reply's text in full, each tool call as one line
 * (`<tool> <short hint>`), the turn's calls counted. It ends with the newline the dactyl's line numbers count against.
 * Synchronous on purpose (a few kilobytes, handed straight to `runDactylRead`); the folder must exist
 * (`companionScratchDir`); zero turns still writes a file, so the caller judges the count.
 * Consumer: `.verify/probe-companion-reads.mjs`; `read-tools.ts` (`read_session`) renders a window of turns through
 * `renderTurnWindow`, and `feeds/focus-feed.ts` writes a reply with `nextScratchFile` and `writeFileSync`.
 */
export function renderTurns(sessionId: string, rows: NormalizedMessage[], file: string): number {
  const turns = groupTurns(rows);
  const title = `# Session ${sessionId.replace(/\s+/g, ' ').trim()} — ${turns.length} ${turns.length === 1 ? 'turn' : 'turns'}\n`;
  const body = turns.map((turn, index) => renderTurn(turn, index + 1));
  writeFileSync(file, [title, ...body].join('\n'), 'utf8');
  return turns.length;
}

/**
 * Writes a WINDOW of a chat's turns to `file` as markdown, each under the number the chat itself gives it, so a
 * digest that says "turn 8" means the chat's eighth. The title says how many of the `total` are here; where the window
 * skips turns (a phrase's matches are not neighbours) a line says which, so two separated windows never read as one.
 * Same layout as `renderTurns` otherwise. Synchronous, folder must exist. Consumer: `read-tools.ts` (`read_session`
 * digests: `recent`, a phrase, a long `last_turn`).
 */
export function renderTurnWindow(sessionId: string, window: NumberedTurn[], total: number, file: string): void {
  const whole = window.length === total && window.every((picked, index) => picked.number === index + 1);
  const count = whole ? `${total} ${total === 1 ? 'turn' : 'turns'}` : `${window.length} of ${total} turns`;
  const body = window.flatMap((picked, index) => {
    const skipped = index === 0 ? 0 : picked.number - window[index - 1].number - 1;
    const gap = skipped > 0 ? [`(${skipped === 1 ? `turn ${picked.number - 1} is` : `turns ${picked.number - skipped} to ${picked.number - 1} are`} not shown here)\n`] : [];
    return [...gap, renderTurn(picked.turn, picked.number)];
  });
  writeFileSync(file, [`# Session ${sessionId.replace(/\s+/g, ' ').trim()} — ${count}\n`, ...body].join('\n'), 'utf8');
}

//----------------- THE DACTYL ------------

/** Where the dactyl lives: the house's own script, which names the model and refuses what it must. */
const DACTYL_SCRIPT = path.join(os.homedir(), '.claude', 'scripts', 'dactyl');

/** How long one call may run before the dactyl is stopped: a read of eight files is a fan-out of model calls. */
const DACTYL_TIMEOUT_MS = 180_000;

/** After the stop request, how long the dactyl has to hand it to its children before it is killed outright. */
const DACTYL_KILL_GRACE_MS = 5_000;

/** The dactyl's answer: its stdout, or the sentence that says why there is none. */
export type DactylReadResult = { ok: true; text: string } | { ok: false; error: string };

/** A dactyl report without the spend line under each headline (model, effort, turns, tokens): never hers to say (Ruling 17). */
const withoutSpendLines = (stdout: string): string => {
  const lines = stdout.split('\n');
  return lines
    .filter((line, at) => !(at > 0 && /^[✓✗] dactyl --read /.test(lines[at - 1]) && /^ {2}\S.* \(served .*\) · .* · \d+ turns · \d+s\b/.test(line)))
    .join('\n');
};

/** The `✗` lines of a dactyl report: its own words for a refusal or for a file it could not answer. */
const failureLines = (stdout: string): string =>
  stdout
    .split('\n')
    .filter((line) => line.startsWith('✗'))
    .join('\n');

/**
 * Runs `~/.claude/scripts/dactyl --read <files…> --brief - [--context <file>]` with the brief on stdin and
 * answers what it printed, bounded at 180 s, in `userFacingEnv()`.
 *
 * - Exit 0: every file was answered; the answer is its stdout (16,000-byte budget, quote lines in it), less the
 *   spend line under each headline.
 * - Exit 2 or 3: it refused before reading anything; the error is its own `✗` line.
 * - Exit 1: some file was not answered. Stdout holds a `✓` block per answered file and a `✗` block per other, so
 *   with any answer in it the stdout is returned whole; with none, the `✗` lines are the error.
 * - Past the bound, or when `signal` fires (the tool call was cancelled: she was stopped), it is stopped (SIGTERM,
 *   which it hands to its children; SIGKILL after 5 s); a failed spawn is told. Each answers a sentence. Paths are
 *   made absolute, so a name is never read as one of its options.
 * Consumers: `read-tools.ts` (`read_session` digests, `ask_dactyl`, which pass the call's signal) and `feeds/focus-feed.ts`.
 */
export function runDactylRead(files: string[], brief: string, context?: string, signal?: AbortSignal): Promise<DactylReadResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, error: 'The reader was not started: the call was cancelled.' });
      return;
    }
    const args = ['--read', ...files.map((file) => path.resolve(file)), '--brief', '-'];
    if (context) args.push('--context', path.resolve(context));

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(DACTYL_SCRIPT, args, { env: userFacingEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, error: `The reader could not be started: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    // Why the dactyl was told to stop, if it was: the bound ran out, or the call was cancelled.
    let stopWhy: 'time' | 'cancel' | null = null;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const stoppedResult = (): DactylReadResult =>
      stopWhy === 'cancel'
        ? { ok: false, error: 'The reader was stopped: the call was cancelled.' }
        : { ok: false, error: `The reader took longer than ${DACTYL_TIMEOUT_MS / 1000} seconds and was stopped.` };
    const finish = (result: DactylReadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', onCancel);
      resolve(result);
    };

    const stop = (why: 'time' | 'cancel') => {
      if (stopWhy !== null || settled) return;
      stopWhy = why;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), DACTYL_KILL_GRACE_MS);
    };
    const stopTimer = setTimeout(() => stop('time'), DACTYL_TIMEOUT_MS);
    const onCancel = () => stop('cancel');
    signal?.addEventListener('abort', onCancel, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    // A dactyl that refuses on its arguments exits without reading stdin: the write then fails with EPIPE, which
    // unhandled is an uncaught exception. Its exit code says what happened.
    child.stdin?.on('error', () => {});
    child.on('error', (error) => finish({ ok: false, error: `The reader could not be started: ${error.message}` }));
    // `close` waits for the stdio pipes, which a descendant of the dactyl can hold open past the stop; the bound
    // must not wait on them, so a stopped call is answered when the dactyl itself has exited (`exit` comes first).
    child.on('exit', () => {
      if (stopWhy !== null) finish(stoppedResult());
    });

    child.on('close', (code, signal) => {
      const printed = withoutSpendLines(Buffer.concat(stdout).toString('utf8').trimEnd());
      if (code === 0 || (code === 1 && /^✓ /m.test(printed))) {
        finish({ ok: true, text: printed });
      } else if (code === null) {
        finish({ ok: false, error: `The reader was stopped by ${signal ?? 'a signal'} before it answered.` });
      } else {
        const said = failureLines(printed) || Buffer.concat(stderr).toString('utf8').trim().split('\n')[0];
        finish({ ok: false, error: said || `The reader stopped with exit code ${code} and said nothing.` });
      }
    });

    child.stdin?.end(brief);
  });
}

//----------------- HER SCRATCH FOLDER ------------

/**
 * Her scratch folder, `~/.claude/state/companion/<user id>/scratch`, made if absent. The id becomes a path
 * segment, so it must be a plain positive number. Consumers: `read-tools.ts`, which renders each digest's file
 * here, and `ask_dactyl`'s path rules, which let a dactyl read it.
 */
export function companionScratchDir(userId: string | number): string {
  const id = String(userId);
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`The companion's scratch folder belongs to an account number; got "${id}".`);
  const dir = path.join(os.homedir(), '.claude', 'state', 'companion', id, 'scratch');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The path of the next numbered file of `dir`: `0001-last-turn.md`, one more than the highest number any file there
 * carries, so the dactyl's `L<n>` and her own talk of "the third file" never name two files. Synchronous, and the
 * caller writes the file in the same tick, so two renders in one process never take one number. `label` is a plain
 * word of the caller's. Consumers: `read-tools.ts` (once per render) and `feeds/focus-feed.ts` (its digest file).
 */
export function nextScratchFile(dir: string, label: string): string {
  let highest = 0;
  for (const name of readdirSync(dir)) {
    const number = /^(\d+)-/.exec(name)?.[1];
    if (number !== undefined) highest = Math.max(highest, Number(number));
  }
  return path.join(dir, `${String(highest + 1).padStart(4, '0')}-${label}.md`);
}

/**
 * Keeps the newest `keep` files of `dir` (20 unless told) and unlinks the rest; answers how many it removed.
 * Only regular files directly inside `dir` are looked at — a folder or a link is left alone, nothing is removed
 * recursively. Newest is by modification time, ties broken by name. A vanished file is not a failure, and a
 * missing folder holds nothing to prune. Consumer: `read-tools.ts`, after each render.
 */
export function pruneScratch(dir: string, keep = 20): number {
  if (!Number.isInteger(keep) || keep < 0) {
    throw new RangeError(`pruneScratch keeps a whole number of files, 0 or more; got ${keep}.`);
  }

  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  const dated: Array<{ name: string; modified: number }> = [];
  for (const name of names) {
    try {
      dated.push({ name, modified: lstatSync(path.join(dir, name)).mtimeMs });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  dated.sort((a, b) => b.modified - a.modified || (a.name < b.name ? 1 : -1));

  let removed = 0;
  for (const stale of dated.slice(keep)) {
    try {
      unlinkSync(path.join(dir, stale.name));
      removed += 1;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[Companion] could not remove the scratch file ${stale.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return removed;
}
