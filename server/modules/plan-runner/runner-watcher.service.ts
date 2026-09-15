import type { RunnerRunSnapshot, RunnerStateEvent } from '@/shared/types.js';
import { createPolledLane, type PolledLane } from '@/shared/polled-lane.service.js';

/**
 * The poll behind the `runner_state` frame: the runs on this host, read off disk every couple of
 * seconds and put on the wire when the picture moves.
 *
 * The mechanism — why it polls rather than watches, when it speaks and when it stays quiet, and
 * why a tick never takes the interval down with it — is `server/shared/polled-lane.service.ts`,
 * where the lanes that share it can read it once. What is THIS lane's is named here: the frame it
 * sends, and the snapshot it takes.
 */

export type RunnerWatcherDependencies = {
  /** The whole picture as of now. Called on every tick; it is expected to be cheap and to never throw. */
  snapshot: () => RunnerRunSnapshot[];
  /** Puts one frame on every open chat socket. Called only when the picture changed. */
  broadcast: (frame: RunnerStateEvent) => void;
  /** How often to look, in milliseconds. */
  pollMs: number;
  /** Injected by the composition root — this server has no logger (see `polled-lane.service.ts`). */
  logError: (message: string) => void;
};

export type RunnerWatcher = PolledLane<RunnerRunSnapshot[]>;

export function createRunnerWatcher(dependencies: RunnerWatcherDependencies): RunnerWatcher {
  return createPolledLane<RunnerRunSnapshot[], RunnerStateEvent>({
    ...dependencies,
    frame: (runs) => ({ kind: 'runner_state', runs, at: Date.now() }),
  });
}
