import { execFile } from 'node:child_process';
import os from 'node:os';

import { userFacingEnv } from '../../shared/child-env.js';

/**
 * Relaying the DeepSeek usage ledger's own recorder and its own reader.
 *
 * This server keeps no view of the ledger and owns none of its state: it never opens the SQLite
 * file, never prices a message and never formats a dollar figure. `scripts/deepseek-usage` is the
 * ONE reader and writer of that store, so a number a person is shown and a number the reader prints
 * are the same number because they came through the same read — never because two implementations
 * agree today.
 *
 * Nothing here throws. A reading the recorder refuses is a FACT about that one reading, and a route
 * answering a person about money must never turn it into a 5xx. A refused READ is different: it is
 * a fault with a name, and it stays a fault — an unreadable ledger and an idle account must not
 * look alike on the way out, which is why the two reasons below are carried rather than flattened
 * into an empty success.
 */

/**
 * How much a child may say. The recording verbs print one word; the reader prints one JSON object —
 * the consumer table and the fourteen-day series inside it. This is thousands of times either, and
 * it is stated rather than left to the default so the ceiling is visible beside the children that
 * have to reason about overflowing it.
 */
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Wall-clock ceiling for one recording. The recorder opens the ledger, validates four arguments and
 * writes one row — measured at about 0.1 s on this host — so ten seconds is a starved machine or a
 * child that never got to speak, and either way the call is owed an end rather than a hang.
 */
const RECORD_TIMEOUT_MS = 10_000;

/**
 * Wall-clock ceiling for one reading.
 *
 * The reader syncs both transcript roots before it tallies them, so a cold ledger walks thousands of
 * files while a warm one answers in a fraction of a second. Thirty seconds is a cold first sync, a
 * machine under real load, or a child that never got to speak; either way the view is owed an answer
 * rather than a request that never ends, and the timeout becomes the `unreachable` fault the view
 * draws as one calm word.
 */
const USAGE_TIMEOUT_MS = 30_000;

/**
 * The ONE fault shape a child is allowed to be quoted by (`scripts/deepseek-usage`): the verb, the
 * exception class, and nothing else — no message, no path, no traceback. Anything else a child
 * writes is replaced by the fixed string below, so no transcript value can ride a stderr line into
 * this server's log or into a response body.
 */
const FAULT_LINE = /^deepseek-usage [a-z-]+: [A-Za-z_][A-Za-z0-9_.]*$/;

/** What replaces anything a child said that is not its own fault line. */
const FAULT_MESSAGE = 'deepseek-usage failed';

/** One balance reading as the vendor served it: `total` is a decimal STRING, never parsed here. */
export type DeepseekUsageReading = {
  total: string;
  currency: string;
  available: boolean;
  checkedAt: number;
};

/**
 * The windows the ledger's reader tallies, spelled once here and fenced again at the route that
 * accepts one.
 */
export type DeepseekUsageRange = 'today' | '7d' | '30d' | 'all';

/**
 * Why a usage question went unanswered.
 *
 *  - `unreachable`  the reader never answered: not on this host, torn down before it spoke, or it
 *                   refuses to serve both transcript roots in time.
 *  - `unreadable`   the reader answered, and it was not the one JSON object its contract promises.
 */
export type DeepseekUsageFault = 'unreachable' | 'unreadable';

/** One reading's answer: the payload WHOLE, or the fault and the reader's own sentence for it. */
export type DeepseekUsageResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: DeepseekUsageFault; message: string };

/** What this lane can be asked to do: read the ledger, and book a balance reading into it. */
export type DeepseekUsageService = {
  /** The whole usage payload over one window at one feed length. */
  usage(range: DeepseekUsageRange, feed: number): Promise<DeepseekUsageResult>;
  /** Record one reading. A refused reading is reported and dropped; it is never thrown. */
  record(reading: DeepseekUsageReading): Promise<void>;
};

export type DeepseekUsageDependencies = {
  /** The reader's entry point, absolute — `~/.claude/scripts/deepseek-usage` unless the env moved it. */
  bin: string;
};

/** One child's answer: what it printed, or how it ended instead. */
type AskOutcome =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; code: number | null; stderr: string };

/**
 * The environment a child inherits.
 *
 * `userFacingEnv()` carries the server's whole environment (`shared/child-env.ts`), and
 * `server/load-env.ts` folds the repository's `.env` — where the vendor key lives — into it at
 * boot. Neither child in this lane needs a credential of any kind, so the key is deleted from the
 * copy: the argv rule is worth nothing if the environment hands the same secret over instead. The
 * comment deliberately does not spell the variable's name — the ONE line that does is the delete.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = userFacingEnv();
  delete env.DEEPSEEK_API_KEY;
  return env;
}

/**
 * A child's failure as a sentence: its first stderr line when that line is the child's own fault
 * shape, and the fixed string otherwise.
 *
 * ONE rule, applied by every reason that has to quote a child. A traceback's first line, a path, an
 * argument echoed back by the runtime — none of it is a fault line, so all of it becomes the same
 * three words, and what a browser receives can only ever be one of those two things.
 */
function faultMessage(stderr: string): string {
  const firstLine = (stderr.split('\n')[0] ?? '').trim();
  return FAULT_LINE.test(firstLine) ? firstLine : FAULT_MESSAGE;
}

/**
 * Runs one child, with the argument array as the security boundary: no shell parses any of this, so
 * a value from a vendor's body or from a query string is one argument the child validates rather
 * than a second program or a second flag. `cwd` is the home directory rather than this repository,
 * because the reader and the recorder resolve `~/.claude` themselves.
 *
 * This is the ONE spawn in this file, and that is what makes it the ONE environment rule and the ONE
 * fault rule too: the reader's child gets the key-stripped environment because the recorder's child
 * does. A second call site would be a second chance for either rule to drift without anyone seeing
 * it.
 */
function ask(bin: string, argv: string[], timeoutMs: number): Promise<AskOutcome> {
  return new Promise((resolve) => {
    // The spawn can throw SYNCHRONOUSLY — an argument carrying a NUL byte is `ERR_INVALID_ARG_VALUE`,
    // raised before any child exists. That is the same fact as a child that never answered, and it
    // has to resolve rather than reject: `record` runs as `void usage.record(...)`, so a rejection is
    // an unhandled one, and this process is the server. `stderr` is empty because no child ever spoke,
    // which is why this lands on the fixed message and never on Node's own error text.
    //
    // The value that reaches argv unchecked is a vendor's — `deepseek.service.ts` passes a reading's
    // raw strings through so the recorder stays the ONE validator — so this is the spawn layer's own
    // refusal to carry them, and it is a reading dropped, never a boot lost.
    try {
      execFile(
        bin,
        argv,
        { encoding: 'utf8', timeout: timeoutMs, maxBuffer: OUTPUT_MAX_BYTES, env: childEnv(), cwd: os.homedir() },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ ok: false, code: typeof error.code === 'number' ? error.code : null, stderr });
            return;
          }
          resolve({ ok: true, stdout, stderr });
        },
      );
    } catch {
      resolve({ ok: false, code: null, stderr: '' });
    }
  });
}

export function createDeepseekUsageService({ bin }: DeepseekUsageDependencies): DeepseekUsageService {
  return {
    async usage(range, feed) {
      // The window and the feed length arrive validated (the route holds them to the reader's own
      // closed set and range), and they go over as ONE argument each — this array is the boundary
      // between a query string and argv.
      //
      // Nothing is cached between calls. The reader's sync IS the freshness: a cached answer would
      // be this server inventing an age for a number it did not read, and the panel polls far more
      // often than the ledger's own contents change.
      const outcome = await ask(bin, [
        'stats',
        '--json',
        '--range', range,
        '--feed', String(feed),
      ], USAGE_TIMEOUT_MS);

      if (!outcome.ok) {
        return { ok: false, reason: 'unreachable', message: faultMessage(outcome.stderr) };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(outcome.stdout);
      } catch {
        payload = null; // A body that is not JSON is the same fact as a body that is not an object.
      }

      // The reader's contract is ONE object and nothing else, so anything else is a reader this lane
      // has no answer for — never an empty object over the top of it, which a view would draw as an
      // account that spent nothing.
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return { ok: false, reason: 'unreadable', message: faultMessage(outcome.stderr) };
      }

      return { ok: true, value: payload as Record<string, unknown> };
    },

    async record(reading) {
      // The vendor's strings go over UNCHECKED, each in the `--flag=value` form. The recorder is
      // the ONE validator of a reading, and a second one here would be a second answer to "is this
      // a reading" — two answers that drift the day the Python side widens. The `=` form matters
      // for the same reason the array does: a value can never be read as a flag.
      const outcome = await ask(bin, [
        'balance-record',
        '--total=' + reading.total,
        '--currency=' + reading.currency,
        '--available=' + (reading.available ? '1' : '0'),
        '--checked-at=' + String(reading.checkedAt),
      ], RECORD_TIMEOUT_MS);

      if (outcome.ok) return;

      // Exit 2 is the recorder's own word for an invalid reading — the vendor served something it
      // will not write. Every other failure is the recorder being unreachable, and its class is
      // the whole message. Neither line carries a value: the ledger is where a reading belongs.
      if (outcome.code === 2) console.warn('deepseek-usage record: invalid-reading');
      else console.warn(`deepseek-usage record: ${faultMessage(outcome.stderr)}`);
    },
  };
}
