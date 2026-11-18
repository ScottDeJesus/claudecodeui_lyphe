import { useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** The last thing a chat said: its words as written (markdown), the model that wrote them and when; the last two null where the row carries none. */
export type LatestReply = { text: string; model: string | null; at: string | null };

/** How many of a chat's newest rows are read to find its last words: a turn's tool calls stand after them, and a long turn has many. */
const TAIL_ROWS = 40;

/** The newest row that is the chat's own words, from a page of its rows (oldest first), or null where the page holds none. */
function lastWordsOf(rows: unknown): LatestReply | null {
  if (!Array.isArray(rows)) return null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index] as { kind?: unknown; role?: unknown; content?: unknown; model?: unknown; timestamp?: unknown } | null;
    if (row === null || typeof row !== 'object' || row.kind !== 'text' || row.role !== 'assistant') continue;
    if (typeof row.content !== 'string' || row.content.trim() === '') continue;
    return { text: row.content, model: typeof row.model === 'string' ? row.model : null, at: typeof row.timestamp === 'string' ? row.timestamp : null };
  }
  return null;
}

/**
 * THE LAST THING A CHAT SAID, WHOLE, for the chat's panel on the station (`ChatStage`): its sessions row carries one line of what
 * the chat is doing, and the panel is where its reply is read in full. Read from the chat's own stored rows, the tail-paged route the
 * chat itself reads (`api.providers.sessionMessages`), `TAIL_ROWS` rows from the end.
 *
 * READ AGAIN WHEN THE CHAT MOVES: `movedAt` is the chat's `updatedAt` as the station's sessions hold it, which the station keeps on
 * events, so no timer and no poll stand behind this. The reply already held stays drawn while the newer one is read.
 *
 * `undefined` until the first read lands; `null` when the chat has said nothing in those rows, or the read failed (the panel then
 * shows the chat's one line and nothing under it, never a fault for a thing it can do without).
 */
export function useLatestReply(sessionId: string, movedAt: string | null): LatestReply | null | undefined {
  // The newest reading, with the chat it was read from: a reading of another chat is never drawn under this one.
  const [held, setHeld] = useState<{ sessionId: string; reply: LatestReply | null } | null>(null);

  useEffect(() => {
    let current = true;
    api.providers.sessionMessages(sessionId, { limit: TAIL_ROWS, offset: 0 })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const data = body?.data ?? body;
        if (current) setHeld({ sessionId, reply: lastWordsOf(data?.messages) });
      })
      .catch(() => {
        if (current) setHeld((before) => (before !== null && before.sessionId === sessionId ? before : { sessionId, reply: null }));
      });
    return () => { current = false; };
  }, [sessionId, movedAt]);

  return held !== null && held.sessionId === sessionId ? held.reply : undefined;
}
