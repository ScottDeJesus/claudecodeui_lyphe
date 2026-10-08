import type { ChatProcessActivity } from '@/shared/types.js';

import { onActivityChanged } from './compaction-registry.js';
import type { CompactionFlight } from './compaction-registry.js';

/**
 * THE GUARD. A new session cannot adopt background tasks, monitors or subagents, so a compaction waits
 * until the old process has none — it never swaps a process out from under running work.
 *
 * The wait is EVENT-DRIVEN: it subscribes to the runtime's `activityChanged` for the chat (no timer, no
 * poll) and ends on the first change that leaves the process not busy or not live. Each change that
 * leaves it busy re-says what is waited for, because the reason moves ("2 background tasks are
 * running" becomes "1 background task is running").
 *
 * Consumer: compaction-procedure.ts.
 */

/** What the process is doing now, asked of the runtime. */
type ReadActivity = () => ChatProcessActivity;

/** The status line a manual compaction shows while it waits. */
function waitingText(activity: ChatProcessActivity): string {
  return `Compaction waits until ${activity.why ?? 'the chat is quiet'} — Stop cancels it`;
}

/**
 * Resolves true when the chat's process is quiet (not busy, or not live), false when the flight was
 * stopped first. `say` writes the status frame. With `wait` false it never waits: a busy process
 * resolves false at once with `busyWhy` set — the automatic compactions use that, because an
 * automatic compaction never holds a chat the operator is using.
 */
export function waitUntilQuiet(input: {
  sessionId: string;
  flight: CompactionFlight;
  readActivity: ReadActivity;
  say: (text: string) => void;
  wait: boolean;
}): Promise<{ quiet: true } | { quiet: false; busyWhy: string | null }> {
  const { sessionId, flight, say } = input;
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => {};
    const finish = (outcome: { quiet: true } | { quiet: false; busyWhy: string | null }): void => {
      unsubscribe();
      resolve(outcome);
    };
    const consider = (activity: ChatProcessActivity): void => {
      if (flight.stopped) return finish({ quiet: false, busyWhy: null });
      if (!activity.busy || !activity.live) return finish({ quiet: true });
      if (!input.wait) return finish({ quiet: false, busyWhy: activity.why });
      say(waitingText(activity));
    };

    flight.stop = async () => {
      flight.stopped = true;
      finish({ quiet: false, busyWhy: null });
      return true;
    };
    // Subscribed BEFORE the first read: both are synchronous, so no change can fall between them.
    unsubscribe = onActivityChanged(sessionId, consider);
    consider(input.readActivity());
  });
}
