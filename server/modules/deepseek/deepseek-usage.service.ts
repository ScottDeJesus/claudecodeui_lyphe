import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '../../shared/child-env.js';

const execFileAsync = promisify(execFile);

/**
 * Relaying the DeepSeek usage ledger's own recorder.
 *
 * This server keeps no view of the ledger and owns none of its state: it never opens the SQLite
 * file, never prices a message and never formats a dollar figure. `scripts/deepseek-usage` is the
 * ONE writer of that store, so a reading this server saw and a reading `deepseek-usage stats`
 * prints are the same row because they came through the same validator — never because two
 * implementations agree today.
 *
 * Nothing here throws. A reading the recorder refuses is a FACT about that one reading, and the
 * route above is answering a person about money: a refused recording must never become a 5xx.
 */

/**
 * How much the recorder may say. The recording verbs print one word (`recorded`), so this is
 * thousands of times the real output; it is stated rather than left to the default so the ceiling
 * is visible beside the child that has to reason about it.
 */
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Wall-clock ceiling for one recording. The recorder opens the ledger, validates four arguments and
 * writes one row — measured at about 0.1 s on this host — so ten seconds is a starved machine or a
 * child that never got to speak, and either way the call is owed an end rather than a hang.
 */
const RECORD_TIMEOUT_MS = 10_000;

/**
 * The ONE fault shape the recorder is allowed to be quoted by (`scripts/deepseek-usage`): the verb,
 * the exception class, and nothing else — no message, no path, no traceback. Anything else a child
 * writes is replaced by the fixed string below, so no transcript value can ride a stderr line into
 * this server's log.
 */
const FAULT_LINE = /^deepseek-usage [a-z-]+: [A-Za-z_][A-Za-z0-9_.]*$/;

/** What replaces anything the recorder said that is not its own fault line. */
const FAULT_MESSAGE = 'deepseek-usage failed';

/** One balance reading as the vendor served it: `total` is a decimal STRING, never parsed here. */
export type DeepseekUsageReading = {
  total: string;
  currency: string;
  available: boolean;
  checkedAt: number;
};

/** What this lane can be asked to do. Phase 3b widens this with the ledger's own reader. */
export type DeepseekUsageService = {
  record(reading: DeepseekUsageReading): Promise<void>;
};

export type DeepseekUsageDependencies = {
  /** The recorder's entry point, absolute — `~/.claude/scripts/deepseek-usage` unless the env moved it. */
  bin: string;
};

/** One child's answer: it recorded, or it did not and here is what class of refusal that was. */
type AskOutcome = { ok: true } | { ok: false; code: number | null; message: string };

/**
 * The environment a recorder child inherits.
 *
 * `userFacingEnv()` carries the server's whole environment (`shared/child-env.ts`), and
 * `server/load-env.ts` folds the repository's `.env` — where the vendor key lives — into it at
 * boot. The recorder needs no credential of any kind, so the key is deleted from the copy: the
 * argv rule is worth nothing if the environment hands the same secret over instead. The comment
 * deliberately does not spell the variable's name — the ONE line that does is the delete.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = userFacingEnv();
  delete env.DEEPSEEK_API_KEY;
  return env;
}

/**
 * Runs the recorder once, with the argument array as the security boundary: no shell parses any of
 * this, so a value from a vendor's body is one argument the recorder validates rather than a second
 * program or a second flag. `cwd` is the home directory rather than this repository, because the
 * recorder resolves `~/.claude` itself.
 */
async function ask(bin: string, argv: string[], timeoutMs: number): Promise<AskOutcome> {
  try {
    await execFileAsync(bin, argv, {
      timeout: timeoutMs,
      maxBuffer: OUTPUT_MAX_BYTES,
      env: childEnv(),
      cwd: os.homedir(),
    });
    return { ok: true };
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    const firstLine = typeof failure.stderr === 'string'
      ? (failure.stderr.split('\n')[0] ?? '').trim()
      : '';
    return {
      ok: false,
      code: typeof failure.code === 'number' ? failure.code : null,
      message: FAULT_LINE.test(firstLine) ? firstLine : FAULT_MESSAGE,
    };
  }
}

export function createDeepseekUsageService({ bin }: DeepseekUsageDependencies): DeepseekUsageService {
  return {
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
      else console.warn(`deepseek-usage record: ${outcome.message}`);
    },
  };
}
