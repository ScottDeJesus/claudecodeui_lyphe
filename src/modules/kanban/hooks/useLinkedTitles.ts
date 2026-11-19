import { useCallback, useEffect, useRef, useState } from 'react';

import type { KanbanLinkedTitle } from '@/modules/kanban/utils/walkModel';
import { api, readApiJson } from '@/shared/api';
import type { KanbanCardDetail, KanbanCardSummary } from '@/shared/kanban-types';

/**
 * What the board knows of another of its cards, by id, for a link row: its title, `'unread'`, or `'gone'`.
 *
 * A LOADED CARD IS READ OFF THE LANES (`summaryOf`), so its title is the live one. A CARD NO LOADED
 * PAGE HOLDS (archived, further down a lane) IS READ ONCE BY ID, and `'unread'` is the answer only
 * while that read is out.
 *
 * A 404 IS `'gone'`, the card was deleted, and its link is then words with no press. A READ THAT
 * FAILS OTHERWISE IS NOT RETRIED on every render: it stays `'unread'` until the board changes,
 * because a link is not worth a request loop.
 *
 * THE ANSWERS BELONG TO ONE BOARD and are dropped when the board changes.
 *
 * WHY THE READ IS STARTED OUTSIDE RENDER: `titleOf` is called while the faces and the drawer render,
 * so it only queues an id, and the queue is drained in a microtask, never inside a render.
 */
export function useLinkedTitles(
  boardId: string | null,
  summaryOf: (cardId: string) => KanbanCardSummary | null,
): (cardId: string) => KanbanLinkedTitle {
  const [known, setKnown] = useState<{
    boardId: string | null;
    titles: Record<string, KanbanLinkedTitle>;
  }>({ boardId, titles: {} });
  const asked = useRef(new Set<string>());
  const queued = useRef<string[]>([]);
  const draining = useRef(false);
  const boardRef = useRef(boardId);
  const mounted = useRef(true);

  useEffect(() => {
    // On mount the board has not changed; a reset then would drop the reads the first render queued and ask for them twice.
    if (boardRef.current === boardId) return;
    boardRef.current = boardId;
    asked.current = new Set();
    queued.current = [];
    setKnown({ boardId, titles: {} });
  }, [boardId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const read = useCallback(async (cardId: string, forBoard: string | null) => {
    let answer: KanbanLinkedTitle;
    try {
      const response = await api.kanban.card(cardId);
      if (response.status === 404) {
        answer = 'gone';
      } else {
        const body = await readApiJson<{ card: KanbanCardDetail }>(response);
        answer = { title: body.card.title };
      }
    } catch (error) {
      console.warn('[useLinkedTitles] a linked card could not be read:', cardId, error);
      return;
    }
    if (!mounted.current || boardRef.current !== forBoard) return;
    setKnown((held) =>
      held.boardId === forBoard
        ? { boardId: held.boardId, titles: { ...held.titles, [cardId]: answer } }
        : held,
    );
  }, []);

  const drain = useCallback(() => {
    draining.current = false;
    const ids = queued.current;
    queued.current = [];
    for (const id of ids) void read(id, boardRef.current);
  }, [read]);

  return useCallback(
    (cardId: string): KanbanLinkedTitle => {
      const summary = summaryOf(cardId);
      if (summary) return { title: summary.title };
      const held = known.boardId === boardId ? known.titles[cardId] : undefined;
      if (held !== undefined) return held;
      if (!asked.current.has(cardId)) {
        asked.current.add(cardId);
        queued.current.push(cardId);
        if (!draining.current) {
          draining.current = true;
          queueMicrotask(drain);
        }
      }
      return 'unread';
    },
    [summaryOf, known, boardId, drain],
  );
}
