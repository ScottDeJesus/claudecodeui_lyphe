import type { Database } from 'better-sqlite3';

import { getConnection, kanbanBoardsDb, kanbanCardsDb, kanbanEventsDb } from '@/modules/database/index.js';
import type { KanbanCardSummary, KanbanEventKind, KanbanEventRow, KanbanLaneCount } from '@/shared/kanban-types.js';
import type { KanbanBoardEvent } from '@/shared/types.js';

import { broadcastKanbanEvent } from './kanban-broadcast.service.js';

/**
 * What one write is, before it runs.
 *
 * `boardId` is a plain string for the kinds whose board already exists. It is a FUNCTION for the
 * kinds whose board is only known once the mutation has run — `board.created` mints its board's id
 * from `kanban_id_seq` INSIDE the transaction (so two concurrent creates cannot collide), which
 * means the id does not exist when the spec is written, and a lesson names its board only through
 * the card it came from. A function of the mutation's result is how the event row and the frame
 * learn it, after `mutate` has run and before the transaction commits.
 *
 * It is NULLABLE for the writes that genuinely have no board. A staged lesson is the first: it
 * belongs to the ESTATE, not to a board, because a build's note about how a task went is worth
 * keeping whether or not it grew out of a card — and `kanban_events.board_id` is already `TEXT
 * NULL` (`kanban-schema.ts:138`) for exactly that reason. The alternative was a twenty-eighth verb
 * inventing a board to hang the note on, which would have put a lie in the audit log and painted
 * some innocent board's lane counts; the seam admits `null` instead and the frame carries it.
 *
 * `payload` takes the same two forms for the same reason: an event that cannot name its own subject
 * is an event a reader has to guess at, and the subject is often the id the mutation just minted. A
 * staged lesson has no card to point at, so its `lesson_id` in the payload is the ONLY identifier
 * it has — and that id does not exist until `mutate` has run.
 *
 * `afterEvent` is the seam's last step inside the transaction, for a side effect that cannot be
 * rolled back on its own. A file written here lands only once the audit row is in, so a failed
 * append leaves nothing on disk behind it — while a failed write still rolls the row and its event
 * back, because all three are in the one transaction.
 */
export type KanbanWriteSpec<T> = {
  kind: KanbanEventKind;
  boardId: string | null | ((value: T) => string | null);
  cardId?: string | null;
  actor?: string;
  payload?: Record<string, unknown> | ((value: T) => Record<string, unknown>);
  afterEvent?: (value: T) => void;
};

/**
 * One committed write as a listener sees it — the resolved board id and payload exactly as the audit
 * row holds them, and the card's summary read after the commit (null for a write with no card, or
 * when the read failed).
 */
export type KanbanWriteEvent = {
  kind: KanbanEventKind;
  boardId: string | null;
  cardId: string | null;
  actor: string;
  payload: Record<string, unknown>;
  card: KanbanCardSummary | null;
};

const listeners = new Set<(event: KanbanWriteEvent) => void>();

/**
 * Subscribes to every committed board write, and returns the function that unsubscribes.
 *
 * A listener rather than an import, because the board never learns who listens — the dispatch module
 * subscribes from its own mount, and nothing here names it. A listener also cannot reach inside the
 * transaction: it is told only after the commit, so it can never see a write that rolled back.
 */
export function onKanbanWrite(listener: (event: KanbanWriteEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

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
 *   4. run the spec's `afterEvent`, if it has one — still in the transaction, so a side effect that
 *      cannot be rolled back on its own lands only after the audit row is in,
 *   5. commit,
 *   6. and only then — outside the transaction — read the card's fresh summary once, build the frame
 *      and broadcast it, then call every listener (`onKanbanWrite`), each in its own try.
 *
 * A throw in step 6 is caught and logged, listeners included: the write has already committed, and
 * a dead socket or a faulty listener must not turn a committed write into a 500. A verb that needs
 * two writes to be atomic does both inside ONE `mutate` callback — never two `writeKanban` calls.
 */
export function writeKanban<T>(spec: KanbanWriteSpec<T>, mutate: (db: Database) => T): T {
  const db = getConnection();
  const actor = spec.actor ?? 'operator';
  const cardId = spec.cardId ?? null;

  const commit = db.transaction((): { value: T; boardId: string | null; payload: Record<string, unknown>; event: KanbanEventRow } => {
    const value = mutate(db);
    // Resolved here, not before: a board create mints its id in this transaction, so the audit
    // row can only name the board from what the mutation returned.
    const boardId = typeof spec.boardId === 'function' ? spec.boardId(value) : spec.boardId;
    // The payload is resolved here for the same reason — a minted id is part of what `mutate`
    // returns, and an event that cannot name its own subject is an event a reader has to guess at.
    const payload = typeof spec.payload === 'function' ? spec.payload(value) : spec.payload ?? {};
    const event = kanbanEventsDb.recordEvent({ kind: spec.kind, boardId, cardId, actor, payload });
    // LAST inside the transaction, and the position is the point: a side effect nothing can roll
    // back on its own (a file on disk) belongs after the audit row, so a failed append leaves
    // nothing behind it. A failure HERE still rolls the row and its event back.
    spec.afterEvent?.(value);
    return { value, boardId, payload, event };
  });

  const { value, boardId, payload, event } = commit();

  // Read AFTER the commit, so the frame and the listeners carry what landed rather than what was
  // intended. Read once and shared: the frame and every listener must describe the same card state.
  let card: KanbanCardSummary | null = null;
  try {
    card = cardId === null ? null : kanbanCardsDb.getSummary(cardId);
  } catch (error) {
    console.error(
      `[Kanban] committed ${spec.kind} but could not read card ${cardId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    // A boardless write has no lane totals to read — and `laneCounts(null)` would ask a board
    // query for every card whose board is NULL, which is not a board at all. `[]` is the honest
    // answer: there are no lanes, and the frame still goes out so the write has a signal on the
    // wire. Every consumer already tests the board id before it trusts a frame's counts.
    const lanes: KanbanLaneCount[] = boardId === null ? [] : kanbanBoardsDb.laneCounts(boardId);
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

  // Each listener gets its own try so a faulty one cannot turn a committed write into a 500 or keep
  // the listeners after it from hearing the write. The copy means a listener that unsubscribes
  // mid-loop cannot make the loop skip the one after it.
  for (const listener of [...listeners]) {
    try {
      listener({ kind: spec.kind, boardId, cardId, actor, payload, card });
    } catch (error) {
      console.error(
        `[Kanban] committed ${spec.kind} but a write listener threw: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return value;
}
