import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The journal, read ONCE per sync: which crontab command last ran, and when.
 *
 * `journalctl -u cron` is the only witness to a cron line actually firing. It records the
 * invocation and never an exit code, which is why a row's `lastResult` is `'invoked'` or null and
 * never a success this box cannot substantiate.
 *
 * The key is the WHOLE command, exactly as the crontab holds it — redirection and all — because
 * that is what cron writes into its own line:
 *
 *     (lyphe) CMD (/home/lyphe/.claude/scripts/runner-backup run >> …/runner-backup.log 2>&1)
 *
 * So lookup is equality and never a substring: two jobs that differ only in their log file are
 * two keys, and neither inherits the other's last run.
 *
 * **Once per sync, not once per row.** The Map is built at the top of `runSync` and handed down
 * to `reconcile`; a registry of forty rows still spawns exactly one journal read. That is what
 * the `sinceSpec` is for: the read must be bounded, and the sync passes `-7 days`, so the cost is
 * a week of cron lines rather than every line this machine has ever written.
 *
 * Nothing here throws. A journal that cannot be read — no permission, no journalctl, a timeout on
 * a busy box — yields an EMPTY map, which downstream means "no invocation seen" and never "the
 * job did not run": the two are not the same claim, and only the first one is made.
 */

/** How cron writes an invocation: the user it ran as, then the command as the crontab holds it. */
const INVOCATION = /^\(([^)]+)\) CMD \((.*)\)$/;

const JOURNAL_TIMEOUT_MS = 15_000;

/**
 * How much the journal may hand back. A week of this box's cron lines is a couple of megabytes,
 * so this is several times the real answer; it is stated rather than left to the default because
 * a capped read rejects and the caller's empty map would then read as "nothing ran".
 */
const JOURNAL_MAX_BUFFER = 16 * 1024 * 1024;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The journal's output as a string. `execFile` declares the `string | Buffer` union for this call,
 * and a Buffer would render as "[object Object]" rather than as a line of JSON.
 */
function readOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/**
 * An instant as ISO-8601 with this box's own offset — `2026-09-21T08:47:01-07:00`, not `Z`.
 *
 * The journal speaks UTC microseconds; the operator reads wall-clock time off a screen that names
 * the box's zone. `getTimezoneOffset` answers for THIS instant, so the offset is the right one on
 * either side of a daylight-saving change, and the instant itself is untouched by the spelling.
 */
function isoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 19);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);

  return `${local}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * Which command last ran since `sinceSpec`, and the instant it did — keyed by the exact command.
 *
 * `sinceSpec` is journalctl's own `--since` spelling (`-7 days`, `2026-09-01 00:00:00`); the
 * caller owns the window, this function owns only the read. Every invocation line is folded into
 * the latest instant seen for its command, so a job that has run forty times this week answers
 * with its most recent run.
 */
export async function readCronInvocations(sinceSpec: string): Promise<Map<string, string>> {
  const latestByCommand = new Map<string, number>();

  try {
    const { stdout } = await execFileAsync(
      'journalctl',
      ['-u', 'cron', '--since', sinceSpec, '--no-pager', '-o', 'json', '--output-fields=MESSAGE'],
      { timeout: JOURNAL_TIMEOUT_MS, maxBuffer: JOURNAL_MAX_BUFFER }
    );

    for (const line of readOutput(stdout).split('\n')) {
      if (!line.startsWith('{')) continue;

      let entry: { MESSAGE?: unknown; __REALTIME_TIMESTAMP?: unknown };
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // A journal line that will not parse is one entry lost, never the whole read.
      }

      if (typeof entry.MESSAGE !== 'string') continue;
      if (typeof entry.__REALTIME_TIMESTAMP !== 'string') continue;

      const invoked = INVOCATION.exec(entry.MESSAGE);
      if (invoked === null) continue;

      // Journal timestamps are microseconds since the epoch — a number, never a date string.
      const micros = Number(entry.__REALTIME_TIMESTAMP);
      if (!Number.isFinite(micros)) continue;

      const command = invoked[2];
      const previous = latestByCommand.get(command);
      if (previous === undefined || micros > previous) latestByCommand.set(command, micros);
    }
  } catch {
    return new Map();
  }

  const invocations = new Map<string, string>();
  for (const [command, micros] of latestByCommand) {
    invocations.set(command, isoWithOffset(new Date(micros / 1000)));
  }

  return invocations;
}
