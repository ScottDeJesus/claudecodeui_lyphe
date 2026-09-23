import { createHash } from 'node:crypto';
import os from 'node:os';

import { cronJobsDb, getConnection, initializeDatabase } from '@/modules/database/index.js';
import type { CronJob } from '@/shared/types.js';

import { describeCron } from './schedules-cron-describe.js';
import {
  normaliseField,
  readTab,
  removeLine,
  upsertLine,
  withLock,
  writeTab,
} from './schedules-crontab.service.js';
import { runSync } from './schedules-sync.service.js';

/**
 * The door: change a cron job and record it in the same act.
 *
 * One command in this repo edits the operator's crontab, and this is it. It is reached through
 * `/home/lyphe/.claude/scripts/cron-registry-sync <verb>`, never by this path: a crontab line quoting
 * an application repo's internal file would need repairing every time that file moved.
 *
 * **Four verbs.** `add` writes a line and its row (its name, purpose and tags with it), `remove` takes both away, `list` prints the
 * registry, `sync` re-reads the box. Each prints one line on stdout whose first token is the verb.
 *
 * **The registry write and the crontab write are one act**, under ONE lock, crontab FIRST: if the
 * crontab takes the line and the registry then throws, the box holds a job the record does not know
 * about — drift, made just now, by this command — named on stdout with the command's own text, exit
 * non-zero. A failure is never reported as success.
 *
 * **The lock serializes the door ACROSS PROCESSES**, and every verb that touches the registry takes
 * it, `sync` included: the sync's own cron line runs this same command and a hand-run `add` can land
 * inside one. The sync's `inFlight` guards one process only and cannot see a door; the sidecar can.
 * NOT covered is a sync started in the SERVER — the Schedules tab's Refresh — which never calls this
 * file, so a Refresh overlapping a live `add` can still re-badge the row the door just curated.
 *
 * **`busy_timeout` before the first write**, because the live database's journal mode is `delete`, not
 * WAL, and this process is a SECOND writer: without the pragma a write arriving mid-transaction fails
 * `SQLITE_BUSY` instead of waiting the five seconds that would have seen it through.
 *
 * **A verb runs without touching the box** with `--tabfile <path>` — the crontab half sent to that
 * file, read and write alike — and `DATABASE_PATH` for the registry, which is NOT necessarily empty:
 * `connection.ts` fills a path that does not exist yet from the repo's legacy `database/auth.db`.
 */

/** The live crontab's identity, spelled exactly as the sync's reader spells it on the rows it reads. */
const LIVE_SOURCE = 'crontab -l';

/** The number a BAD INVOCATION exits with — unknown verb, unknown or missing flag — where failed work is 1. */
const USAGE_EXIT = 2;

/** A bad invocation, as opposed to work that failed. Thrown by the flag helpers, read at the bottom. */
class UsageError extends Error {}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One verb's answer, on stdout, its first token the verb — what a check reads. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The registry this process writes into, schema applied — the pragma first, because that is a write. */
async function openRegistry(): Promise<void> {
  getConnection().pragma('busy_timeout = 5000');
  await initializeDatabase();
}

/** The contract's id: kind, origin, and the first twelve hex digits of the COMMAND's sha1. */
function rowId(command: string): string {
  return `cron:user:${createHash('sha1').update(command).digest('hex').slice(0, 12)}`;
}

/** A verb's flags as typed: a value may hold spaces (a whole command line), never a leading `--`. */
function readFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument \`${token}\``);

    const name = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);

    flags.set(name, value);
    index += 1;
  }

  return flags;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value === '') throw new UsageError(`--${name} is required`);
  return value;
}

/**
 * `--tags cleanup,backup` as the row stores them: split on commas, trimmed, lowercased, blanks and
 * repeats dropped, in the order typed. `--tags ''` clears them; leaving the flag off keeps the row's.
 */
function parseTags(raw: string): string[] {
  const tags = raw.split(',').map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== '');
  return [...new Set(tags)];
}

/** The registry read the two editing verbs share: the row they are about to replace or delete. */
function findRow(id: string): CronJob | undefined {
  return cronJobsDb.listJobs().find((job) => job.id === id);
}

/** `add --name <n> [--purpose <p>] [--tags <a,b>] --schedule <expr> --command <cmd> [--log <path>] [--tabfile <f>]`
 *
 * Idempotent on the command: one line and one row, however many times it runs. Flags not given are
 * kept from the existing row, except `logPath` — the redirection this act PUT ON THE LINE, since a
 * path recorded against a line that does not redirect there is what the next sync reads back as null.
 *
 * `--log <path>` is composed into the line — `… >> <path> 2>&1`, cron's own idiom, because cron mails
 * stdout otherwise — and the row records that same path. A command carrying its own `>>` is written
 * as given, and pairing one with `--log` is refused rather than resolved: two answers about where
 * output goes is not something a door may pick between silently.
 */
async function add(argv: string[]): Promise<number> {
  const flags = readFlags(argv);
  const name = required(flags, 'name');
  const expression = normaliseField(required(flags, 'schedule'));
  const typed = normaliseField(required(flags, 'command'));
  const logPath = flags.get('log') ?? null;
  const tabfile = flags.get('tabfile');
  const typedTags = flags.get('tags');

  if (logPath !== null && typed.includes('>>')) {
    throw new UsageError(
      `the command already redirects, so --log '${logPath}' says a second thing about where its ` +
        'output goes; put the path in the command or drop --log'
    );
  }

  const command = normaliseField(logPath === null ? typed : `${typed} >> ${logPath} 2>&1`);

  return withLock(tabfile ?? null, async () => {
    await openRegistry();

    const before = await readTab(tabfile);
    const after = upsertLine(before, expression, command, tabfile);
    const written = after !== before;
    if (written) await writeTab(after, tabfile);

    const id = rowId(command);
    const existing = findRow(id);
    const now = new Date().toISOString();
    const tags = typedTags === undefined ? existing?.tags ?? [] : parseTags(typedTags);

    try {
      cronJobsDb.upsertJob({
        id,
        kind: 'cron',
        name,
        purpose: flags.get('purpose') ?? existing?.purpose ?? null,
        tags,
        owner: os.userInfo().username,
        origin: 'user',
        expression,
        scheduleText: describeCron(expression),
        command,
        logPath,
        state: 'ok',
        // The door is the ONLY thing that clears drift: curating a job here says the line is meant.
        drift: 'none',
        driftDetail: null,
        lastRunAt: existing?.lastRunAt ?? null,
        lastResult: existing?.lastResult ?? null,
        nextRunAt: null,
        note: existing?.note ?? null,
        source: tabfile ?? LIVE_SOURCE,
        trackedAt: existing?.trackedAt ?? now,
        updatedAt: now,
      });
    } catch (error) {
      say(
        `add drift crontab=${written ? 'written' : 'unchanged'} registry=missing command='${command}' ` +
          `reason='${messageOf(error)}'`
      );
      return 1;
    }

    say(
      `add ok name='${name}' schedule='${expression}' command='${command}' table=${tabfile ?? 'live'} ` +
        `log=${logPath ?? 'none'} tags=${JSON.stringify(tags)} ` +
        `crontab=${written ? 'written' : 'unchanged'} row=${id}`
    );
    return 0;
  });
}

/** `remove --command <cmd> [--tabfile <f>]` — the line and the row that tracks it both go.
 *
 * Idempotent as `add` is, and a row whose line had already left the box is deleted here too: this is
 * the operator saying the job is off the record, the one act allowed to delete rather than mark. */
async function remove(argv: string[]): Promise<number> {
  const flags = readFlags(argv);
  const command = normaliseField(required(flags, 'command'));
  const tabfile = flags.get('tabfile');

  return withLock(tabfile ?? null, async () => {
    await openRegistry();

    const before = await readTab(tabfile);
    const after = removeLine(before, command);
    const dropped = after !== before;
    if (dropped) await writeTab(after, tabfile);

    const id = rowId(command);
    const existing = findRow(id);

    try {
      cronJobsDb.removeJob(id);
    } catch (error) {
      say(
        `remove drift crontab=${dropped ? 'removed' : 'unchanged'} registry=not-deleted ` +
          `command='${command}' reason='${messageOf(error)}'`
      );
      return 1;
    }

    say(
      `remove ok command='${command}' table=${tabfile ?? 'live'} crontab=${dropped ? 'removed' : 'unchanged'} ` +
        `row=${id} registry=${existing === undefined ? 'absent' : 'deleted'}`
    );
    return 0;
  });
}

/** `list` — the registry, one job per line, every line beginning with the verb. */
async function list(): Promise<number> {
  await openRegistry();

  const jobs = cronJobsDb.listJobs();
  if (jobs.length === 0) {
    say('list empty count=0');
    return 0;
  }

  for (const job of jobs) {
    say(
      `list id=${job.id} kind=${job.kind} state=${job.state} drift=${job.drift} ` +
        `expression='${job.expression}' command='${job.command}'`
    );
  }

  return 0;
}

/** `sync` — one run of the sync, its report as one line. A run that could not read a source exits
 * non-zero — the cron line this belongs on wants the mail. It takes the door's sidecar like the
 * editing verbs: a cron-driven sync and a hand-run `add` write rows the other has just read. */
async function sync(): Promise<number> {
  return withLock(null, async () => {
    await openRegistry();

    const report = await runSync();
    say(
      `sync ok=${report.ok ? 'y' : 'n'} seen=${report.seen} adopted=${report.adopted} ` +
        `missing=${report.missing} changed=${report.changed} ms=${report.ms} ranAt=${report.ranAt} ` +
        `error='${report.error ?? ''}'`
    );

    return report.ok ? 0 : 1;
  });
}

const USAGE =
  'usage: cron-registry-sync add --name <n> [--purpose <p>] [--tags <a,b>] --schedule <expr> --command <cmd> ' +
  '[--log <path>] [--tabfile <f>]\n' +
  '       cron-registry-sync remove --command <cmd> [--tabfile <f>]\n' +
  '       cron-registry-sync list\n' +
  '       cron-registry-sync sync';

async function main(): Promise<number> {
  const [verb, ...rest] = process.argv.slice(2);

  switch (verb) {
    case 'add':
      return await add(rest);
    case 'remove':
      return await remove(rest);
    case 'list':
      return await list();
    case 'sync':
      return await sync();
    default:
      process.stderr.write(`${USAGE}\n`);
      return USAGE_EXIT;
  }
}

/**
 * The exit status is set rather than forced: `process.exit` can cut a piped stdout before the verb's
 * line has left the buffer, and that line is the whole answer a check reads. A bad invocation leaves
 * by its own door — 2, with the usage — so a caller never reads "something went wrong" instead.
 */
main().then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  process.stderr.write(`cron-registry-sync: ${messageOf(error)}\n`);
  if (error instanceof UsageError) process.stderr.write(`${USAGE}\n`);
  process.exitCode = error instanceof UsageError ? USAGE_EXIT : 1;
});
