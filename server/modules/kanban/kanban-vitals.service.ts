import { getConnection } from '@/modules/database/index.js';
import { KANBAN_LEASE_STALE_SECONDS, type KanbanVitals } from '@/shared/kanban-types.js';

import { requireBoard } from './kanban-cards.guards.js';

/**
 * The board header's six counts, in ONE round trip.
 *
 * `store_actionable.py:307-345` is the shape this is ported from: five scalar sub-SELECTs in one
 * statement, so the strip of registers costs one query rather than six, and every one of them
 * excludes archived cards. What a card IS, per register:
 *
 * - `building` — cards in the Building lane (`status = 'active'`), which is where a build lease
 *   puts them and where they stay until the builder moves them on.
 * - `awaitingAnswer` — cards with at least one question nobody has answered: the operator's turn,
 *   and the panel's own `needsAnswer`.
 * - `awaitingApprove` — the SAFE approve subset (`store_actionable.py`'s "GOTCHAS #48" mirror):
 *   not yet approved, no open question, sitting in a claimable/staging lane
 *   (`todo`/`questions`/`not_ready`), and content-complete — a non-blank plan, body or description,
 *   because an intake card carries its intent in `description` with `body` empty.
 * - `claimable` — the same predicate `kanbanBoardsDb.countClaimable` grants a claim by, read
 *   against the same staleness window, so the driver's green light and this register never disagree.
 * - `lessonsPendingEstate` — STAGED lessons awaiting a person's review. It is on the board's own
 *   lesson table and it is NOT board-scoped: a lesson belongs to the estate and its card is
 *   provenance, so there is no board filter here to get wrong.
 *
 * The sixth, `memoryPendingEstate`, is handed IN as `estate.memoryPending`, because the rows behind
 * it are `memory_candidates` and this module never imports memory-intake: the board cannot see that
 * lane's table, and a count it computed for itself would be the board reading a sibling's rows
 * sideways. The composition root reads it from the lane and passes it down (Interfaces §7).
 *
 * EVERY ESTATE-WIDE KEY CARRIES THE WORD IN ITS NAME — `lessonsPendingEstate`,
 * `memoryPendingEstate` — so no caller can read a number taken across the whole install as one
 * board's own. A board id never implies a board scope here; the name does.
 *
 * READ-ONLY: no transaction, no audit row, no frame. A missing board is the ordinary 404 the
 * sibling registers answer with, not a zero — "no such board" and "a board with nothing on it" are
 * different answers and this service does not blur them.
 *
 * A FAULT IS NOT CAUGHT, and that is a ruling rather than an omission. The program this is ported
 * from degrades to zeros (`store_actionable.py:333`, "must NEVER 500 or hang on a board-count
 * hiccup") because it feeds a terminal status bar. This feeds an authenticated board header whose
 * siblings — `lanes`, `claimable`, every card read on the same panel — fail loudly through the
 * global handler, and zeros here would not be calm but WRONG: `src/shared/kanban-types.ts` states
 * the strip's rule in the client's own words, "Zero is a count; an unknown reading is not — the
 * strip draws it as an em-dash, never as 0", and the wire shape has no null to say "unknown" with.
 * A refusal is therefore the only honest way this read says "I could not count", and it is the one
 * the panel already draws as an em-dash.
 */

/** The estate-wide readings this module cannot compute for itself, handed in by the composition root. */
export type KanbanEstateReadings = {
  /** Pending memory candidates across the whole install — `memory-intake`'s own count. */
  memoryPending: number;
};

/** One row of the vitals statement, as SQLite spells its columns. */
type VitalsRow = {
  building: number;
  awaiting_answer: number;
  awaiting_approve: number;
  lessons_pending_estate: number;
  claimable: number;
};

/** A whole number off a COUNT column: SQLite hands back a number, and a missing row is nothing. */
function readCount(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

/**
 * The six registers for one board. A board that is not there is a 404, thrown before any count is
 * taken so a stale tab naming a deleted board hears that rather than a board of zeros.
 */
export function vitalsCounts(boardId: string, estate: KanbanEstateReadings): KanbanVitals {
  requireBoard(boardId);

  // The same window `countClaimable` judges a build lease by, so a card stranded by a dead builder
  // reads as claimable in both places at the same instant rather than one tick apart.
  const staleBefore = new Date(Date.now() - KANBAN_LEASE_STALE_SECONDS * 1000).toISOString();

  const row = getConnection()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM kanban_cards c
          WHERE c.board_id = ? AND c.archived = 0 AND c.status = 'active') AS building,
         (SELECT COUNT(*) FROM kanban_cards c
          WHERE c.board_id = ? AND c.archived = 0 AND EXISTS (
            SELECT 1 FROM kanban_questions q
            WHERE q.card_id = c.id AND q.answered = 0)) AS awaiting_answer,
         (SELECT COUNT(*) FROM kanban_cards c
          WHERE c.board_id = ? AND c.archived = 0 AND c.approved = 0
            AND c.status IN ('todo', 'questions', 'not_ready')
            AND NOT EXISTS (
              SELECT 1 FROM kanban_questions q
              WHERE q.card_id = c.id AND q.answered = 0)
            AND (TRIM(COALESCE(c.plan, '')) != ''
              OR TRIM(c.body) != ''
              OR TRIM(c.description) != '')) AS awaiting_approve,
         (SELECT COUNT(*) FROM kanban_lessons
          WHERE status = 'staged') AS lessons_pending_estate,
         (SELECT COUNT(*) FROM kanban_cards c
          WHERE c.board_id = ? AND c.archived = 0
            AND (c.status = 'todo'
              OR (c.status = 'active'
                AND (c.build_lease_at IS NULL OR c.build_lease_at < ?)))) AS claimable`
    )
    .get(boardId, boardId, boardId, boardId, staleBefore) as VitalsRow | undefined;

  return {
    building: readCount(row?.building),
    awaitingAnswer: readCount(row?.awaiting_answer),
    awaitingApprove: readCount(row?.awaiting_approve),
    lessonsPendingEstate: readCount(row?.lessons_pending_estate),
    memoryPendingEstate: readCount(estate.memoryPending),
    claimable: readCount(row?.claimable),
  };
}
