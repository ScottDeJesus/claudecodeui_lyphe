import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CronJobOrigin } from '@/shared/types.js';

const execFileAsync = promisify(execFile);

/**
 * The box, read: every cron line the operator scheduled, as the sync finds them.
 *
 * ONE SOURCE — the user's own `crontab -l`: a schedule (five fields, or one macro), then the command.
 * The system tables (`/etc/crontab`, `/etc/cron.d`, and the run-parts directories) are NOT read. What
 * they hold is what the OS's packages ship — logrotate, man-db, apt, sysstat — and the operator's
 * ruling (2026-09-21) is that a job nobody here created has no place on this screen. The door only
 * ever writes the user crontab, so everything this house schedules is on the one source read here.
 *
 * This is a READ: nothing here writes, installs or repairs, and the sync only ever looks.
 *
 * A source that cannot be read contributes NO lines, a message to `error`, and its identity to
 * `failedSources`, so the caller can tell "this source said nothing" from "this source would not
 * answer" — only the first means a job is gone. The identity is what a tracked row carries as its
 * `source`.
 */

/** One cron line as the box holds it, before anything is known about whether it is tracked. */
export type SeenCronLine = {
  origin: CronJobOrigin;
  owner: string;
  expression: string;
  command: string;
  source: string;
  logPath: string | null;
  note: string | null;
};

/** A source that would not answer: the identity its rows carry, and the message that says why. */
export type ReadFailure = {
  source: string;
  detail: string;
};

const CRONTAB_TIMEOUT_MS = 5_000;
const CRONTAB_MAX_BUFFER = 1024 * 1024;

/** A schedule is five fields, or one macro standing in for all five. */
const FIELDS_PER_SCHEDULE = 5;
const MACRO_FIELD = /^@[a-zA-Z]+$/;

/** The user whose crontab `crontab -l` answers for, by the name the contract calls the owner. */
const USER_CRONTAB_OWNER = 'lyphe';
const USER_CRONTAB_SOURCE = 'crontab -l';

/** The `>>` redirection that tells a reader where a job's output went. */
const LOG_REDIRECT = /(?:^|\s)>>\s*(\S+)/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A child's output as a string: `execFile` declares a `string | Buffer` union for this call. */
function readOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** A line this reader must not mistake for a job: blank, a comment, or a NAME=VALUE assignment. */
function isJobLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return false;
  return !/^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed);
}

/** The absolute path a command redirects into, or null when it redirects nowhere absolute. */
function logPathOf(command: string): string | null {
  const redirect = LOG_REDIRECT.exec(command);
  if (redirect === null) return null;

  return redirect[1].startsWith('/') ? redirect[1] : null;
}

function isSeen(line: SeenCronLine | null): line is SeenCronLine {
  return line !== null;
}

/**
 * One crontab line as a seen line, or null when the line carries no job.
 *
 * The schedule is five fields OR one macro standing in for all five (`@reboot`, `@daily`), decided
 * by the line's own first token. Counting five unconditionally is not merely lossy: a macro line
 * long enough to pass that count keeps the TAIL of its command as what survives the cut (`2>&1`),
 * so the row records a fragment, every such job hashes to one id, and the journal can never match it.
 *
 * Fields are split on whitespace and rejoined with single spaces — cron's own invocation record
 * normalises the same way, so the command returned here is byte-for-byte the one the journal names
 * it by. A line too short to hold its own schedule and command is dropped, not guessed at.
 */
function parseCrontabLine(line: string): SeenCronLine | null {
  if (!isJobLine(line)) return null;

  const tokens = line.trim().split(/\s+/);
  const scheduleFields = MACRO_FIELD.test(tokens[0]) ? 1 : FIELDS_PER_SCHEDULE;
  if (tokens.length <= scheduleFields) return null;

  const command = tokens.slice(scheduleFields).join(' ');
  if (command === '') return null;

  return {
    origin: 'user',
    owner: USER_CRONTAB_OWNER,
    expression: tokens.slice(0, scheduleFields).join(' '),
    command,
    source: USER_CRONTAB_SOURCE,
    logPath: logPathOf(command),
    note: null,
  };
}

/** The operator's own crontab, through the crontab command — never by reading a file directly. */
async function readUserCrontab(failures: ReadFailure[]): Promise<SeenCronLine[]> {
  try {
    const { stdout } = await execFileAsync('crontab', ['-l'], {
      timeout: CRONTAB_TIMEOUT_MS,
      maxBuffer: CRONTAB_MAX_BUFFER,
    });

    return readOutput(stdout)
      .split('\n')
      .map(parseCrontabLine)
      .filter(isSeen);
  } catch (error) {
    failures.push({ source: USER_CRONTAB_SOURCE, detail: messageOf(error) });
    return [];
  }
}

/**
 * Every line the operator's crontab schedules, in file order, with a message and the source's
 * identity when it would not answer — so the sync can say which tracked rows went unread rather
 * than reading silence as "gone".
 */
export async function readBoxCron(): Promise<{
  lines: SeenCronLine[];
  error: string | null;
  failedSources: string[];
}> {
  const failures: ReadFailure[] = [];
  const lines = await readUserCrontab(failures);

  return {
    lines,
    error: failures.length === 0 ? null : failures.map((f) => `${f.source}: ${f.detail}`).join('; '),
    failedSources: failures.map((f) => f.source),
  };
}
