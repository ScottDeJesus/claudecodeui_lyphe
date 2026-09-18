import { getConnection } from '@/modules/database/connection.js';
import {
  clampKanbanConcurrency,
  type KanbanBoard,
  type KanbanLaneCount,
  type KanbanStatus,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The five statuses a lane count is reported for, in the schema's own order.
 *
 * This list is the board's STATUS vocabulary, not its lanes: a lane is a set of these, and which
 * set composes which lane is the panel's policy (`src/modules/kanban/utils/lanePolicy.ts`). That
 * is why `laneCounts` answers five rows and never fewer — a status with no cards is a row reading
 * zero, not an absent row, so the panel's sums never have to invent one.
 */
const BOARD_STATUSES: KanbanStatus[] = ['not_ready', 'todo', 'questions', 'active', 'done'];

/** One `kanban_boards` row as SQLite holds it: the booleans are 0 or 1, not true or false. */
type KanbanBoardRow = {
  id: string;
  name: string;
  project_id: string | null;
  autonomy: number;
  deepseek_flash: number;
  concurrency: number;
  sort_order: number;
  archived: number;
  created_at: string;
  updated_at: string;
};

/** Every column of a board, in one spelling, so no query is the odd one out. */
const BOARD_COLUMNS =
  'id, name, project_id, autonomy, deepseek_flash, concurrency, sort_order, archived, created_at, updated_at';

/**
 * One SQLite row to the `KanbanBoard` the rest of the server speaks.
 *
 * `autonomy`, `deepseekFlash` and `archived` become real booleans here and nowhere else: a `0`
 * reaching the wire is a panel whose autonomy switch reads as stuck, which is what the check
 * asserting `autonomy=False` exists to catch.
 *
 * `concurrency` is CLAMPED here, and this mapper is the right place for it: every read of a board
 * row in the whole server passes through this one conversion, so a value written by hand, left
 * behind by an older schema or set absurdly by a future caller cannot reach a comparison without
 * meeting the clamp first. The writes clamp too (`kanban-boards.service.ts`), because a number that
 * is never in range should not be stored either.
 */
function toKanbanBoard(row: KanbanBoardRow): KanbanBoard {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    autonomy: row.autonomy === 1,
    deepseekFlash: row.deepseek_flash === 1,
    concurrency: clampKanbanConcurrency(row.concurrency),
    sortOrder: row.sort_order,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The columns an update may touch, mapped to their SQL names. `id` is never one of them. */
const BOARD_PATCH_COLUMNS = {
  name: 'name',
  autonomy: 'autonomy',
  deepseekFlash: 'deepseek_flash',
  concurrency: 'concurrency',
  projectId: 'project_id',
  archived: 'archived',
} as const;

/** What an update may change. Every field is optional; an absent one is left exactly as it was. */
export type KanbanBoardUpdatePatch = {
  id: string;
  name?: string;
  autonomy?: boolean;
  deepseekFlash?: boolean;
  concurrency?: number;
  projectId?: string | null;
  archived?: boolean;
};

/**
 * Boards, their one settings row, and the per-status card totals.
 *
 * Consumers: `kanban-boards.service.ts` (every board verb), `kanban-write.service.ts` (a board is
 * named and its lanes read to build a frame), and `kanban-import.service.ts`. Reach it through
 * `@/modules/database/index.js`.
 *
 * Every method calls `getConnection()` itself, like every other repository here: the handle is a
 * singleton, so a call made while a transaction is open joins that transaction rather than
 * starting a second one — which is what lets `writeKanban` mint an id and insert a row atomically.
 */
export const kanbanBoardsDb = {
  /**
   * Inserts one board and returns it as stored. The id is the caller's, already minted.
   *
   * `sort_order` is assigned HERE and not passed in: a new board takes the top of the ladder,
   * one gap above the current highest. The alternative — every board created at 0 — leaves the
   * list ordered by `id ASC`, a STRING compare in which `b-10` sorts between `b-1` and `b-2`,
   * and that is the order the board switcher would render. The gap is 1000 so a later reorder
   * can splice a board between two others by midpoint without renumbering, the same rule the
   * cards' `sort_order` follows.
   *
   * `deepseek_flash` and `concurrency` are left to their columns' own defaults: a new board runs on
   * Claude and one session at a time, both of which are GOVERNORS its owner turns on rather than
   * settings a create has any business guessing at `0` or `4` for.
   */
  insertBoard(input: {
    id: string;
    name: string;
    projectId: string | null;
    autonomy: boolean;
  }): KanbanBoard {
    const db = getConnection();
    const now = new Date().toISOString();
    const row = db
      .prepare(
        `INSERT INTO kanban_boards (id, name, project_id, autonomy, sort_order, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(existing.sort_order), 0) + 1000 FROM kanban_boards AS existing), 0, ?, ?)
         RETURNING ${BOARD_COLUMNS}`
      )
      .get(input.id, input.name, input.projectId, input.autonomy ? 1 : 0, now, now) as
      | KanbanBoardRow
      | undefined;

    if (!row) {
      throw new AppError(`Could not create the kanban board "${input.name}".`, {
        code: 'KANBAN_BOARD_INSERT_FAILED',
        statusCode: 500,
      });
    }

    return toKanbanBoard(row);
  },

  /** One board by id, archived or not, or null when no such board exists. */
  getBoard(boardId: string): KanbanBoard | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${BOARD_COLUMNS} FROM kanban_boards WHERE id = ?`)
      .get(boardId) as KanbanBoardRow | undefined;

    return row ? toKanbanBoard(row) : null;
  },

  /**
   * The live board carrying a project, or null.
   *
   * An archived board is not an answer: the panel uses this on first mount to pick a board for
   * the project it was opened with, and re-adopting one the operator archived would undo their
   * decision on every remount.
   */
  getBoardByProject(projectId: string): KanbanBoard | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${BOARD_COLUMNS} FROM kanban_boards
         WHERE project_id = ? AND archived = 0
         ORDER BY sort_order ASC, id ASC
         LIMIT 1`
      )
      .get(projectId) as KanbanBoardRow | undefined;

    return row ? toKanbanBoard(row) : null;
  },

  /**
   * Every board, in `sort_order` — creation order, oldest first, because `insertBoard` assigns
   * each new board the next rung of the ladder. The `id ASC` tiebreak only ever decides boards
   * written before that ladder existed.
   *
   * Archived boards are OMITTED unless `includeArchived` is set. That default is load-bearing:
   * every probe in this project creates its board, archives it and re-runs, and re-running would
   * otherwise find one more live board each time.
   */
  listBoards(includeArchived: boolean): KanbanBoard[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT ${BOARD_COLUMNS} FROM kanban_boards
         ${includeArchived ? '' : 'WHERE archived = 0'}
         ORDER BY sort_order ASC, id ASC`
      )
      .all() as KanbanBoardRow[];

    return rows.map(toKanbanBoard);
  },

  /**
   * Applies a patch and returns the board as it stands, or null when the id names no board.
   *
   * `updated_at` is stamped here rather than by the caller, so no verb can forget it and leave a
   * row whose timestamp does not move when it changes. An empty patch is still legal: it stamps
   * the time and returns the row unchanged.
   */
  updateBoard(patch: KanbanBoardUpdatePatch): KanbanBoard | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];

    for (const [field, column] of Object.entries(BOARD_PATCH_COLUMNS)) {
      const value = patch[field as keyof typeof BOARD_PATCH_COLUMNS];
      if (value === undefined) continue;
      assignments.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }

    assignments.push('updated_at = ?');
    values.push(new Date().toISOString(), patch.id);

    const row = db
      .prepare(`UPDATE kanban_boards SET ${assignments.join(', ')} WHERE id = ? RETURNING ${BOARD_COLUMNS}`)
      .get(...values) as KanbanBoardRow | undefined;

    return row ? toKanbanBoard(row) : null;
  },

  /** One settings value, or null when the key was never written. */
  getSetting(key: string): string | null {
    const db = getConnection();
    const row = db.prepare('SELECT value FROM kanban_settings WHERE key = ?').get(key) as
      | { value: string | null }
      | undefined;

    return row?.value ?? null;
  },

  /** Writes one settings value, replacing it when the key is already there. */
  setSetting(key: string, value: string | null): void {
    const db = getConnection();
    db.prepare(
      `INSERT INTO kanban_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, new Date().toISOString());
  },

  /**
   * How many live cards stand in each status — FIVE rows, always, one per status.
   *
   * Never lane-shaped: the server does not know a To Do lane exists or that it is `todo` plus
   * `questions`. The panel asks for the totals and sums the rows its policy composes, which is
   * what keeps lane composition in exactly one place.
   *
   * Archived cards are excluded, so the header count matches the cards a lane can actually show.
   */
  laneCounts(boardId: string): KanbanLaneCount[] {
    const db = getConnection();
    const placeholders = BOARD_STATUSES.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) AS total FROM kanban_cards
         WHERE board_id = ? AND archived = 0 AND status IN (${placeholders})
         GROUP BY status`
      )
      .all(boardId, ...BOARD_STATUSES) as { status: KanbanStatus; total: number }[];

    const totals = new Map(rows.map((row) => [row.status, row.total]));
    return BOARD_STATUSES.map((status) => ({ status, total: totals.get(status) ?? 0 }));
  },

  /**
   * How many of a board's live cards an autonomous session could pick up right now.
   *
   * A card is claimable when it is `todo`, or when it is `active` on a lease that has gone stale —
   * an `active` card whose owner died mid-build is work nobody is doing, and leaving it out would
   * strand it until an operator noticed. A card on a FRESH lease is somebody else's and is not
   * counted, which is what keeps two sessions off one card.
   *
   * `staleSeconds` is the caller's dial and the ISO-8601 UTC seconds bound is derived HERE from
   * `Date.now()`: `build_lease_at` is TEXT in that same format, so the comparison below is
   * lexicographic — and correct only because the format is fixed-width and UTC. A `Date` bound
   * here would compare a string against an object and match nothing, which reads as "no orphaned
   * leases" forever.
   */
  countClaimable(boardId: string, staleSeconds: number): number {
    const db = getConnection();
    const staleBefore = new Date(Date.now() - staleSeconds * 1000).toISOString();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n FROM kanban_cards
         WHERE board_id = ? AND archived = 0
           AND ( status = 'todo'
              OR (status = 'active' AND (build_lease_at IS NULL OR build_lease_at < ?)) )`
      )
      .get(boardId, staleBefore) as { n: number };

    return row.n;
  },
};
