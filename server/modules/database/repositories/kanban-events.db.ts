import { getConnection } from '@/modules/database/connection.js';
import type { KanbanEventKind, KanbanEventRow } from '@/shared/kanban-types.js';

/** One `kanban_events` row as SQLite holds it: `payload` is JSON text, not an object. */
type KanbanEventDbRow = {
  id: number;
  ts: string;
  kind: string;
  board_id: string | null;
  card_id: string | null;
  actor: string;
  payload: string;
};

/** How many rows a read returns when the caller names no limit. The route clamps to 200. */
const DEFAULT_EVENT_LIMIT = 50;

/**
 * Parses a stored payload back into an object.
 *
 * A row whose `payload` will not parse still travels — as an empty object rather than as a
 * sentence about JSON, because an audit line with a lost payload is still a fact worth showing,
 * and one bad row must not fail the read that lists it.
 */
function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toKanbanEventRow(row: KanbanEventDbRow): KanbanEventRow {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    boardId: row.board_id,
    cardId: row.card_id,
    actor: row.actor,
    payload: parsePayload(row.payload),
  };
}

/**
 * The board's audit log: one row per committed write, appended by the write seam and read by the
 * board's events route.
 *
 * Consumers: `kanban-write.service.ts` (its ONLY `recordEvent` caller — no verb, route or other
 * repository ever inserts an event), and `kanban-boards.service.ts`'s `listEvents`. Reach it
 * through `@/modules/database/index.js`.
 */
export const kanbanEventsDb = {
  /**
   * Appends one audit row and returns it as stored.
   *
   * Called from inside the write seam's transaction and nowhere else, which is what makes the
   * log exactly the set of writes that committed: a rolled-back write takes its event with it.
   * `ts` is ISO-8601 UTC, the same spelling every other `*_at` column uses.
   */
  recordEvent(input: {
    kind: KanbanEventKind;
    boardId: string | null;
    cardId: string | null;
    actor: string;
    payload: Record<string, unknown>;
  }): KanbanEventRow {
    const db = getConnection();
    const row = db
      .prepare(
        `INSERT INTO kanban_events (ts, kind, board_id, card_id, actor, payload)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id, ts, kind, board_id, card_id, actor, payload`
      )
      .get(
        new Date().toISOString(),
        input.kind,
        input.boardId,
        input.cardId,
        input.actor,
        JSON.stringify(input.payload)
      ) as KanbanEventDbRow | undefined;

    if (!row) {
      throw new Error(`Could not record the kanban event "${input.kind}".`);
    }

    return toKanbanEventRow(row);
  },

  /**
   * The newest rows first, optionally narrowed to one board and one card.
   *
   * Newest first is what makes the limit mean something: the board's newest write is what a panel
   * repaints from, and an imported Descent board's log runs to twelve thousand rows, so a read
   * that started at the oldest would spend its budget on history nobody asked to see.
   */
  listEvents(options: { boardId?: string; cardId?: string; limit?: number }): KanbanEventRow[] {
    const db = getConnection();
    const conditions: string[] = [];
    const values: string[] = [];

    if (options.boardId !== undefined) {
      conditions.push('board_id = ?');
      values.push(options.boardId);
    }
    if (options.cardId !== undefined) {
      conditions.push('card_id = ?');
      values.push(options.cardId);
    }

    const rows = db
      .prepare(
        `SELECT id, ts, kind, board_id, card_id, actor, payload FROM kanban_events
         ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(...values, options.limit ?? DEFAULT_EVENT_LIMIT) as KanbanEventDbRow[];

    return rows.map(toKanbanEventRow);
  },
};
