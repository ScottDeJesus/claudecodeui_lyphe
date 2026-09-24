import { createPolledLane, type PolledLane } from '@/shared/polled-lane.service.js';
import type { DispatcherStateEvent } from '@/shared/types.js';

import type { DispatcherPicture } from './dispatcher-state.service.js';

/**
 * The poll behind the `dispatcher_state` frame: every plan on this host, read off
 * `dispatcher status --json` and put on the wire when the picture moves.
 *
 * The mechanism — why it polls rather than watches, when it speaks and when it stays quiet, and why
 * a tick never takes the interval down with it — is `server/shared/polled-lane.service.ts`, where
 * the lanes that share it can read it once. What is THIS lane's is named here: the frame it sends,
 * and the snapshot it takes.
 *
 * This is the one lane on the server whose reading is a SUBPROCESS, so its snapshot answers a
 * promise; the lane's own rules cover that (a tick with a reading still out is skipped, and the
 * picture it serves meanwhile is the last one that landed).
 */

export type DispatcherWatcherDependencies = {
  /** The whole picture as of now, off the dispatcher's own command. Called on every tick; it never resolves on a body it cannot read. */
  snapshot: () => Promise<DispatcherPicture>;
  /** Puts one frame on every open chat socket. Called only when the picture changed. */
  broadcast: (frame: DispatcherStateEvent) => void;
  /** How often to look, in milliseconds. */
  pollMs: number;
  /** Injected by the composition root — this server has no logger (see `polled-lane.service.ts`). */
  logError: (message: string) => void;
};

export type DispatcherWatcher = PolledLane<DispatcherPicture>;

/**
 * The picture `current()` answers with in the gap between the lane's construction and its first
 * landing: a few tens of milliseconds, and the length of a restart's handover.
 *
 * It is the shape's own empties — no plans, no daemon, no hour — and the two route fields that
 * cannot be empty are the CONSERVATIVE pair rather than a claim about this box: the Claude route is
 * the one-at-a-time route, and `word` is left blank rather than given a phrase this build would be
 * inventing (the phrase is `width.word`'s, in Python). Nothing draws any of it while `plans` is
 * empty — a plan's own card is the only place the route's phrase is shown — and the reading that
 * replaces this picture is one interval away at the most.
 */
const EMPTY_PICTURE: DispatcherPicture = {
  plans: [],
  route: {
    provider: 'claude',
    swarm: { enabled: false, lanes: null },
    ceiling: 1,
    word: '',
    park_at_peak: false,
    peak_until: null,
  },
  daemon: { alive: false, pid: null, unit: null },
  offpeak_at: 'none',
  home: '',
  generated_at: '',
};

export function createDispatcherWatcher(dependencies: DispatcherWatcherDependencies): DispatcherWatcher {
  return createPolledLane<DispatcherPicture, DispatcherStateEvent>({
    ...dependencies,
    initial: EMPTY_PICTURE,
    // The document's own keys, exactly as the service built them, plus the frame's two: its kind and
    // its millisecond clock (`at`), which is what tells a client when the picture was read.
    frame: (picture) => ({ kind: 'dispatcher_state', ...picture, at: Date.now() }),
  });
}
