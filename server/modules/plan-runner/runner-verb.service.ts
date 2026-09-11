import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import type { RunnerVerb, RunnerVerbResult } from '@/shared/types.js';
import { userFacingEnv } from '@/shared/child-env.js';

/**
 * Relaying the runner's own two verbs, `stop` and `resume`.
 *
 * This server never manipulates a run itself: it does not take the run's lock, does not signal
 * its process and never rewrites one of its state files. It runs the runner's own command and
 * carries back what the runner said. That is the whole design — the runner already knows what a
 * pause means, what a resume may refuse, and which of the two a given run can even accept.
 *
 * The argv array is the security boundary. No shell parses any of this: the binary and its two
 * arguments are handed to the kernel as separate strings, so a run id carrying a space, a
 * semicolon or a quote is one argument the runner rejects rather than a second command. The id
 * is ALSO validated at the route before it reaches here (`plan-runner.routes.ts`), because two
 * fences is what makes the inner one survive a new caller.
 *
 * Nothing here throws. A refusal is a RESULT — the operator needs the runner's own sentence, not
 * a 500 — and the two cases where the runner never got to answer come back as a one-word
 * `reason`. Nothing of OUR making enters the result — no stack, no thrown message, no path we
 * composed: the runner's `stderr` is the verdict, and our own words are used only where there is
 * none. The runner's own sentence travels UNTOUCHED, including any path it chose to name (`stop`
 * on an unknown id says `no such run or file — <state dir>/<id>/run.json`, and
 * `phase-23.mjs` asserts on exactly that). Never sanitize that field: it is the answer.
 */

const execFileAsync = promisify(execFile);

/**
 * How much the runner may say. Both verbs print a line or two, so this is roughly a thousand
 * times the real output; it is stated rather than left to the default so the number is visible
 * beside the classification that has to reason about overflowing it.
 */
const VERB_MAX_BUFFER = 1024 * 1024;

export type RunnerVerbDependencies = {
  /** The runner's entry point, absolute — `~/.claude/scripts/plan-runner` unless the env moved it. */
  bin: string;
  /** Wall-clock ceiling for one verb. */
  timeoutMs: number;
  /**
   * The directory holding the Claude CLI, prepended to `PATH`, or `null` when this process
   * cannot name one. A resumed run spawns souls that look the CLI up on their own `PATH`, and
   * the server's `PATH` is whatever systemd handed it — frequently without it.
   */
  claudeBinDir: string | null;
};

/**
 * What is said when the runner itself said nothing, because it never ran or never finished.
 *
 * The `timeout` sentence covers both ways a signal arrives — our own ceiling and a kill from
 * outside this process — because from here they are the same fact: the command ran and was torn
 * down before it said anything. It deliberately does NOT claim nothing changed: `resume` takes
 * the lock, reopens the ledger, clears `stopped_at` and saves `run.json` BEFORE it detaches its
 * daemon (`hooks/plan_runner/cmd/launch.py:209-223`), so a teardown that lands late can land
 * after the run is already un-parked. "Nothing happened" is the one thing this lane cannot know.
 */
const NO_ANSWER: Record<'timeout' | 'spawn-failed', string> = {
  timeout: "the runner was stopped before it answered — read the run's state before retrying, since a resume un-parks it before it detaches",
  'spawn-failed': 'the plan runner command could not be started on this host',
};

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** The runner's own exit code, or `null` when it was killed or never started. */
function readExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Runs one verb against one run id.
 *
 * `cwd` is the home directory rather than this repository: the runner resolves its own state
 * root from `$HOME`, and a verb must never be interpreted against whatever working tree the
 * server happens to have been started in.
 */
export async function runRunnerVerb(
  verb: RunnerVerb,
  runId: string,
  dependencies: RunnerVerbDependencies,
): Promise<RunnerVerbResult> {
  const searchPath = dependencies.claudeBinDir
    ? `${dependencies.claudeBinDir}:${process.env.PATH ?? ''}`
    : process.env.PATH;

  try {
    const result = await execFileAsync(dependencies.bin, [verb, runId], {
      timeout: dependencies.timeoutMs,
      maxBuffer: VERB_MAX_BUFFER,
      env: { ...userFacingEnv(), PATH: searchPath },
      cwd: os.homedir(),
    });
    return {
      ok: true,
      verb,
      run_id: runId,
      exit: 0,
      stdout: readOutput(result.stdout),
      stderr: readOutput(result.stderr),
    };
  } catch (error) {
    const failure = error as { code?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown };
    const stdout = readOutput(failure.stdout);
    const stderr = readOutput(failure.stderr);

    // A NUMERIC code means the runner ran and decided: that is a verdict, and it travels whole.
    const exit = readExitCode(failure.code);
    if (exit !== null) {
      return { ok: false, verb, run_id: runId, exit, stdout, stderr };
    }

    // Everything else is the runner never answering, and `signal` is what separates the two
    // kinds. MEASURED on this host rather than assumed (node v24.14.0):
    //
    //   our own ceiling   code null    killed true    signal 'SIGTERM'
    //   killed from       code null    killed false   signal 'SIGKILL'
    //     outside
    //   output overflow   code 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'   no killed, no signal
    //   missing binary    code 'ENOENT'                              no killed, no signal
    //
    // So a SIGNAL means the command started, ran, and was torn down before it could answer —
    // true of our ceiling and of an operator's `kill` alike. `killed` is the wrong test: it is
    // false for the outside kill, which would then be reported as "could not be started" about a
    // verb that started, ran, and may already have un-parked the run.
    //
    // Residue, named: an output overflow has no signal and so lands on `spawn-failed`, which is
    // the one string-code case where something DID start. It is honestly neither word — the
    // vocabulary is sealed at two and mirrored client-side — and `VERB_MAX_BUFFER`, a thousand
    // times the real output, is what keeps it unreachable rather than merely unlikely.
    const reason = typeof failure.signal === 'string' ? 'timeout' : 'spawn-failed';
    return {
      ok: false,
      verb,
      run_id: runId,
      exit: null,
      stdout,
      // Whatever the runner managed to say before it was cut off still counts; our own sentence
      // stands in only when it said nothing, so the reader is never handed a blank refusal.
      stderr: stderr || NO_ANSWER[reason],
      reason,
    };
  }
}
