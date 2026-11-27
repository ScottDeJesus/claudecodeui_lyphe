/**
 * One timer at one instant: the deadline a module computed from its own state, so the module wakes when the clock alone
 * would change its answer, and not before. `arm(at)` replaces whatever was armed and null clears; `at` is epoch
 * milliseconds on this process's clock, and an instant already passed fires on the next turn of the timers. A delay
 * longer than Node's longest timer is waited out in steps of that size, so a far instant neither fires at once (what
 * Node does with an overlong delay) nor is lost. The timer is unref'd: a deadline is never a reason for a process to stay up.
 *
 * A non-finite `at` (NaN from an unparsable date) clears, as null does: it never fires every turn.
 *
 * `armedAt()` is the instant armed, null when nothing is. It already reads null inside `onDue`, so a handler that
 * arms again reads as armed for its new instant.
 *
 * Consumers: `modules/cerberus/red-watch.service.ts` (the next plan), `modules/cerberus/warden-links.ts` (each node's silence),
 * `modules/scheduled-messages/services/scheduled-message-clock.service.ts` (the next due scheduled message, and the
 * earliest end of a queued message's hold).
 */

/** Node's longest timer (about 24.8 days); a longer delay is waited out in steps of this. */
const LONGEST_TIMER_MS = 2_147_483_647;

export type DeadlineTimer = {
  /** Replaces whatever was armed with one wake at `at` (epoch ms); null clears. */
  arm(at: number | null): void;
  /** The instant armed, or null. */
  armedAt(): number | null;
  /** Nothing fires until the next `arm`. */
  clear(): void;
};

export function createDeadlineTimer(onDue: () => void): DeadlineTimer {
  let timer: NodeJS.Timeout | null = null;
  let target: number | null = null;

  const clear = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    target = null;
  };

  // One step toward `at`: the whole wait when it fits in one timer, else the longest one and another step after it.
  const step = (at: number): void => {
    timer = setTimeout(() => {
      timer = null;
      if (at > Date.now()) {
        step(at);
        return;
      }
      target = null;
      onDue();
    }, Math.min(LONGEST_TIMER_MS, Math.max(0, at - Date.now())));
    timer.unref();
  };

  return {
    arm(at) {
      clear();
      if (at === null || !Number.isFinite(at)) return;
      target = at;
      step(at);
    },
    armedAt: () => target,
    clear,
  };
}
