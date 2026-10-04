import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '@/shared/child-env.js';
import type {
  AgentLaunchDefaultsChange,
  AgentLaunchResolved,
  AgentLaunchResult,
  AgentLaunchRowChange,
} from '@/shared/types.js';

const execFileAsync = promisify(execFile);

/**
 * Relaying the launch table's own CLI.
 *
 * This server keeps no view of the table and owns none of its state. It never opens `launch.toml` and
 * never regenerates a shim: it runs the CLI's own verbs and carries back what the CLI said. The hooks'
 * `launch_table` package is the one reader and writer of the file, so every shape Settings → Agents → Edit Agent Chains draws
 * — and every word it may pick, and every sentence that refuses one — exists once in this house rather
 * than once per language. One reader per store, one transport, and the transport is a process this
 * service does not look inside of.
 *
 * Nothing here throws. A refusal is a RESULT — the operator needs the CLI's own sentence, not a 500 —
 * and the shapes are the heal lane's (`heal.service.ts`) with one addition: a `refused` reason, because
 * unlike a reflex's summary, a write can be told no. The argv array is the security boundary: no shell
 * parses any of this, so a word carrying a space, a semicolon or a quote is one argument the CLI
 * rejects rather than a second command.
 */

/**
 * How much the CLI may say. The census is one JSON object of about twenty-two rows, tens of kilobytes;
 * this is stated rather than left to the default so the number is visible beside the payload that has
 * to reason about overflowing it.
 */
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024;

/** Wall-clock ceiling for `show` and `resolve`: the CLI reads one small file and the shims' frontmatter. */
const READ_TIMEOUT_MS = 20_000;

/**
 * Wall-clock ceiling for a write. It has to clear the CLI's wait for the table's lock and then the
 * shim generator's own 60 s bound, so a CLI that is behaving exactly as it promised is never cut here.
 */
const WRITE_TIMEOUT_MS = 90_000;

/** The exit code on which the CLI refuses: an argument or a table it will not act on. Any other non-zero exit is a crash. */
const REFUSED_EXIT_CODE = 2;

/** How much of a crash's stderr rides in a message: the last line is the exception, the rest is a traceback. */
const SAID_MAX_CHARS = 300;

/**
 * The CLI's `show`, `set` and `defaults` payload, carried WHOLE. This service does not reshape it:
 * every key in it belongs to the window, the window reads it by the name the CLI printed, and a translation
 * layer here would be a second place the census's shape is written down.
 */
type AgentLaunchCensus = Record<string, unknown>;

export type AgentLaunchService = {
  /** The whole census the window reads: the defaults, one row per soul and Metis, each row's lanes. */
  census(): Promise<AgentLaunchResult<AgentLaunchCensus>>;
  /** Pin or clear one row's model and effort. Answers the census the CLI printed AFTER the write. */
  setRow(name: string, change: AgentLaunchRowChange): Promise<AgentLaunchResult<AgentLaunchCensus>>;
  /** Change the table's defaults. Answers the census the CLI printed AFTER the write. */
  setDefaults(change: AgentLaunchDefaultsChange): Promise<AgentLaunchResult<AgentLaunchCensus>>;
  /** The `--model` and `--effort` words a launch of `name` takes on one side of the DeepSeek switch. */
  resolveSide(name: string, side: AgentLaunchResolved['side']): Promise<AgentLaunchResult<AgentLaunchResolved>>;
};

export type AgentLaunchServiceDependencies = {
  /** The CLI's entry point, absolute — `~/.claude/scripts/launch-table` unless the env moved it. */
  bin: string;
};

/** One JSON object off a CLI's stdout, or null when the text is anything else. */
function parseObject(stdout: unknown): Record<string, unknown> | null {
  if (typeof stdout !== 'string') return null;
  try {
    const payload: unknown = JSON.parse(stdout);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The last non-blank line of a crash's stderr, bounded: the exception a traceback ends on. */
function lastLine(stderr: unknown): string {
  if (typeof stderr !== 'string') return '';
  const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, SAID_MAX_CHARS);
}

/**
 * What a run that ended non-zero — or never started, or was cut — comes to. `execFile` rejects for all
 * of them, with the exit code (a number) or the spawn's errno (a string) in `code`, `killed` true when
 * the timeout took the process, and whatever it printed in `stdout` and `stderr`.
 */
function failedRun(error: unknown, timeoutMs: number): AgentLaunchResult<never> {
  const failure = error as { code?: unknown; killed?: unknown; stdout?: unknown; stderr?: unknown };
  if (failure.code === REFUSED_EXIT_CODE && failure.killed !== true) {
    const sentence = parseObject(failure.stdout)?.['error'];
    // This CLI's own parser reports a call it could not read as an `{"error"}` sentence too, so that
    // reads as a refusal. Exit 2 with nothing usable on stdout is a process that is not this CLI
    // speaking — Python itself exits 2 for a script it cannot open — and that is not the operator's refusal.
    if (typeof sentence === 'string' && sentence) return { ok: false, reason: 'refused', message: sentence };
  }
  if (failure.killed === true) {
    return {
      ok: false,
      reason: 'unreachable',
      message: `the launch table did not answer within ${timeoutMs / 1000} s`,
    };
  }
  // No stderr means the process never spoke: the errno names why it did not start (`ENOENT`), or the exit code stands.
  const exited = typeof failure.code === 'number' ? `exit ${failure.code}` : typeof failure.code === 'string' ? failure.code : '';
  const said = lastLine(failure.stderr) || exited;
  return {
    ok: false,
    reason: 'unreachable',
    message: `the launch table could not be asked${said ? ` (${said})` : ''}`,
  };
}

/** Runs the CLI and decodes the one JSON object it prints. */
async function ask(
  bin: string,
  argv: string[],
  timeoutMs: number,
): Promise<AgentLaunchResult<Record<string, unknown>>> {
  let stdout: string;
  try {
    // `cwd` is the home directory rather than this repository, and the environment is the one a
    // process started for the operator inherits: a save regenerates the shims by running Python from
    // the CLI, and the server's own `TSX_TSCONFIG_PATH` is a fact about this process, not that one.
    stdout = (await execFileAsync(bin, argv, {
      timeout: timeoutMs,
      maxBuffer: OUTPUT_MAX_BYTES,
      env: userFacingEnv(),
      cwd: os.homedir(),
    })).stdout;
  } catch (error) {
    return failedRun(error, timeoutMs);
  }
  const payload = parseObject(stdout);
  if (payload === null) {
    // The CLI's contract is ONE object and nothing else, so anything else is a CLI this lane has no
    // answer for — never a body of our own over the top of it.
    return { ok: false, reason: 'unreadable', message: 'the launch table did not answer with a JSON object' };
  }
  return { ok: true, value: payload };
}

/** `resolve`'s object narrowed to the answer it promises, or null when a field is missing or mistyped. */
function asResolved(payload: Record<string, unknown>, name: string, side: string): AgentLaunchResolved | null {
  const { model, effort } = payload;
  const answered = payload['name'] === name && payload['side'] === side;
  if (!answered || typeof model !== 'string' || !model) return null;
  if (effort !== null && typeof effort !== 'string') return null;
  return { name, side: side as AgentLaunchResolved['side'], model, effort };
}

/** The argv of `set`: `null` is the CLI's own word for "clear this pin", `default`. */
function setRowArgv(name: string, change: AgentLaunchRowChange): string[] {
  const argv = ['set', name];
  if (change.model !== undefined) argv.push('--model', change.model ?? 'default');
  if (change.effort !== undefined) argv.push('--effort', change.effort ?? 'default');
  return argv;
}

/** The argv of `defaults`: a `null` effort is `none` — no `--effort` flag on that model at all. */
function setDefaultsArgv(change: AgentLaunchDefaultsChange): string[] {
  const argv = ['defaults'];
  if (change.model !== undefined) argv.push('--model', change.model);
  for (const [model, effort] of Object.entries(change.effort ?? {})) {
    argv.push('--effort', `${model}=${effort ?? 'none'}`);
  }
  if (change.deepseek_effort !== undefined) argv.push('--deepseek-effort', change.deepseek_effort);
  return argv;
}

export function createAgentLaunchService({ bin }: AgentLaunchServiceDependencies): AgentLaunchService {
  return {
    census: () => ask(bin, ['show'], READ_TIMEOUT_MS),

    setRow: (name, change) => ask(bin, setRowArgv(name, change), WRITE_TIMEOUT_MS),

    setDefaults: (change) => ask(bin, setDefaultsArgv(change), WRITE_TIMEOUT_MS),

    async resolveSide(name, side) {
      const asked = await ask(bin, ['resolve', name, '--side', side], READ_TIMEOUT_MS);
      if (!asked.ok) return asked;
      const resolved = asResolved(asked.value, name, side);
      if (resolved === null) {
        return { ok: false, reason: 'unreadable', message: 'the launch table did not resolve the launch it was asked about' };
      }
      return { ok: true, value: resolved };
    },
  };
}
