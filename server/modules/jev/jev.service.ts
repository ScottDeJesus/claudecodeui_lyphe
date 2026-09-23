import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '../../shared/child-env.js';

const execFileAsync = promisify(execFile);

/**
 * Relaying Jev's own reader.
 *
 * This server keeps no view of Jev's spend and owns none of its state. It never opens the ledger,
 * never reads the account file, never lists the cache's keys and never touches a budget counter: it
 * runs the reader's own command and carries back what the reader said. `hooks/jev_stats/` is the one
 * reader of each of those stores, so a number the panel shows and a number `jev stats` prints are the
 * same number because they came from the same read — never because two implementations agree today.
 * That is the whole design: one reader per store, one transport, and the transport is a process this
 * service does not look inside of.
 *
 * Nothing here throws. A refusal is a RESULT — the panel needs the reader's own sentence, not a 500 —
 * and the shapes below are the heal lane's (`heal.service.ts`), so the two relay lanes in this server
 * answer the same way. The argv array is the security boundary: no shell parses any of this, so a
 * range or a feed count from a query string is one argument the reader rejects rather than a second
 * command or a second flag.
 */

/**
 * How much the reader may say. `stats --json` is one JSON object — the consumer table and the
 * fourteen-day series inside it — so this is thousands of times the real output; it is stated rather
 * than left to the default so the number is visible beside the payload that has to reason about
 * overflowing it.
 */
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Wall-clock ceiling for one read. The reader opens the ledger, tallies it and prints; measured at
 * about 0.1 s on this host, so twenty seconds is a torn-down process or a machine under real load,
 * and either way the panel is owed an answer rather than a request that never ends.
 */
const JEV_TIMEOUT_MS = 20_000;

/** The windows the reader tallies, spelled once here and fenced again at the route that accepts one. */
export type JevRange = 'today' | '7d' | '30d' | 'all';

/**
 * Why a Jev question went unanswered.
 *
 *  - `unreachable`  the reader never answered: not on this host, or torn down before it spoke.
 *  - `unreadable`   the reader answered, and it was not the one JSON object its contract promises.
 */
export type JevFault = 'unreachable' | 'unreadable';

export type JevResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: JevFault; message: string };

export type JevServiceDependencies = {
  /** The reader's entry point, absolute — `~/.claude/scripts/jev` unless the env moved it. */
  bin: string;
};

/**
 * The two questions this lane can ask. The payload is carried WHOLE and typed as the record it is:
 * every key in it belongs to the panel, the panel reads it by the name the reader printed, and a
 * translation layer here would be a second place the payload's shape is written down.
 */
export type JevService = {
  /** The whole summary the panel reads: spend, consumers, the fourteen-day series, the live feed. */
  summary(range: JevRange, feed: number): Promise<JevResult<Record<string, unknown>>>;
  /** Clear the reader's own cache. The `cache clear` verb is the one home of that mutation. */
  clearCache(): Promise<JevResult<Record<string, unknown>>>;
};

/**
 * Runs the reader and decodes the one JSON object it prints.
 *
 * `cwd` is the home directory rather than this repository, and the environment is the one a process
 * started for the operator inherits — the reader resolves `~/.claude` itself, and the server's own
 * `TSX_TSCONFIG_PATH` is not a fact about the reader (`shared/child-env.ts` states that measurement).
 */
async function ask(
  bin: string,
  argv: string[],
  timeoutMs: number,
): Promise<JevResult<Record<string, unknown>>> {
  let stdout: string;
  try {
    stdout = (await execFileAsync(bin, argv, {
      timeout: timeoutMs,
      maxBuffer: OUTPUT_MAX_BYTES,
      env: userFacingEnv(),
      cwd: os.homedir(),
    })).stdout;
  } catch (error) {
    const failure = error as { stderr?: unknown };
    const said = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
    return {
      ok: false,
      reason: 'unreachable',
      message: `the jev reader could not be asked${said ? ` (${said})` : ''}`,
    };
  }
  try {
    const payload: unknown = JSON.parse(stdout);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('not an object');
    }
    return { ok: true, value: payload as Record<string, unknown> };
  } catch {
    // The reader's contract is ONE object and nothing else, so anything else is a reader this lane
    // has no answer for — never a body of our own over the top of it. This is also what keeps a
    // reader whose format drifted from being shown to the panel as zeros, which read as an idle Jev.
    return { ok: false, reason: 'unreadable', message: 'the jev reader did not answer with a JSON object' };
  }
}

export function createJevService({ bin }: JevServiceDependencies): JevService {
  return {
    // The range and the feed are handed over as ONE argument each, and the feed is stringified here
    // rather than interpolated anywhere: this array is the boundary between a query string and argv.
    summary: (range, feed) =>
      ask(bin, ['stats', '--json', '--range', range, '--feed', String(feed)], JEV_TIMEOUT_MS),

    clearCache: () => ask(bin, ['cache', 'clear', '--json'], JEV_TIMEOUT_MS),
  };
}
