import { getConnection } from '@/modules/database/connection.js';
import type { KanbanLesson, KanbanLessonLean } from '@/shared/kanban-types.js';

/**
 * The learning lane's table: the lessons a build learned.
 *
 * A lesson is not a card's child and is not reached through a card's read, so it is read one row
 * at a time, by id. The id is the caller's: minted through `kanbanIdsDb` (`ls-<n>`) inside the
 * seam's transaction, like a card's.
 *
 * Consumers: `kanban-lessons.service.ts` (every lesson verb) and the spill sweep through it.
 * Reach it through `@/modules/database/index.js`. Every statement runs on the caller's connection,
 * so one issued inside the write seam's transaction joins that transaction rather than opening a
 * second one.
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

/**
 * The lesson store, as row-level statements.
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
};
