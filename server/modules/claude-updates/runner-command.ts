/**
 * How the update runner runs ONE command, and what the job hears about it.
 *
 * This is the seam `update-runner.ts` is built on: everything about running a command that does not
 * depend on WHICH command it is — the argv spawn with no shell, the framing into `job.log`, the
 * ten-minute ceiling with the kill ladder behind it, and the rule that turns what a command printed
 * into the one line a step carries. The runner decides what a job needs run; this decides what
 * running it means. It is a sibling rather than a part of the runner because the two change for
 * different reasons, and because the runner's own job logic has to fit under the 300-line ceiling.
 *
 * The one thing this file assumes is where its words go: see `say()`.
 */

import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

/** One command's ceiling. Ten minutes covers a cold registry, not a hung one. */
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/** After SIGTERM, how long a command has to go down by itself; then it is killed. */
const KILL_GRACE_MS = 10_000;

/** How long a command that HAS exited may still be draining its pipes before its verdict is read. A
 *  grandchild that inherited them — npm runs the packages' own install scripts — can hold them open
 *  long after npm is gone, and a verdict must never hang on one. `child.mjs` waits out the same
 *  hazard with the same bound. */
const STREAM_DRAIN_MS = 250;

/** The detail a timed-out command carries, wherever its step is written. */
const TIMEOUT_DETAIL = 'npm did not finish within 10 minutes';

/** Everything one command said, and everything there is to decide from it. */
export type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** True when the ceiling, not the command, ended it: the verdict is then the ceiling's. */
  timedOut: boolean;
  /** Every line it printed, in arrival order — what the log frames and the detail rule searches. */
  lines: string[];
  /** Its stderr alone: git's refusal is there and nowhere else. */
  stderr: string[];
  /** What a failed step says about it. */
  detail: string;
};

/**
 * One line into `job.log`. This process's stdout IS that file — the spawner opened it for append and
 * handed it over as this process's stdout and stderr both — so every framed line is written once, in
 * order, by the one process that owns the job. A caller with something of its own to say (a refusal,
 * a usage line) says it through here, and it lands beside the commands it is about.
 */
export function say(line: string): void {
  process.stdout.write(`[${new Date().toISOString()}] ${line}\n`);
}

/** One line read from a stream: kept in `all` (and in `own` when a caller wants this stream
 *  separately) and framed into the log. Blank lines are dropped — npm pads its output with them. */
function record(line: string, all: string[], own: string[] | null): void {
  const text = line.trimEnd();
  if (text.trim() === '') return;
  all.push(text);
  if (own) own.push(text);
  say(text);
}

/**
 * Reads one of a command's streams a line at a time into the record.
 *
 * The carry is per stream: a line split across two chunks must not be glued to another stream's
 * half, and a stream that ends mid-line still owes its last line to the job.
 */
function tap(stream: Readable | null, all: string[], own: string[] | null = null): void {
  if (!stream) return; // stdio is piped here; a stream that is not would be nothing to read
  let carry = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    carry += chunk;
    const parts = carry.split('\n');
    carry = parts.pop() ?? '';
    for (const part of parts) record(part, all, own);
  });
  stream.on('end', () => record(carry, all, own));
}

/**
 * What a failed command's detail says: the first line it printed that starts `npm error`, else the
 * last thing it said, else — a command that printed nothing at all — the verdict it died with.
 *
 * A timed-out command carries the timeout sentence whatever else it printed: the ceiling is what
 * happened to it, and a line from an install cut off mid-flight is not the reason it failed.
 */
function failureDetail(result: CommandResult): string {
  if (result.timedOut) return TIMEOUT_DETAIL;
  const complaint = result.lines.find((line) => line.startsWith('npm error'));
  if (complaint) return complaint;
  const last = result.lines.at(-1);
  return last ?? `npm exited with ${result.signal ?? result.code ?? 'no verdict'} and said nothing`;
}

/**
 * Runs one command by argv — never through a shell — and answers what became of it.
 *
 * Its output is framed into the log between a `$ <command>` line and an `exit <code>` line, and kept
 * in memory for the detail rule. A command past COMMAND_TIMEOUT_MS is TERMed and counts as failed
 * whatever it exits with: the ceiling is the verdict, not the exit code. The SIGKILL after the grace
 * period is for the process that ignores SIGTERM — a runner that never ends is a job the reconciler
 * reads as interrupted, over an install that may well have finished.
 */
export function runCommand(argv: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    say(`$ ${argv.join(' ')}`);
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

    const lines: string[] = [];
    const stderr: string[] = [];
    tap(child.stdout, lines);
    tap(child.stderr, lines, stderr);

    let settled = false;
    let timedOut = false;
    let neverStarted = false;
    let killTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, COMMAND_TIMEOUT_MS);

    let drainTimer: NodeJS.Timeout | null = null;
    const settle = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (drainTimer) clearTimeout(drainTimer);
      const result: CommandResult = { code, signal, timedOut, lines, stderr, detail: '' };
      result.detail = failureDetail(result);
      say(neverStarted ? 'exit — the command never started' : `exit ${code ?? signal ?? 'unknown'}`);
      resolve(result);
    };

    // A command that cannot start at all — nothing named on PATH — is a failed command rather than a
    // crash of the runner. Node reports it as `error` and then `close`, carrying a bare libuv code
    // (-2) where an exit code would be, so the verdict is assembled in the one place every other
    // verdict is and the log line says what happened instead of printing that number.
    child.on('error', (error) => {
      neverStarted = true;
      record(error.message, lines, null);
    });
    child.on('exit', (code, signal) => {
      drainTimer = setTimeout(() => settle(code, signal), STREAM_DRAIN_MS);
    });
    child.on('close', settle);
  });
}

/** What a failed git says: its own first stderr line, which is where git puts a refusal. */
export function gitDetail(result: CommandResult): string {
  return result.stderr.at(0) ?? result.detail;
}
