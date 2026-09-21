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
 * the board cannot see has no business spending its numbers.
 *
 * Consumers: `memory.service.ts` (every verb of the lane) and, through it, `memory.routes.ts`. Reach
 * it through `@/modules/database/index.js`. Every statement runs on the caller's connection and
 * opens no transaction of its own, so a write issued inside the approve transaction rolls back with
 * the row it was writing.
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
 * The candidate queue and the one-way review that empties it.
 *
 * Nothing here writes a board row, records a board event or appends to `kanban_id_seq`: this lane's
 * own `created_at` and `reviewed_at` are its timestamps, and its id sequence is the table's.
 */
export const memoryCandidatesDb = {
  /**
   * Stages one candidate at the status the caller names — `pending` for a fresh proposal — and
   * returns it as stored.
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
  }): MemoryCandidateFull {
    const row = getConnection()
      .prepare(
        `INSERT INTO memory_candidates
           (id, name, body, target, project, index_line, rationale, status, source, session_id,
            created_at)
         VALUES (
           'mc-' || (SELECT COALESCE(MAX(CAST(substr(id, 4) AS INTEGER)), 0) + 1
                       FROM memory_candidates WHERE id LIKE 'mc-%'),
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        new Date().toISOString()
      ) as MemoryCandidateRow | undefined;

    if (!row) throw new Error(`Could not insert memory candidate "${input.name}".`);
    return toCandidateFull(row);
  },

  /**
   * The candidate queue, newest first — LEAN, so no body crosses the wire for a list.
   *
   * `status` is optional and is the lane's own word (`pending` for the review queue, `approved` for
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
