import type { Database } from 'better-sqlite3';

import { AppError } from '@/shared/utils.js';

/**
 * WHAT SHAPE A DESCENT FILE MUST HAVE — the nine tables, and inside each one the columns the reads
 * name, plus the two satellite tables checked only when they are there. One module, checked before
 * a single row is read, so the wrong file is a 404 that says which table or column is missing rather
 * than a driver error thrown from four tables deep in the read.
 *
 * The column half is not pedantry. Descent migrated its own `ov_features` in place (its `_migrate`
 * adds `closing_remarks`, the four `build_tokens_*` counters and the two plan-lease columns), so a
 * file can hold all nine tables and still be a shape this importer cannot read — every table `EXISTS`
 * and the first `SELECT` that names a later column dies with `SQLITE_ERROR`. That is a source the
 * caller must be told about in the same sentence as a missing table: both mean "this is not a
 * Descent board this importer can import", and both are 404s.
 *
 * Kept apart from `kanban-import.transport.ts` because the two move for different reasons — this
 * file moves when DESCENT's schema moves, the transport when a read moves — and because the
 * transport's read is long enough without the expectation it is read against.
 */

/**
 * The nine tables a Descent board lives in.
 *
 * `ov_settings` is deliberately NOT one of them: it is read when it is there, but its absence
 * degrades one imported setting rather than making the file the wrong file, so it must never be
 * what a 404 is about. `ov_lessons` and `ov_memory_candidates` are absent for the same reason and
 * one more: they are an INSTALL's satellites rather than a board's spine — a build's notes and its
 * memory proposals — so a Descent old enough to predate either is still a board worth importing.
 * Requiring them would refuse an import of every board over two tables it can do without.
 */
export const REQUIRED_DESCENT_TABLES = [
  'ov_boards',
  'ov_features',
  'ov_tags',
  'ov_questions',
  'ov_issues',
  'ov_decisions',
  'ov_checklist_items',
  'ov_attachments',
  'ov_events',
] as const;

export type RequiredDescentTable = (typeof REQUIRED_DESCENT_TABLES)[number];

/**
 * The two tables an install keeps beside its board: the lessons a build learned, and the memory
 * proposals a session made. Read when they are there, empty when they are not.
 *
 * Their COLUMNS are still checked, and that is the whole of the difference from the nine above: a
 * missing TABLE means "this Descent never had that lane, import the rest", while a missing COLUMN
 * on a table that IS there means the same thing a missing column anywhere means — a source this
 * importer cannot read, refused in a sentence rather than by a driver error four tables deep.
 */
export const OPTIONAL_DESCENT_TABLES = ['ov_lessons', 'ov_memory_candidates'] as const;

export type OptionalDescentTable = (typeof OPTIONAL_DESCENT_TABLES)[number];

/**
 * Every column the transport's `SELECT`s name, table by table.
 *
 * It is written out rather than derived from the selects so that a column added to a read without a
 * line here FAILS LOUDLY: the check below would not require it, and the read would meet a file that
 * lacks it as the driver error this module exists to pre-empt. A select and its entry here are one
 * change in two places, and they sit two files apart on purpose — the list is the contract, the
 * select is one reader's use of it.
 */
export const REQUIRED_DESCENT_COLUMNS: Record<RequiredDescentTable, readonly string[]> = {
  ov_boards: ['id', 'name', 'created_at', 'sort_order', 'archived'],
  // The full feature row, migration columns included: this list is where "an older Descent" is
  // caught, and a column missing from it is a column whose absence reaches the driver instead.
  ov_features: [
    'id',
    'title',
    'status',
    'priority',
    'description',
    'plan',
    'body',
    'approved',
    'approved_at',
    'archived',
    'sort_order',
    'created_at',
    'updated_at',
    'board_id',
    'build_lease_at',
    'build_owner',
    'closing_remarks',
    'build_tokens_in',
    'build_tokens_out',
    'build_tokens_cache_read',
    'build_tokens_cache_create',
    'plan_lease_at',
    'plan_owner',
  ],
  ov_tags: ['feature_id', 'tag'],
  ov_questions: [
    'id',
    'feature_id',
    'text',
    'multi',
    'options',
    'selected',
    'other_on',
    'other',
    'answered',
    'sort_order',
    'created_at',
    'answered_at',
  ],
  ov_issues: ['id', 'feature_id', 'text', 'resolved', 'filed_at', 'resolved_at', 'resolved_by'],
  ov_decisions: ['id', 'feature_id', 'question_id', 'question', 'choice', 'tags', 'created_at'],
  ov_checklist_items: [
    'id',
    'feature_id',
    'text',
    'state',
    'sort_order',
    'note',
    'created_at',
    'done_at',
  ],
  ov_attachments: ['id', 'feature_id', 'filename', 'mime', 'size', 'created_at'],
  ov_events: ['id', 'ts', 'kind', 'feature_id', 'actor', 'payload'],
};

/**
 * Every column the two satellites' reads name, checked only when the table is present.
 *
 * It is a second map rather than a wider first one because the two lists answer different
 * questions: `REQUIRED_DESCENT_COLUMNS` decides whether this file is a Descent board at all, and
 * this one decides whether the lane that happens to be there can be read.
 */
export const OPTIONAL_DESCENT_COLUMNS: Record<OptionalDescentTable, readonly string[]> = {
  ov_lessons: [
    'id',
    'feature_id',
    'name',
    'summary',
    'body',
    'trigger',
    'kind',
    'tags',
    'status',
    'source',
    'draft_path',
    'created_at',
    'reviewed_at',
  ],
  ov_memory_candidates: [
    'id',
    'name',
    'body',
    'target',
    'project',
    'index_line',
    'rationale',
    'status',
    'source',
    'session_id',
    'asserted_path',
    'refusal',
    'created_at',
    'reviewed_at',
  ],
};

/** The tables the file actually holds. A file that exists but is not a database fails here first. */
function readTableNames(db: Database, dbPath: string): Set<string> {
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[];
    return new Set(rows.map((row) => row.name));
  } catch (error) {
    throw new AppError(`The file at ${dbPath} could not be read as a database.`, {
      code: 'KANBAN_IMPORT_SOURCE_UNREADABLE',
      statusCode: 404,
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

/**
 * The columns one table actually holds.
 *
 * `PRAGMA table_info` takes a table name, not a bound parameter, so the name is interpolated — it
 * comes from the `REQUIRED_DESCENT_TABLES` allowlist above and is never caller input.
 */
function readColumnNames(
  db: Database,
  table: RequiredDescentTable | OptionalDescentTable
): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

/**
 * Refuses a file that is not a Descent board this importer can read, naming the first thing missing.
 *
 * Returns the tables the file held, so the caller can ask about the optional `ov_settings` without
 * paying for a second `sqlite_master` query.
 *
 * The two refusals are told apart in the message because they mean different things to whoever is
 * reading it: a missing TABLE is usually the wrong file, a missing COLUMN is usually a Descent old
 * enough to predate a migration — and both are the caller's mistake, which is why both are 404s and
 * neither is a 500 with a driver's stack trace in the server log.
 */
export function requireDescentShape(db: Database, dbPath: string): Set<string> {
  const present = readTableNames(db, dbPath);

  const missingTable = REQUIRED_DESCENT_TABLES.find((table) => !present.has(table));
  if (missingTable !== undefined) {
    throw new AppError(
      `The database at ${dbPath} is not a Descent board: it has no "${missingTable}" table.`,
      { code: 'KANBAN_IMPORT_NOT_DESCENT', statusCode: 404 }
    );
  }

  for (const table of REQUIRED_DESCENT_TABLES) {
    const columns = readColumnNames(db, table);
    const missingColumn = REQUIRED_DESCENT_COLUMNS[table].find((column) => !columns.has(column));
    if (missingColumn !== undefined) {
      throw new AppError(
        `The database at ${dbPath} was written by an older Descent: its "${table}" table has no "${missingColumn}" column.`,
        { code: 'KANBAN_IMPORT_OUTDATED_SOURCE', statusCode: 404 }
      );
    }
  }

  // The two satellites: their ABSENCE is not this file's problem, but a lane that is there and
  // unreadable is, in exactly the words the loop above uses — same class of surprise, same 404.
  for (const table of OPTIONAL_DESCENT_TABLES) {
    if (!present.has(table)) continue;

    const columns = readColumnNames(db, table);
    const missingColumn = OPTIONAL_DESCENT_COLUMNS[table].find((column) => !columns.has(column));
    if (missingColumn !== undefined) {
      throw new AppError(
        `The database at ${dbPath} was written by an older Descent: its "${table}" table has no "${missingColumn}" column.`,
        { code: 'KANBAN_IMPORT_OUTDATED_SOURCE', statusCode: 404 }
      );
    }
  }

  return present;
}
