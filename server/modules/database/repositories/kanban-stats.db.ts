import { getConnection } from '@/modules/database/connection.js';
import type { KanbanPriority, KanbanStatus } from '@/shared/kanban-types.js';

/**
 * The read-only statements behind the board's stats and changelog: the open cards, the cards
 * fixed and opened since a cutoff, and the changelog lines of fixed cards. Each statement only
 * reads rows; counting, averaging, and ordering for display happen in the service.
 *
 * Every read takes one scope, `boardId`: a board id reads that board's cards, and null reads
 * every board that is not archived. The id is bound with `?`, never interpolated.
 *
 * Rows keep SQLite's snake_case column aliases; the service maps them to its own shapes.
 *
 * The constants below are spelled into the SQL text rather than bound: they are this file's own
 * fixed words, never caller input, so only the scope's board id and the caller's cutoff and limit
 * are bound.
 *
 * Consumers: `kanban-stats.service.ts`.
 * Reach it through `@/modules/database/index.js`.
 */

/** The stored value of `archived` on a card or board that is still in use. */
const NOT_ARCHIVED = 0;

/** The status a fixed card carries; the fixed-card reads filter on it. */
const DONE_STATUS: KanbanStatus = 'done';

/** A card with no changelog text has nothing to say, so it is stored as an empty string. */
const EMPTY_CHANGELOG = '';

/** The event that records a card being opened; a card's creator is the actor of its oldest creation event. */
const CARD_CREATED_EVENT_KIND = 'card.created';

/** The imported board's spelling of a card's creation; its cards were created under this kind, so it counts alongside `card.created`. */
const FEATURE_CREATED_EVENT_KIND = 'feature.created';

/** Tags a card that reopens an earlier fix; the tag is `regression-of:<earlier card id>`. */
const REGRESSION_TAG_PATTERN = 'regression-of:%';

/** One open card as the stats reader sees it; the service reads the front of the list for its oldest cards. */
export type KanbanStatsOpenRow = {
  id: string;
  board_id: string;
  board_name: string;
  title: string;
  priority: KanbanPriority;
  status: KanbanStatus;
  created_at: string;
};

/** One fixed card with the two timestamps the service needs to measure how long it took to fix. */
export type KanbanStatsFixedRow = {
  priority: KanbanPriority;
  created_at: string;
  done_at: string;
};

/** One card opened since the cutoff, with who opened it and whether it reopens an earlier fix. */
export type KanbanStatsCreatedRow = {
  id: string;
  created_at: string;
  status: KanbanStatus;
  archived: number;
  creator: string | null;
  came_back: number;
};

/** One fixed card that has a changelog line, with the fields the changelog lists it under. */
export type KanbanStatsChangelogRow = {
  id: string;
  board_id: string;
  board_name: string;
  title: string;
  changelog: string;
  done_at: string;
};

/**
 * The WHERE fragment that limits a read to one board's cards, or to every board not archived,
 * with the values its placeholders take.
 *
 * The null branch picks the live boards by subquery, so cards on an archived board drop out of
 * every stats read without the service filtering them.
 */
function scopeOf(boardId: string | null): { clause: string; values: string[] } {
  if (boardId === null) {
    return {
      clause: `c.board_id IN (SELECT id FROM kanban_boards WHERE archived = ${NOT_ARCHIVED})`,
      values: [],
    };
  }
  return { clause: 'c.board_id = ?', values: [boardId] };
}

/**
 * The stats reads, one method per question the service asks. Each takes the board scope first.
 */
export const kanbanStatsDb = {
  /**
   * Every open card in scope, oldest first (`created_at` ASC, then `id` ASC).
   *
   * Open means not archived and not done: an archived card is off the board, and a done card is
   * no longer waiting. The order is part of the contract, because the service takes its ten
   * oldest cards and its oldest high-priority card from the front of this list.
   */
  openCards(boardId: string | null): KanbanStatsOpenRow[] {
    const scope = scopeOf(boardId);
    const db = getConnection();
    return db
      .prepare(
        `SELECT c.id, c.board_id, b.name AS board_name, c.title, c.priority, c.status, c.created_at
         FROM kanban_cards AS c
         JOIN kanban_boards AS b ON b.id = c.board_id
         WHERE ${scope.clause}
           AND c.archived = ${NOT_ARCHIVED}
           AND c.status <> '${DONE_STATUS}'
         ORDER BY c.created_at ASC, c.id ASC`
      )
      .all(...scope.values) as KanbanStatsOpenRow[];
  },

  /**
   * Every card in scope fixed (status done) at or after the cutoff.
   *
   * Archived cards count here: a card fixed and then archived was still fixed in the window. The
   * cutoff compares as plain text, which is correct only because `done_at` and `sinceIso` are both
   * ISO-8601 strings with a trailing Z, so they sort the same way as the instants they name.
   */
  fixedSince(boardId: string | null, sinceIso: string): KanbanStatsFixedRow[] {
    const scope = scopeOf(boardId);
    const db = getConnection();
    return db
      .prepare(
        `SELECT c.priority, c.created_at, c.done_at
         FROM kanban_cards AS c
         WHERE ${scope.clause}
           AND c.status = '${DONE_STATUS}'
           AND c.done_at >= ?`
      )
      .all(...scope.values, sinceIso) as KanbanStatsFixedRow[];
  },

  /**
   * Every card in scope opened at or after the cutoff, archived ones included: a card opened and
   * then archived was still opened in the window.
   *
   * `creator` is the actor of the card's oldest creation event, or null when no such event was
   * recorded. `came_back` is 1 when the card carries a `regression-of:` tag. Both are read here, in
   * the same query, so the service does not need one extra read per card.
   */
  createdSince(boardId: string | null, sinceIso: string): KanbanStatsCreatedRow[] {
    const scope = scopeOf(boardId);
    const db = getConnection();
    return db
      .prepare(
        `SELECT
           c.id,
           c.created_at,
           c.status,
           c.archived,
           (SELECT e.actor
              FROM kanban_events AS e
             WHERE e.card_id = c.id
               AND e.kind IN ('${CARD_CREATED_EVENT_KIND}', '${FEATURE_CREATED_EVENT_KIND}')
             ORDER BY e.id ASC
             LIMIT 1) AS creator,
           EXISTS (SELECT 1
                     FROM kanban_card_tags AS t
                    WHERE t.card_id = c.id
                      AND t.tag LIKE '${REGRESSION_TAG_PATTERN}') AS came_back
         FROM kanban_cards AS c
         WHERE ${scope.clause}
           AND c.created_at >= ?`
      )
      .all(...scope.values, sinceIso) as KanbanStatsCreatedRow[];
  },

  /**
   * The changelog lines of fixed cards in scope, newest fix first (`done_at` DESC, then `id` DESC),
   * capped at `limit` rows.
   *
   * A card with an empty changelog has no line to say and is skipped. Archived cards are included:
   * a fixed card's line stays true after the card is archived. A null `sinceIso` leaves the window
   * open at the start; the value is bound twice because the `IS NULL` test and the comparison each
   * need it.
   */
  changelogEntries(
    boardId: string | null,
    sinceIso: string | null,
    limit: number
  ): KanbanStatsChangelogRow[] {
    const scope = scopeOf(boardId);
    const db = getConnection();
    return db
      .prepare(
        `SELECT c.id, c.board_id, b.name AS board_name, c.title, c.changelog, c.done_at
         FROM kanban_cards AS c
         JOIN kanban_boards AS b ON b.id = c.board_id
         WHERE ${scope.clause}
           AND c.status = '${DONE_STATUS}'
           AND c.done_at IS NOT NULL
           AND c.changelog <> '${EMPTY_CHANGELOG}'
           AND (? IS NULL OR c.done_at >= ?)
         ORDER BY c.done_at DESC, c.id DESC
         LIMIT ?`
      )
      .all(...scope.values, sinceIso, sinceIso, limit) as KanbanStatsChangelogRow[];
  },
};
