/**
 * One call made once a burst of requests has settled.
 *
 * A watch on a directory hears every write of a burst — a launch's spec, its pid files and its first
 * log lines land within a few milliseconds of each other — and the reader behind it should run once for
 * the burst, not once per write. The first `request()` arms one timer; every request while it is
 * pending is absorbed; `run` is called once when it fires. A request made from inside `run` opens a
 * new window, because the timer is cleared before `run` is called. `cancel()` drops a pending one.
 *
 * The window is measured from the FIRST request, never pushed back by later ones: a writer that never
 * pauses still gets read every `settleMs`. The timer is unref'd, so a pending call never holds the
 * process up at shutdown. `run` reports its own failure: this file has nothing to say about it.
 */

/** The settle every chat-server watch uses, the number `dispatcher-store-watch.service.ts` settles its store burst with. */
export const SETTLE_MS = 300;

export type SettledCall = { request(): void; cancel(): void };

export function createSettledCall(dependencies: { run: () => void; settleMs: number }): SettledCall {
  let pending: NodeJS.Timeout | null = null;

  const fire = (): void => {
    pending = null;
    dependencies.run();
  };

  return {
    request(): void {
      if (pending !== null) return;
      pending = setTimeout(fire, dependencies.settleMs);
      pending.unref();
    },
    cancel(): void {
      if (pending === null) return;
      clearTimeout(pending);
      pending = null;
    },
  };
}
