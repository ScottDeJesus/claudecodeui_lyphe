/**
 * When the reconciler looks again with no event to tell it: the one timer a settled pass leaves behind.
 *
 * Every change a pass acts on is announced — a write of `job.json` is heard on the directory, and a
 * runner this process spawned reports its own exit. What no event announces is a DEADLINE, and this
 * file names each one: a retry after a pass that threw, the end of a reboot request's answer window,
 * and the liveness of a runner this process did not spawn (inherited across a handover), whose exit
 * reaches nobody. Anything else is `null`: no timer at all.
 */

import type { ClaudeUpdateJob, ClaudeUpdateJobState } from '@/shared/claude-update-types.js';

import { stepOf } from './update-job.js';
import { REBOOT_ANSWER_TIMEOUT_MS } from './update-reconciler.states.js';

/** How often a runner this process did NOT spawn is looked at. A poll, because a stranger's exit is no
 *  event of ours; only while such a runner holds the job, and five seconds is as long as a spinner may
 *  stand over a runner that is already gone. */
export const RUNNER_LIVENESS_MS = 5_000;

/** How long after a pass that threw the next one is tried. The failure (a probe, a git call) is
 *  outside this file and may clear on its own; no write will announce that it has. */
export const PASS_RETRY_MS = 5_000;

/** The states a job never leaves. A job in one of these is history: nothing acts on it, and nothing
 *  arms a watch or a timer for it. */
const TERMINAL_STATES: readonly ClaudeUpdateJobState[] = ['done', 'failed', 'rolled-back', 'interrupted'];

export function isTerminal(state: ClaudeUpdateJobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export type WakeFacts = {
  now: number;
  /** This process's pid: only its own reboot request has a deadline here. */
  pid: number;
  /** Whether this process will hear that runner's exit. */
  holdsRunnerExit: (runnerPid: number | null) => boolean;
  lastPassThrew: boolean;
};

/** Milliseconds until the next pass no event will ask for, or null for none. */
export function nextWakeMs(job: ClaudeUpdateJob | null, facts: WakeFacts): number | null {
  if (job === null || isTerminal(job.state)) return null;
  if (facts.lastPassThrew) return PASS_RETRY_MS;
  return deadlineOfState(job, facts);
}

function deadlineOfState(job: ClaudeUpdateJob, facts: WakeFacts): number | null {
  switch (job.state) {
    case 'installing':
    case 'rolling-back':
      return facts.holdsRunnerExit(job.runnerPid) ? null : RUNNER_LIVENESS_MS;
    case 'restarting':
      return rebootAnswerLeftMs(job, facts);
    case 'installed':
    case 'done':
    case 'failed':
    case 'rolled-back':
    case 'interrupted':
      return null;
    default: {
      const unhandled: never = job.state;
      throw new Error(`no wake rule for job state ${String(unhandled)}`);
    }
  }
}

/** The time left on THIS process's own unanswered reboot request. The states put the step back only
 *  once the window is strictly past, so the wake lands one millisecond after it. */
function rebootAnswerLeftMs(job: ClaudeUpdateJob, { now, pid }: WakeFacts): number | null {
  const { requestedAt, requestedBy } = job.restart;
  const restart = stepOf(job, 'restart');
  if (requestedBy !== pid || requestedAt === null || restart?.state !== 'running') return null;
  return Math.max(0, requestedAt + REBOOT_ANSWER_TIMEOUT_MS - now) + 1;
}
