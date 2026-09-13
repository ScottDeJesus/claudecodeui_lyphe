/**
 * Collapses a burst of same-key pushes into the first push plus one summary.
 *
 * Leading edge, never a debounce: the first push of a key goes out at once —
 * a "Claude needs you" buzz must not wait on a timer — and every repeat inside
 * the window is only counted. When the window closes with repeats counted, the
 * caller is told once how many, so it can send one summary instead of a storm.
 */

const DEFAULT_WINDOW_MS = 60_000;

/**
 * Creates one independent set of windows. Consumed by the ntfy channel.
 *
 * `admit(key)` answers true for the first call of a key in a window (and opens
 * the window) and false for every later call until it closes. At the close,
 * `onWindowClose(key, suppressedCount)` runs only when something was
 * suppressed. Timers are `unref()`ed, so an open window never holds the
 * process alive.
 */
export function createFloodControl(options: {
  windowMs?: number;
  onWindowClose: (key: string, suppressedCount: number) => void;
}): { admit(key: string): boolean } {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const suppressedByKey = new Map<string, number>();

  function closeWindow(key: string): void {
    const suppressedCount = suppressedByKey.get(key) ?? 0;
    suppressedByKey.delete(key);
    if (suppressedCount === 0) return;
    try {
      options.onWindowClose(key, suppressedCount);
    } catch (error) {
      // A timer callback that throws would surface as an uncaught exception; log and move on.
      console.warn('[ntfy] flood window close failed', error instanceof Error ? error.message : error);
    }
  }

  return {
    admit(key: string): boolean {
      const suppressedCount = suppressedByKey.get(key);
      if (suppressedCount !== undefined) {
        suppressedByKey.set(key, suppressedCount + 1);
        return false;
      }
      suppressedByKey.set(key, 0);
      setTimeout(() => closeWindow(key), windowMs).unref();
      return true;
    },
  };
}
