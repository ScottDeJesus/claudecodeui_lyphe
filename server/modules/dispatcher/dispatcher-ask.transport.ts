import { execFile } from 'node:child_process';
import os from 'node:os';

import type { DispatcherAsk } from '@/shared/types.js';

import { askingSince } from './dispatcher-ask.reader.js';

/**
 * The subprocess side of the prompts this lane raises: `dispatcher ask <plan>`, which records
 * the ask in the store, and the two doors an answer goes through — `dispatcher accept` and `dispatcher
 * tell --brief -` — run with the operator's words on stdin.
 *
 * THE WORDS AND THE RECORD ARE THE DISPATCHER'S. What an ask is, what it prints and when it is open is
 * `hooks/dispatcher/ask.py`'s; the census, the token and a stale Accept's refusal are `lock.py`'s and
 * `cmd/run.py`'s. This file composes nothing a person reads: it spawns, feeds stdin, and carries back
 * what the dispatcher said, as `runDispatcherCommand` (`@/shared/dispatcher-command.ts`) does for the card's buttons.
 *
 * The argv array is the whole command and no shell parses it; `cwd` is the home directory, because the
 * dispatcher resolves its store from `DISPATCHER_HOME`/`$HOME` and a verb must never be read against
 * whatever tree this server was started in.
 */

/** Plenty for one JSON prompt (a census of every phase of an arc's plans) or one verb's line or two. */
const OUTPUT_MAX_BUFFER = 1024 * 1024;

/** How much of the dispatcher's own line a failure carries: a refusal names the cause in one line. */
const FAILURE_LINE_CHARS = 200;

type CommandDependencies = {
  /** The dispatcher's entry point, absolute. */
  bin: string;
  /** Wall-clock ceiling for one command. */
  timeoutMs: number;
  /** The child's environment, composed once by `dispatcher.module.ts`. */
  env: NodeJS.ProcessEnv;
};

/** What one command did: its exit code (`null` when it was killed or never started) and its two streams. */
export type DispatcherCommandResult = { exit: number | null; stdout: string; stderr: string };

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readOutput(value: unknown): string {
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** The first non-blank line of a child's output, trimmed and capped: the part of it that names a cause. */
export function firstLine(value: string): string {
  const line = value.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? '';
  return line.slice(0, FAILURE_LINE_CHARS);
}

/**
 * Runs `dispatcher <args>` to its end, writing `stdin` to it when given, and never throws: a refusal
 * is a result (the dispatcher prints its refusals on STDOUT, exit 2), and a command that never
 * answered is `exit: null` with whatever it managed to print. Used by `dispatcher ask` below and by
 * `dispatcher-answer.service.ts` for `accept` and `tell`.
 */
export function runDispatcherCommand(
  dependencies: CommandDependencies,
  args: readonly string[],
  stdin?: string,
): Promise<DispatcherCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(dependencies.bin, [...args], {
      timeout: dependencies.timeoutMs,
      maxBuffer: OUTPUT_MAX_BUFFER,
      env: dependencies.env,
      cwd: os.homedir(),
    }, (error, stdout, stderr) => {
      const code = (error as { code?: unknown } | null)?.code;
      resolve({
        exit: error === null ? 0 : typeof code === 'number' && Number.isFinite(code) ? code : null,
        stdout: readOutput(stdout),
        stderr: readOutput(stderr) || (error !== null && typeof code !== 'number' ? error.message : ''),
      });
    });
    // `tell --brief -` reads its whole brief from stdin; every other verb reads none, and an ended
    // stdin is what tells a reader there is nothing more to come.
    child.stdin?.end(stdin ?? '');
  });
}

/**
 * What `dispatcher ask <plan>` answered: the ask recorded (`asked`, carrying the ask exactly as the
 * status document's `asking` key now does — or `null` when what it printed does not read as one, in
 * which case the next picture shows it), nothing owed right now (`nothing`), or a debt this lane
 * cannot raise, in the dispatcher's own line (`refused` — the Stop hold keeps it). Anything else — a
 * missing plan, a crash, a timeout — is a THROW carrying the dispatcher's own first line, because it is
 * not an answer and the landing has to stay due.
 */
export type DispatcherAskOutcome =
  | { outcome: 'asked'; ask: DispatcherAsk | null }
  | { outcome: 'nothing' }
  | { outcome: 'refused'; line: string };

/** The printed ask, read by the document's own reader — or `null`: the ask is recorded either way. */
function readPrintedAsk(printed: string, plan: string): DispatcherAsk | null {
  try {
    return askingSince(JSON.parse(printed) as unknown, `dispatcher ask ${plan}`);
  } catch {
    return null;
  }
}

/** Records and reads one plan's owed prompt. Used by `dispatcher.module.ts` for the landing detector's raise. */
export async function runDispatcherAsk(dependencies: CommandDependencies, plan: string): Promise<DispatcherAskOutcome> {
  const result = await runDispatcherCommand(dependencies, ['ask', plan]);
  if (result.exit === 2) return { outcome: 'refused', line: firstLine(result.stdout) };
  if (result.exit !== 0) {
    const said = firstLine(result.stderr) || firstLine(result.stdout);
    const how = result.exit === null ? 'did not answer' : `exited ${result.exit}`;
    throw new Error(`dispatcher ask ${plan} ${how}${said ? `: ${said}` : ''}`);
  }
  const printed = result.stdout.trim();
  return printed === '' ? { outcome: 'nothing' } : { outcome: 'asked', ask: readPrintedAsk(printed, plan) };
}
