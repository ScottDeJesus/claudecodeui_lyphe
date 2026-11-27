/**
 * The one subscriber seam of the sessions watcher's flush.
 *
 * A flush is the moment the watcher has broadcast `session_upserted` for every transcript it indexed
 * since the last one; a module that must react to "a transcript moved" (the DeepSeek usage hint, the
 * running-sessions lane) subscribes here rather than opening a watcher of its own on the same roots.
 * Re-exported by `sessions-watcher.service.ts`, which is the only caller of `announceSessionsFlushed`.
 */
export type SessionsFlushedListener = (sessionIds: readonly string[]) => void;

const listeners = new Set<SessionsFlushedListener>();

/** Subscribes to every flush; answers the unsubscribe. */
export function onSessionsFlushed(listener: SessionsFlushedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Tells every listener the ids one flush has just broadcast. A listener that throws is logged and
 * skipped: the broadcast already landed, and one subscriber's fault must not silence the others.
 */
export function announceSessionsFlushed(sessionIds: readonly string[]): void {
  for (const listener of [...listeners]) {
    try {
      listener(sessionIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('A sessions-flushed listener threw', { sessionCount: sessionIds.length, error: message });
    }
  }
}
