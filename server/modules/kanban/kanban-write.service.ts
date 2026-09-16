import type { Database } from 'better-sqlite3';

import { getConnection, kanbanBoardsDb, kanbanCardsDb, kanbanEventsDb } from '@/modules/database/index.js';
import type { KanbanEventKind, KanbanEventRow, KanbanLaneCount } from '@/shared/kanban-types.js';
import type { KanbanBoardEvent } from '@/shared/types.js';

import { broadcastKanbanEvent } from './kanban-broadcast.service.js';

/**
 * What one write is, before it runs.
 *
 * `boardId` is a plain string for the twenty-six kinds whose board already exists. It is a
 * FUNCTION for the one kind that creates its board: `board.created` mints the board's id from
 * `kanban_id_seq` INSIDE the transaction (so two concurrent creates cannot collide), which means
 * the id does not exist when the spec is written. A function of the mutation's result is how the
 * event row and the frame learn it, after `mutate` has run and before the transaction commits.
 */
export type KanbanWriteSpec<T> = {
  kind: KanbanEventKind;
  boardId: string | ((value: T) => string);
  cardId?: string | null;
  actor?: string;
  payload?: Record<string, unknown>;
};

/**
 * THE write seam: every write in this module goes through this function, and nothing else in it
 * ever opens a transaction, inserts a `kanban_events` row or sends a frame.
 *
 * Twenty-seven verbs each hand-copying a transaction, an event and a fan-out is twenty-seven
 * chances to forget one — and the two failures that look alike are opposite bugs: an event
 * written OUTSIDE the transaction survives a rolled-back write, and a frame sent INSIDE it tells
 * every client about a write that then rolls back. One place to be right.
 *
 * The order is fixed:
 *   1. open ONE transaction,
 *   2. run `mutate` in it and keep what it returned,
 *   3. append the audit row in that same transaction,
 *   4. commit,
 *   5. and only then — outside the transaction — read the affected card's fresh summary and the
 *      board's lane totals, build the frame and broadcast it.
 *
 * A throw in step 5 is caught and logged: the write has already committed, and a dead socket must
 * not turn a committed write into a 500. A verb that needs two writes to be atomic does both
 * inside ONE `mutate` callback — never two `writeKanban` calls.
 */
export function writeKanban<T>(spec: KanbanWriteSpec<T>, mutate: (db: Database) => T): T {
  const db = getConnection();
  const actor = spec.actor ?? 'operator';
  const cardId = spec.cardId ?? null;
  const payload = spec.payload ?? {};

  const commit = db.transaction((): { value: T; boardId: string; event: KanbanEventRow } => {
    const value = mutate(db);
    // Resolved here, not before: a board create mints its id in this transaction, so the audit
    // row can only name the board from what the mutation returned.
    const boardId = typeof spec.boardId === 'function' ? spec.boardId(value) : spec.boardId;
    const event = kanbanEventsDb.recordEvent({ kind: spec.kind, boardId, cardId, actor, payload });
    return { value, boardId, event };
  });

  const { value, boardId, event } = commit();

  try {
    // Read AFTER the commit, so the frame carries what landed rather than what was intended.
    const card = cardId === null ? null : kanbanCardsDb.getSummary(cardId);
    const lanes: KanbanLaneCount[] = kanbanBoardsDb.laneCounts(boardId);
    const frame: KanbanBoardEvent = {
      kind: 'kanban_event',
      boardId,
      event: { id: event.id, ts: event.ts, kind: event.kind, cardId: event.cardId, actor: event.actor },
      card,
      lanes,
      at: Date.now(),
    };

    broadcastKanbanEvent(frame);
  } catch (error) {
    console.error(
      `[Kanban] committed ${spec.kind} but could not broadcast its frame: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return value;
}
