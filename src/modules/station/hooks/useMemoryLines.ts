import { useCallback, useEffect, useRef, useState } from 'react';

import { api, errorMessage, refusalSentence } from '@/shared/api';
import type { CompanionMemoryLine, CompanionMemoryLines } from '@/shared/companion-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/** Whether `value` is text or null: the shape of the fields a memory may not record. */
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** Whether `value` is a memory this page can draw: a token, a title and a kind, and the three fields a row may not record. */
function isMemoryLine(value: unknown): value is CompanionMemoryLine {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.token === 'string' && typeof row.title === 'string' && typeof row.kind === 'string'
    && isTextOrNull(row.saidAt) && isTextOrNull(row.account) && isTextOrNull(row.quote);
}

/**
 * Whether `value` is what `GET /api/companion/memory/lines` answers. A 200 that is not (a proxy's page, a server of another build)
 * is a failed read, never a bank that holds nothing.
 */
function isMemoryLines(value: unknown): value is CompanionMemoryLines {
  if (typeof value !== 'object' || value === null) return false;
  const { count, pageId, reason, lines } = value as Record<string, unknown>;
  return (count === null || typeof count === 'number') && typeof pageId === 'string' && isTextOrNull(reason)
    && Array.isArray(lines) && lines.every(isMemoryLine);
}

/** What the page holds of her memory: the last good reading, and why the read after it failed. Held whole so one update changes both. */
type Held = { lines: CompanionMemoryLines | null; failure: string | null };

/**
 * Used by the station's memory corner (`MemoryCorner`), which draws "What I'm keeping" from what it returns.
 *
 * THE PAGE'S READ OF HER MEMORY: one `GET /api/companion/memory/lines` at mount, another on every `companion_memory` frame (the
 * server sends it after each write of her bank that landed, or may have) and another on `websocket_reconnected` (a frame sent
 * while the socket was down is lost, and the read has it). Nothing polls. The frame is a hint, not a picture: it carries nothing,
 * and the answer to it is always "read the list again". Her bank is the account's and no page's, so the call names no client.
 *
 * ONE READ IN FLIGHT AND ONE QUEUED: a hint that comes while a read is out may have been written after that read was answered, so
 * it queues one more read, run the moment the first lands; any number of hints in that time are the one. Reads therefore never
 * overlap, and the answer that lands is always the newest asked for. The subscription is made BEFORE the first read, so a frame
 * that lands between the two starts a read of its own.
 *
 * `lines` is the last good reading, null until one lands. A bank the door could not read is a reading too (`count: null` with
 * its `reason`), not a failure. `failure` is why the read itself failed (the route's own sentence, or the page's: never a browser's words): it stands over
 * `lines`, and the next read that lands clears it. The corner reads and never writes her memory.
 */
export function useMemoryLines(): { lines: CompanionMemoryLines | null; failure: string | null; reread(): void } {
  const { subscribe } = useWebSocket();
  // The last good reading and why the read after it failed. State, because the corner draws both and a read that lands must re-draw it.
  const [held, setHeld] = useState<Held>({ lines: null, failure: null });

  // Whether a read is out. A ref: it decides whether a hint starts a read or queues one, and nothing is drawn from it.
  const readingRef = useRef(false);
  // Whether a hint came while a read was out, and so one more read is owed. A ref for the same reason.
  const queuedRef = useRef(false);
  // False once the hook unmounted: a read that lands then sets nothing. Set true by each mount, so a strict-mode remount revives the read the first mount started.
  const aliveRef = useRef(false);

  /** One read of the route, landed into `held`. Never throws: a failed read is `failure`. */
  const readOnce = useCallback(async () => {
    try {
      // The corner draws `failure` as its own sentence, so a browser's words ("Failed to fetch", "Unexpected token '<'") never reach it:
      // a request that never answered and a body that is not JSON each become the page's sentence, the raw error kept in the log.
      const response = await api.companion.memory.lines().catch((error: unknown) => {
        console.warn('[Station] The memory route did not answer:', error);
        return null;
      });
      if (response === null) throw new Error('the server did not answer');
      if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
      const body: unknown = await response.json().catch(() => null);
      if (!isMemoryLines(body)) throw new Error('the answer was not a list of her memories this page can draw');
      if (aliveRef.current) setHeld({ lines: body, failure: null });
    } catch (error) {
      // The next hint or reconnect, or Try again, reads again; there is no retry loop to run here.
      console.warn('[Station] Could not read her memory:', error);
      if (aliveRef.current) setHeld((current) => ({ ...current, failure: errorMessage(error) ?? 'the request failed' }));
    }
  }, []);

  /** Asks for a read: starts one when none is out, else owes exactly one more, which runs when the one out has landed. */
  const request = useCallback(() => {
    if (readingRef.current) {
      queuedRef.current = true;
      return;
    }
    readingRef.current = true;
    void (async () => {
      try {
        do {
          queuedRef.current = false;
          await readOnce();
        } while (queuedRef.current && aliveRef.current);
      } finally {
        readingRef.current = false;
      }
    })();
  }, [readOnce]);

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'companion_memory' || event.kind === 'websocket_reconnected') request();
    });
    // Strict mode mounts twice in development: the second mount finds the first one's read out, and that read is this mount's
    // own first read, so it asks for no second.
    if (!readingRef.current) request();
    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
  }, [subscribe, request]);

  /** The corner's Try again. While nothing has been read, the failure gives way to the waiting state as the read goes out. */
  const reread = useCallback(() => {
    setHeld((current) => (current.lines === null ? { lines: null, failure: null } : current));
    request();
  }, [request]);

  return { lines: held.lines, failure: held.failure, reread };
}
