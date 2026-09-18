import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { DescentMemoryRow } from '@/modules/database/index.js';
import type { KanbanPriority, KanbanStatus } from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { requireDescentShape } from './kanban-import-shape.js';

/**
 * THE foreign read — every byte this board takes out of a Descent database, and nothing else.
 *
 * It writes nothing, maps nothing and has never heard of a `kanban_` table: it hands the service
 * plain source rows and the service decides what they become. That split is what keeps the
 * mapping readable without the reading being re-argued, and it is why the service below holds no
 * foreign connection of its own (asserted by the phase's first verify).
 *
 * FOUR THINGS MAKE THE SOURCE SAFE TO POINT AT, and each is load-bearing: the handle is opened
 * read-only and must already exist, so the worst a bug here can do to the operator's live Descent
 * install is fail to open it; the file's SHAPE — the nine tables and the columns each read names,
 * plus the two satellite tables' columns when those tables are there — is checked before a single
 * row is read (`kanban-import-shape.ts`), so the wrong file and the older-Descent file are both a
 * 404 naming what is missing rather than a driver error four tables deep; a file holding no boards
 * is refused rather than imported, so nothing here can file rows under a board id that is the empty
 * string; and the read is one pass into typed arrays, so a caller wanting a projection or a filter
 * does it in the service, where it can be read as a decision.
 */

/** Where a Descent install keeps its board, when the caller names no path. */
const DEFAULT_DESCENT_DB_PATH = path.join(os.homedir(), '.claude', 'descent', 'descent.db');

/**
 * One `ov_boards` row. Descent's board carries no `updated_at` and no project — the board is the
 * whole install's — so `created_at` is the only timestamp the mapping has to work with.
 */
export type DescentBoardRow = {
  id: string;
  name: string;
  created_at: string | null;
  sort_order: number;
  archived: number;
};

/** One `ov_features` row: Descent's card, including the columns its own `_migrate` added. */
export type DescentFeatureRow = {
  id: string;
  title: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  description: string;
  plan: string | null;
  body: string;
  approved: number;
  approved_at: string | null;
  archived: number;
  sort_order: number;
  created_at: string | null;
  updated_at: string | null;
  board_id: string | null;
  build_lease_at: string | null;
  build_owner: string | null;
  closing_remarks: string;
  build_tokens_in: number;
  build_tokens_out: number;
  build_tokens_cache_read: number;
  build_tokens_cache_create: number;
  plan_lease_at: string | null;
  plan_owner: string | null;
};

/** One `ov_tags` row, which IS Descent's join table: `feature_id` is the card, not a tag id. */
export type DescentTagRow = { feature_id: string; tag: string };

/** One `ov_questions` row. `options` and `selected` arrive as JSON text and travel as they are. */
export type DescentQuestionRow = {
  id: string;
  feature_id: string;
  text: string | null;
  multi: number;
  options: string;
  selected: string;
  other_on: number;
  other: string;
  answered: number;
  sort_order: number | null;
  created_at: string | null;
  answered_at: string | null;
};

/** One `ov_issues` row. */
export type DescentIssueRow = {
  id: string;
  feature_id: string;
  text: string | null;
  resolved: number;
  filed_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
};

/** One `ov_decisions` row; `feature_id` and `question_id` may both name rows that are gone. */
export type DescentDecisionRow = {
  id: string;
  feature_id: string | null;
  question_id: string | null;
  question: string | null;
  choice: string | null;
  tags: string;
  created_at: string | null;
};

/** One `ov_checklist_items` row. */
export type DescentChecklistRow = {
  id: string;
  feature_id: string;
  text: string;
  state: 'pending' | 'active' | 'done';
  sort_order: number;
  note: string;
  created_at: string | null;
  done_at: string | null;
};

/** One `ov_attachments` row: a row of metadata, never the file behind it. */
export type DescentAttachmentRow = {
  id: string;
  feature_id: string;
  filename: string | null;
  mime: string | null;
  size: number | null;
  created_at: string | null;
};

/**
 * One `ov_events` row. `feature_id` has no foreign key in Descent and may name a card that no
 * longer exists — the mapping's job, not this read's.
 */
export type DescentEventRow = {
  id: number;
  ts: string | null;
  kind: string | null;
  feature_id: string | null;
  actor: string;
  payload: string | null;
};

/** One `ov_settings` row. Nineteen of them are Descent daemon state; one names the current board. */
export type DescentSettingRow = { key: string; value: string | null };

/**
 * One `ov_lessons` row: a note a build staged, at whatever status a person reviewed it to.
 *
 * `feature_id` has no foreign key in Descent and may name a card this board never imported — the
 * mapping's business, not this read's, and the reason a lesson lands with a null card rather than
 * being dropped. `draft_path` is the file Descent wrote for a `kind = 'skill_draft'` lesson; it is
 * carried as a string and this import writes no file of its own.
 */
export type DescentLessonRow = {
  id: string;
  feature_id: string | null;
  name: string;
  summary: string;
  body: string;
  trigger: string;
  kind: string;
  tags: string;
  status: string;
  source: string;
  draft_path: string | null;
  created_at: string | null;
  reviewed_at: string | null;
};

/** Everything one pass over a Descent database yields, in the importer's own mapping order. */
export type DescentSourceRows = {
  boards: DescentBoardRow[];
  features: DescentFeatureRow[];
  tags: DescentTagRow[];
  questions: DescentQuestionRow[];
  issues: DescentIssueRow[];
  decisions: DescentDecisionRow[];
  checklist: DescentChecklistRow[];
  attachments: DescentAttachmentRow[];
  events: DescentEventRow[];
  settings: DescentSettingRow[];
  lessons: DescentLessonRow[];
  /**
   * Descent's memory proposals, typed in the lane that owns them (`memory-candidates.db.ts`): the
   * board's import hands these rows straight to `importDescentCandidates` and keeps no tally of
   * its own beyond the count it reads back.
   */
  memoryCandidates: DescentMemoryRow[];
  /**
   * The imported install's OWN attachment root, resolved from the database path this read opened.
   *
   * Descent keeps its bytes beside its database — both `DB_PATH` and `ATTACHMENTS_ROOT` are
   * `Path(__file__).resolve().parent` (`store_schema.py:48,70`) — so the source root is the
   * directory of whichever database was read, never a path captured at module load: a `dbPath`
   * naming another install must fetch THAT install's bytes. The default database resolves to
   * `~/.claude/descent/attachments`; it is derived when the rows are read, so it is a fact about
   * the pass rather than a second home for a global.
   */
  descentAttachmentsRoot: string;
};

/**
 * Opens the source, read-only and required to exist.
 *
 * A path that is not there is a 404 and not a 500: the caller asked for a file, and the plain
 * sentence about the path is more use than the driver's own text — which is kept in `details`
 * for a log, never shown as the message.
 */
function openDescentDatabase(dbPath: string): Database.Database {
  try {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new AppError(`No readable Descent database at ${dbPath}.`, {
      code: 'KANBAN_IMPORT_SOURCE_MISSING',
      statusCode: 404,
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

/**
 * Reads a Descent database into typed rows.
 *
 * Every column is selected by name rather than with `*`, so a column Descent adds later cannot
 * change the shape of a row this importer already maps — and every one of those names is checked
 * against the file first, so a file that predates one of them is refused in a sentence rather than
 * failing here. The handle is closed in a `finally`: a throw while reading must not leave the
 * operator's file held open by a server process.
 */
export function readDescentSource(input: { dbPath?: string }): DescentSourceRows {
  const dbPath = input.dbPath ?? DEFAULT_DESCENT_DB_PATH;
  const db = openDescentDatabase(dbPath);

  try {
    const present = requireDescentShape(db, dbPath);

    const rows: DescentSourceRows = {
      boards: db
        .prepare("SELECT id, name, created_at, sort_order, archived FROM ov_boards")
        .all() as DescentBoardRow[],
      features: db
        .prepare(
          `SELECT id, title, status, priority, description, plan, body, approved, approved_at,
                  archived, sort_order, created_at, updated_at, board_id, build_lease_at,
                  build_owner, closing_remarks, build_tokens_in, build_tokens_out,
                  build_tokens_cache_read, build_tokens_cache_create, plan_lease_at, plan_owner
           FROM ov_features`
        )
        .all() as DescentFeatureRow[],
      tags: db.prepare('SELECT feature_id, tag FROM ov_tags').all() as DescentTagRow[],
      questions: db
        .prepare(
          `SELECT id, feature_id, text, multi, options, selected, other_on, other, answered,
                  sort_order, created_at, answered_at
           FROM ov_questions`
        )
        .all() as DescentQuestionRow[],
      issues: db
        .prepare(
          `SELECT id, feature_id, text, resolved, filed_at, resolved_at, resolved_by FROM ov_issues`
        )
        .all() as DescentIssueRow[],
      decisions: db
        .prepare(
          `SELECT id, feature_id, question_id, question, choice, tags, created_at FROM ov_decisions`
        )
        .all() as DescentDecisionRow[],
      checklist: db
        .prepare(
          `SELECT id, feature_id, text, state, sort_order, note, created_at, done_at
           FROM ov_checklist_items`
        )
        .all() as DescentChecklistRow[],
      attachments: db
        .prepare(
          `SELECT id, feature_id, filename, mime, size, created_at FROM ov_attachments`
        )
        .all() as DescentAttachmentRow[],
      events: db
        .prepare('SELECT id, ts, kind, feature_id, actor, payload FROM ov_events')
        .all() as DescentEventRow[],
      // Read when it is there and empty when it is not: an install that has never had a settings
      // table still has a board worth importing, and the one key below is worth one row, not a 404.
      settings: present.has('ov_settings')
        ? (db.prepare('SELECT key, value FROM ov_settings').all() as DescentSettingRow[])
        : [],
      // The same rule for the install's two satellites, for a stronger reason: they are not the
      // board at all — a build's notes and a session's memory proposals — so a Descent old enough
      // to predate either is still an install whose boards are worth importing. Columns are checked
      // when the table IS there (`kanban-import-shape.ts`), never the table itself.
      lessons: present.has('ov_lessons')
        ? (db
            .prepare(
              `SELECT id, feature_id, name, summary, body, trigger, kind, tags, status, source,
                      draft_path, created_at, reviewed_at
               FROM ov_lessons`
            )
            .all() as DescentLessonRow[])
        : [],
      memoryCandidates: present.has('ov_memory_candidates')
        ? (db
            .prepare(
              `SELECT id, name, body, target, project, index_line, rationale, status, source,
                      session_id, asserted_path, refusal, created_at, reviewed_at
               FROM ov_memory_candidates`
            )
            .all() as DescentMemoryRow[])
        : [],
      // The install's bytes live beside its database (Descent derives both from `__file__`), so the
      // root follows the file that was actually read rather than a path this module captured.
      descentAttachmentsRoot: path.resolve(path.dirname(dbPath), 'attachments'),
    };

    // A file with the right shape and no boards in it is refused HERE, at the door, rather than
    // imported as rows that belong to no board: every card is a board's child, and the audit log
    // an imported board carries is filed per board, so a boardless source could only ever produce
    // an import with an empty board id — rows no board's view can reach. It is the same class of
    // answer as a missing table, and it is the same 404.
    if (rows.boards.length === 0) {
      throw new AppError(`The database at ${dbPath} holds no boards to import.`, {
        code: 'KANBAN_IMPORT_NO_BOARDS',
        statusCode: 404,
      });
    }

    return rows;
  } finally {
    db.close();
  }
}
