import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { userFacingEnv } from '@/shared/child-env.js';

/**
 * The two processes a compaction launches, and the only places CloudCLI signals anything for it.
 *
 * Both are CHILDREN this module spawned, and a signal goes to the pid that spawn returned and to nothing
 * else (`signalOwnChild`). The verb in turn hands the signal down to the summarizer child it launched.
 */

const HEAL_TRIGGER = path.join(os.homedir(), '.claude', 'hooks', 'heal_trigger.py');
const SUMMARIZE_VERB = path.join(os.homedir(), '.claude', 'scripts', 'summarize');

/** The heal trigger only drains a payload and starts a detached worker; seconds is already wrong. */
const HEAL_TRIGGER_TIMEOUT_MS = 10_000;
/** One compaction's ceiling: the verb's own watch gives each summarizer call 30 minutes, and a prefix of several parts takes several. */
const VERB_CEILING_MS = 60 * 60 * 1000;
/** After a SIGTERM the verb is given this long to wind its child down before it is killed outright. */
const TERM_GRACE_MS = 15_000;
/** The verb's JSON carries the seed (summary plus the verbatim tail), so its output is large but not unbounded. */
const VERB_STDOUT_CAP_BYTES = 64 * 1024 * 1024;
const VERB_STDERR_CAP_BYTES = 64 * 1024;

/**
 * Signals a child this module spawned. Refuses anything but a plain pid above 1 (`kill(-1)` reaches
 * every process the user owns, `kill(0)` the caller's own group, and a pid file holding garbage would
 * turn a cleanup into an outage), and a child that has already exited, whose pid may be someone else's.
 */
function signalOwnChild(child: ChildProcess, signal: NodeJS.Signals): void {
  const { pid } = child;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
}

/**
 * Fires the heal trigger the way the CLI's own PreCompact hook row would have: the same payload on
 * stdin, `--reason compact`. Never rejects and never stops a compaction — a failure is one log line,
 * because the trigger is the chat's heal ending, not part of its compaction.
 */
export async function fireCompactHealTrigger(input: { oldProviderSessionId: string; oldTranscriptPath: string }): Promise<void> {
  const payload = JSON.stringify({
    hook_event_name: 'PreCompact',
    session_id: input.oldProviderSessionId,
    transcript_path: input.oldTranscriptPath,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('python3', [HEAL_TRIGGER, '--reason', 'compact'], {
        env: userFacingEnv(),
        cwd: os.homedir(),
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      const bound = setTimeout(() => {
        signalOwnChild(child, 'SIGKILL');
        reject(new Error(`did not return within ${HEAL_TRIGGER_TIMEOUT_MS} ms`));
      }, HEAL_TRIGGER_TIMEOUT_MS);
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < VERB_STDERR_CAP_BYTES) stderr += chunk.toString('utf8');
      });
      child.stdin?.on('error', () => {
        // The trigger exits without reading a payload it does not want; the exit code says the rest.
      });
      child.once('error', (error) => {
        clearTimeout(bound);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(bound);
        if (code === 0) resolve();
        else reject(new Error(`exited ${code}: ${stderr.trim().slice(0, 300)}`));
      });
      child.stdin?.end(payload);
    });
  } catch (error) {
    console.error(
      `[compaction] the heal trigger for ${input.oldProviderSessionId} failed; the compaction goes on:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/** What `summarize` answered: its exit code (null when a signal ended it), its one JSON object (null when stdout held none), and the tail of stderr. */
export type VerbAnswer = {
  exitCode: number | null;
  json: Record<string, unknown> | null;
  stderr: string;
};

/**
 * Runs `summarize --transcript <path> --session <id> [--instructions -]` and resolves with what it said.
 * Never rejects: a verb that cannot be started is an answer with a null exit code and the cause on
 * stderr. `onChild` receives the process handle the moment it is spawned, so the caller can wire Stop to
 * it; the 60-minute ceiling is applied here.
 */
export function runSummarizeVerb(input: {
  transcriptPath: string;
  providerSessionId: string;
  instructions: string | null;
  onChild: (stop: () => void) => void;
}): Promise<VerbAnswer> {
  return new Promise<VerbAnswer>((resolve) => {
    const args = ['--transcript', input.transcriptPath, '--session', input.providerSessionId];
    if (input.instructions !== null) args.push('--instructions', '-');

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let overflowed = false;
    let killTimer: NodeJS.Timeout | null = null;

    let child: ChildProcess;
    try {
      child = spawn(SUMMARIZE_VERB, args, { env: userFacingEnv(), cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ exitCode: null, json: null, stderr: error instanceof Error ? error.message : String(error) });
      return;
    }

    const terminate = (): void => {
      signalOwnChild(child, 'SIGTERM');
      killTimer ??= setTimeout(() => signalOwnChild(child, 'SIGKILL'), TERM_GRACE_MS);
      killTimer.unref();
    };
    const ceiling = setTimeout(() => {
      stderr += `\nsummarize passed its ${VERB_CEILING_MS / 60_000}-minute ceiling`;
      terminate();
    }, VERB_CEILING_MS);
    ceiling.unref();
    input.onChild(terminate);

    const settle = (exitCode: number | null): void => {
      clearTimeout(ceiling);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, json: overflowed ? null : parseOneObject(Buffer.concat(stdout).toString('utf8')), stderr: stderr.trim().slice(-2000) });
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > VERB_STDOUT_CAP_BYTES) {
        overflowed = true;
        stderr += '\nsummarize wrote more than its output cap';
        terminate();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < VERB_STDERR_CAP_BYTES) stderr += chunk.toString('utf8');
    });
    child.stdin?.on('error', () => {
      // A verb that refuses its input before reading the instructions closes stdin early; its exit says why.
    });
    child.once('error', (error) => {
      stderr += `\n${error.message}`;
      settle(null);
    });
    child.once('close', (code) => settle(code));
    child.stdin?.end(input.instructions ?? '');
  });
}

/** The one JSON object the verb prints, or null when stdout holds anything else. */
function parseOneObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text.trim());
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
