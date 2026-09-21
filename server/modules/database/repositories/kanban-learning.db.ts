import { getConnection } from '@/modules/database/connection.js';
import type {
  KanbanLesson,
  KanbanLessonLean,
  KanbanSessionUsage,
} from '@/shared/kanban-types.js';

/**
 * The learning lane's two tables: the lessons a build learned and the per-session usage ledger.
 *
 * They share a repository because neither is a card's child, neither is reached through a card's
 * read, and both are read one row at a time (a lesson by id, a usage row by session). The id is the
 * caller's: minted through `kanbanIdsDb` (`ls-<n>`) inside the seam's transaction, like a card's.
 *
 * Consumers: `kanban-lessons.service.ts` (every lesson verb) and `metis-telemetry.service.ts` (the
 * usage upsert and the by-session read). Reach it through `@/modules/database/index.js`. Every
 * statement runs on the caller's connection, so one issued inside the write seam's transaction
 * joins that transaction rather than opening a second one.
 */

/** One `kanban_lessons` row. */
type KanbanLessonRow = {
  id: string;
  card_id: string | null;
  name: string;
  summary: string;
  body: string;
  trigger: string;
  kind: 'note' | 'skill_draft';
  tags: string;
  status: string;
  source: string;
  draft_path: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/** One `kanban_session_usage` row. */
type KanbanSessionUsageRow = {
  session_id: string;
  board_id: string | null;
  card_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read: number;
  cache_create: number;
  byte_offset: number;
  updated_at: string;
};

/** Every column of a lesson, in one spelling — the FULL read. */
const LESSON_COLUMNS = `id, card_id, name, summary, body, trigger, kind, tags, status, source,
  draft_path, created_at, reviewed_at`;

/**
 * The LEAN projection's columns, spelled once: everything but the body and the draft path.
 *
 * A `listLessons` carrying bodies would ship a hundred lessons' full text so the panel could draw a
 * hundred titles, so the exclusion is a column list rather than each statement's memory.
 */
const LESSON_LEAN_COLUMNS = `id, card_id, name, summary, trigger, kind, tags, status, source,
  created_at, reviewed_at`;

/** Every column of a usage row, in the same spirit. */
const USAGE_COLUMNS = `session_id, board_id, card_id, tokens_in, tokens_out, cache_read,
  cache_create, byte_offset, updated_at`;

/**
 * `tags` is a JSON ARRAY OF STRINGS — never a comma-joined string,
 * which cannot tell a tag containing a comma from two tags.
 *
 * A value that will not parse reads as the empty array rather than throwing: a column this
 * repository always writes through `JSON.stringify` can only be unreadable if something outside it
 * wrote it, and one bad row must not fail the read that lists it.
 */
function parseTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    console.error(
      `[Kanban] a lesson's tags column is not the JSON array it should be: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function toLesson(row: KanbanLessonRow): KanbanLesson {
  return {
    id: row.id,
    cardId: row.card_id,
    name: row.name,
    summary: row.summary,
    body: row.body,
    trigger: row.trigger,
    kind: row.kind,
    tags: parseTags(row.tags),
    status: row.status,
    source: row.source,
    draftPath: row.draft_path,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function toLessonLean(row: KanbanLessonRow): KanbanLessonLean {
  return {
    id: row.id,
    cardId: row.card_id,
    name: row.name,
    summary: row.summary,
    trigger: row.trigger,
    kind: row.kind,
    tags: parseTags(row.tags),
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function toSessionUsage(row: KanbanSessionUsageRow): KanbanSessionUsage {
  return {
    sessionId: row.session_id,
    boardId: row.board_id,
    cardId: row.card_id,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    cacheRead: row.cache_read,
    cacheCreate: row.cache_create,
    byteOffset: row.byte_offset,
    updatedAt: row.updated_at,
  };
}

/**
 * The lesson store and the usage ledger, as row-level statements.
 *
 * Nothing here opens a transaction of its own: a lesson write issued inside `writeKanban` joins the
 * seam's transaction, so the row and the `kanban_events` entry beside it land together or not at
 * all. The `ls-<n>` id is the caller's — minted inside that same transaction, never here — and this
 * repository never touches `kanban_id_seq`.
 */
export const kanbanLearningDb = {
  /** Inserts one lesson and returns it as stored. */
  insertLesson(input: {
    id: string;
    cardId: string | null;
    name: string;
    summary: string;
    body: string;
    trigger: string;
    kind: 'note' | 'skill_draft';
    tags: string[];
    status: string;
    source: string;
    draftPath: string | null;
  }): KanbanLesson {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_lessons
           (id, card_id, name, summary, body, trigger, kind, tags, status, source, draft_path,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${LESSON_COLUMNS}`
      )
      .get(
        input.id,
        input.cardId,
        input.name,
        input.summary,
        input.body,
        input.trigger,
        input.kind,
        JSON.stringify(input.tags),
        input.status,
        input.source,
        input.draftPath,
        new Date().toISOString()
      ) as KanbanLessonRow | undefined;

    if (!row) throw new Error(`Could not insert kanban lesson "${input.id}".`);
    return toLesson(row);
  },

  /**
   * The lesson index, newest first — LEAN, so no body crosses the wire for a list.
   *
   * `status` is optional and is one of `staged`, `approved`, `rejected`: the review
   * queue asks for `staged`, the actionable read for `approved`, and the unfiltered read passes
   * nothing. The sort is `created_at DESC, id DESC` — the id breaks ties between two lessons staged
   * in the same second, so the order is stable rather than whatever SQLite finds first.
   */
  listLessons(query: { status?: string; limit: number }): KanbanLessonLean[] {
    const filter = query.status === undefined ? '' : 'WHERE status = ?';
    const values: (string | number)[] =
      query.status === undefined ? [query.limit] : [query.status, query.limit];

    const rows = getConnection()
      .prepare(
        `SELECT ${LESSON_LEAN_COLUMNS} FROM kanban_lessons ${filter}
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(...values) as KanbanLessonRow[];

    return rows.map(toLessonLean);
  },

  /** One lesson read whole, body and draft path included, or null when no such lesson exists. */
  getLesson(lessonId: string): KanbanLesson | null {
    const row = getConnection()
      .prepare(`SELECT ${LESSON_COLUMNS} FROM kanban_lessons WHERE id = ?`)
      .get(lessonId) as KanbanLessonRow | undefined;

    return row ? toLesson(row) : null;
  },

  /**
   * Reviews one STAGED lesson and returns it as reviewed, or null when the compare-and-set matched
   * no row.
   *
   * `AND status = 'staged'` is the gate, and it is in the STATEMENT rather than in a check before
   * it: a review is one-way, and two callers racing the same lesson must not both win. Null means
   * "nothing changed", which covers two realities — an unknown id, and a lesson already reviewed —
   * so a caller owing the operator a 404 or a 422 tells them apart with `getLesson`. This statement
   * cannot, and saying so beats a second statement here pretending it can.
   */
  reviewLesson(input: { id: string; status: 'approved' | 'rejected' }): KanbanLesson | null {
    const row = getConnection()
      .prepare(
        `UPDATE kanban_lessons SET status = ?, reviewed_at = ?
         WHERE id = ? AND status = 'staged'
         RETURNING ${LESSON_COLUMNS}`
      )
      .get(input.status, new Date().toISOString(), input.id) as KanbanLessonRow | undefined;

    return row ? toLesson(row) : null;
  },

  /**
   * Records what one session has spent, replacing the row that session already has.
   *
   * An upsert keyed on `session_id`, never an insert-then-update: the telemetry tick runs against a
   * transcript that only grows, so the second tick must find the first tick's row rather than
   * collide with it. The counters are TOTALS the caller accumulated, and `byte_offset` moves with
   * them as a record of the main transcript's cursor — the watcher resumes from its own in-memory
   * cursors, never from this column.
   */
  upsertSessionUsage(input: {
    sessionId: string;
    boardId: string | null;
    cardId: string | null;
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    cacheCreate: number;
    byteOffset: number;
  }): KanbanSessionUsage {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_session_usage
           (session_id, board_id, card_id, tokens_in, tokens_out, cache_read, cache_create,
            byte_offset, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           board_id = excluded.board_id,
           card_id = excluded.card_id,
           tokens_in = excluded.tokens_in,
           tokens_out = excluded.tokens_out,
           cache_read = excluded.cache_read,
           cache_create = excluded.cache_create,
           byte_offset = excluded.byte_offset,
           updated_at = excluded.updated_at
         RETURNING ${USAGE_COLUMNS}`
      )
      .get(
        input.sessionId,
        input.boardId,
        input.cardId,
        input.tokensIn,
        input.tokensOut,
        input.cacheRead,
        input.cacheCreate,
        input.byteOffset,
        new Date().toISOString()
      ) as KanbanSessionUsageRow | undefined;

    if (!row) throw new Error(`Could not record usage for session "${input.sessionId}".`);
    return toSessionUsage(row);
  },

  /** One session's usage, or null when that session has never been counted. */
  getSessionUsage(sessionId: string): KanbanSessionUsage | null {
    const row = getConnection()
      .prepare(`SELECT ${USAGE_COLUMNS} FROM kanban_session_usage WHERE session_id = ?`)
      .get(sessionId) as KanbanSessionUsageRow | undefined;

    return row ? toSessionUsage(row) : null;
  },
};
