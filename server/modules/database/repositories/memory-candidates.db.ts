import { getConnection } from '@/modules/database/connection.js';
import type { MemoryCandidateFull, MemoryCandidateLean } from '@/shared/types.js';

/**
 * `memory_candidates`, as row-level statements — the memory-intake lane's own table.
 *
 * It is not a board table: no `board_id`, no card, no lane, no frame. Its rows are proposals to
 * write a memory into one of the five destinations a person approves, and the lane that owns them
 * (`modules/memory-intake/`) is not the board. The wire shapes are `MemoryCandidateLean` and
 * `MemoryCandidateFull`, which already live in `server/shared/types.ts`; nothing here re-declares
 * them.
 *
 * THE ID IS MINTED HERE, and its counter is the table's own ids: `mc-<n>`, one past the highest
 * `mc-<n>` already stored, computed INSIDE the insert statement so two concurrent stages cannot
 * read the same number. It never touches `kanban_id_seq` — that sequence is the board's, and a lane
 * the board cannot see has no business spending its numbers. An imported Descent row is given a
 * minted id like any other row and keeps Descent's own id in `descent_id`: the two counters are the
 * same shape (`mc-1` there, `mc-1` here) and different sequences, which is exactly why the source
 * id must never be the primary key — the first locally staged proposal would collide with one.
 *
 * Consumers: `memory.service.ts` (every verb of the lane) and, through it, `memory.routes.ts` and
 * the Descent import. Reach it through `@/modules/database/index.js`. Every statement runs on the
 * caller's connection and opens no transaction of its own, so a write issued inside the approve
 * transaction rolls back with the row it was writing.
 */

/** One `memory_candidates` row. */
type MemoryCandidateRow = {
  id: string;
  name: string;
  body: string;
  target: string;
  project: string | null;
  index_line: string | null;
  rationale: string | null;
  status: string;
  source: string | null;
  session_id: string | null;
  asserted_path: string | null;
  refusal: string | null;
  created_at: string;
  reviewed_at: string | null;
};

/**
 * One `ov_memory_candidates` row as Descent's own database spells it — the import's input.
 *
 * It lives here, beside the local row type and the upsert that consumes it, because the two are the
 * same table in two spellings and a reader checking one against the other should not have to cross
 * a module. The fields are Descent's: snake_case column names, `target` a plain string rather than
 * the lane's `MemoryTarget` union (Descent's vocabulary has grown a value — `user` is in the live
 * table today — and this lane imports what an install holds rather than what today's door accepts).
 *
 * The timestamps are Descent's spelling on arrival (`2026-06-24T03:09:28.168342+00:00`); the lane's
 * `importDescentCandidates` normalises them before they are handed to the upsert, the same way the
 * board's importer normalises every other source stamp.
 */
export type DescentMemoryRow = {
  id: string;
  name: string;
  body: string;
  target: string;
  project: string | null;
  index_line: string | null;
  rationale: string | null;
  status: string;
  source: string;
  session_id: string | null;
  asserted_path: string | null;
  refusal: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

/** Every column of a candidate, in one spelling — the FULL read. */
const CANDIDATE_COLUMNS = `id, name, body, target, project, index_line, rationale, status, source,
  session_id, asserted_path, refusal, created_at, reviewed_at`;

/**
 * The LEAN projection's columns, spelled once: everything but the body, the index line and the
 * rationale.
 *
 * A list read is a queue a person skims; it needs what a row IS and never its full text. The body
 * arrives from the by-id read for the one candidate that person opens.
 */
const CANDIDATE_LEAN_COLUMNS = `id, name, target, project, status, source, session_id,
  asserted_path, refusal, created_at, reviewed_at`;

function toCandidateFull(row: MemoryCandidateRow): MemoryCandidateFull {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    target: row.target,
    project: row.project,
    indexLine: row.index_line,
    rationale: row.rationale,
    status: row.status,
    source: row.source,
    sessionId: row.session_id,
    assertedPath: row.asserted_path,
    refusal: row.refusal,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function toCandidateLean(row: MemoryCandidateRow): MemoryCandidateLean {
  return {
    id: row.id,
    name: row.name,
    target: row.target,
    project: row.project,
    status: row.status,
    source: row.source,
    sessionId: row.session_id,
    assertedPath: row.asserted_path,
    refusal: row.refusal,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

/**
 * The local id already standing for one imported Descent candidate, or null when it is new here.
 *
 * It is the whole of what makes an import an update rather than a second copy, and the sibling of
 * `kanbanImportDb.findIdByDescentId` — spelled out here because this lane's table is not one the
 * board's importer can name.
 */
function findImportedId(descentId: string): string | null {
  const row = getConnection()
    .prepare('SELECT id FROM memory_candidates WHERE descent_id = ?')
    .get(descentId) as { id: string } | undefined;

  return row?.id ?? null;
}

/**
 * The candidate queue and the one-way review that empties it.
 *
 * Nothing here writes a board row, records a board event or appends to `kanban_id_seq`: this lane's
 * own `created_at` and `reviewed_at` are its timestamps, and its id sequence is the table's.
 */
export const memoryCandidatesDb = {
  /**
   * Stages one candidate at whatever status the caller names and returns it as stored.
   *
   * `status` is the caller's because the two callers differ: a fresh proposal lands `pending`, while
   * the Descent import inserts rows at the status they were already reviewed to. `descentId` is the
   * `ov_memory_candidates` row this one came from, or null for a locally staged proposal.
   */
  insertCandidate(input: {
    name: string;
    body: string;
    target: string;
    project: string | null;
    indexLine: string | null;
    rationale: string | null;
    status: string;
    source: string;
    sessionId: string | null;
    descentId: string | null;
  }): MemoryCandidateFull {
    const row = getConnection()
      .prepare(
        `INSERT INTO memory_candidates
           (id, name, body, target, project, index_line, rationale, status, source, session_id,
            created_at, descent_id)
         VALUES (
           'mc-' || (SELECT COALESCE(MAX(CAST(substr(id, 4) AS INTEGER)), 0) + 1
                       FROM memory_candidates WHERE id LIKE 'mc-%'),
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         RETURNING ${CANDIDATE_COLUMNS}`
      )
      .get(
        input.name,
        input.body,
        input.target,
        input.project,
        input.indexLine,
        input.rationale,
        input.status,
        input.source,
        input.sessionId,
        new Date().toISOString(),
        input.descentId
      ) as MemoryCandidateRow | undefined;

    if (!row) throw new Error(`Could not insert memory candidate "${input.name}".`);
    return toCandidateFull(row);
  },

  /**
   * Inserts one imported Descent candidate, or refreshes the row already standing for it.
   *
   * The conflict target is `descent_id`, which is what makes the import idempotent: a second run
   * finds the row by its source id, reuses the local id that row already holds and UPDATES it. The
   * id is minted by the same counter `insertCandidate` uses when the source row is new here, and
   * the two never both fire — an insert either conflicts on `descent_id` (an existing row) or takes
   * a number one past every id in the table (which nothing can hold) — so no re-import can fail on
   * the primary key before the conflict clause is ever consulted.
   *
   * Descent's `status` and `target` are written VERBATIM, and a re-import therefore outranks a
   * review performed here: this is the unguarded rule every imported child table follows, and the
   * source is the whole truth about a row that carries a `descent_id`.
   */
  upsertCandidate(row: DescentMemoryRow): number {
    const existing = findImportedId(row.id);

    const changes = getConnection()
      .prepare(
        `INSERT INTO memory_candidates
           (id, name, body, target, project, index_line, rationale, status, source, session_id,
            asserted_path, refusal, created_at, reviewed_at, descent_id)
         VALUES (
           COALESCE(?, 'mc-' || (SELECT COALESCE(MAX(CAST(substr(id, 4) AS INTEGER)), 0) + 1
                                   FROM memory_candidates WHERE id LIKE 'mc-%')),
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )
         ON CONFLICT(descent_id) DO UPDATE SET
           name = excluded.name, body = excluded.body, target = excluded.target,
           project = excluded.project, index_line = excluded.index_line,
           rationale = excluded.rationale, status = excluded.status, source = excluded.source,
           session_id = excluded.session_id, asserted_path = excluded.asserted_path,
           refusal = excluded.refusal, created_at = excluded.created_at,
           reviewed_at = excluded.reviewed_at`
      )
      .run(
        existing,
        row.name,
        row.body,
        row.target,
        row.project,
        row.index_line,
        row.rationale,
        row.status,
        row.source,
        row.session_id,
        row.asserted_path,
        row.refusal,
        row.created_at,
        row.reviewed_at,
        row.id
      ).changes;

    return changes;
  },

  /**
   * The candidate queue, newest first — LEAN, so no body crosses the wire for a list.
   *
   * `status` is optional and is Descent's own word (`pending` for the review queue, `approved` for
   * the filed list). The sort is `created_at DESC, id DESC`, so two candidates staged in the same
   * second still come back in a stable order.
   */
  listCandidates(query: { status?: string; limit: number }): MemoryCandidateLean[] {
    const filter = query.status === undefined ? '' : 'WHERE status = ?';
    const values: (string | number)[] =
      query.status === undefined ? [query.limit] : [query.status, query.limit];

    const rows = getConnection()
      .prepare(
        `SELECT ${CANDIDATE_LEAN_COLUMNS} FROM memory_candidates ${filter}
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(...values) as MemoryCandidateRow[];

    return rows.map(toCandidateLean);
  },

  /** One candidate read whole, or null when no row carries that id. */
  getCandidate(candidateId: string): MemoryCandidateFull | null {
    const row = getConnection()
      .prepare(`SELECT ${CANDIDATE_COLUMNS} FROM memory_candidates WHERE id = ?`)
      .get(candidateId) as MemoryCandidateRow | undefined;

    return row ? toCandidateFull(row) : null;
  },

  /**
   * Flips one PENDING candidate to a terminal status and returns it as reviewed, or null when the
   * compare-and-set matched no row.
   *
   * `AND status = 'pending'` is the gate and it is in the statement: a review is one-way, and two
   * callers racing the same candidate must not both win. Null covers both "no such id" and "already
   * reviewed" — a caller that owes the operator a 404 or a 422 tells them apart with `getCandidate`.
   */
  reviewCandidate(input: {
    id: string;
    status: 'approved' | 'rejected';
  }): MemoryCandidateFull | null {
    const row = getConnection()
      .prepare(
        `UPDATE memory_candidates SET status = ?, reviewed_at = ?
         WHERE id = ? AND status = 'pending'
         RETURNING ${CANDIDATE_COLUMNS}`
      )
      .get(input.status, new Date().toISOString(), input.id) as MemoryCandidateRow | undefined;

    return row ? toCandidateFull(row) : null;
  },

  /**
   * Records the cap guard's own words on a still-pending candidate, reporting whether a pending row
   * was there to write them on.
   *
   * The refusal STAYS on the row: it describes the obstacle this candidate has right now, and the
   * queue shows it so the next attempt knows what to trim. Nothing is truncated to make a refusal
   * fit — the row is refused, never rewritten.
   */
  recordRefusal(input: { id: string; refusal: string }): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE memory_candidates SET refusal = ? WHERE id = ? AND status = 'pending'`
      )
      .run(input.refusal, input.id);

    return result.changes > 0;
  },

  /**
   * Stamps where an approved candidate's bytes landed, and clears the refusal it carried.
   *
   * The refusal is cleared in the SAME statement because it describes a current obstacle, not a
   * history: leaving it on an approved row would have the row assert two contradictory things about
   * itself — "this was written to disk" and "this was refused" — with nothing to date either.
   * Called after the compare-and-set, inside the same transaction, so a write that fails rolls the
   * stamp back with the row.
   */
  markCandidateAsserted(input: { id: string; assertedPath: string }): boolean {
    const result = getConnection()
      .prepare(`UPDATE memory_candidates SET asserted_path = ?, refusal = NULL WHERE id = ?`)
      .run(input.assertedPath, input.id);

    return result.changes > 0;
  },
};
