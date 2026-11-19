/**
 * The done-column migrations, kept out of `migrations.ts` because that file is past the house's soft
 * size cap and gets one import line and one call line and nothing else.
 *
 * `kanban_cards` gains `done_at`, the moment a card arrived in the Done column, and `changelog`, the
 * one line a person reads about what the finished card changed. `kanban-schema.ts` declares both with `IF NOT EXISTS`, which
 * reaches only a new database; this is the half that reaches the live one.
 *
 * A card already in Done takes `done_at` from the newest event that moved it there, read from either
 * vocabulary the event log holds: `card.moved` with `to` set to Done, or the imported board's
 * `feature.moved` with `status` set to Done. A card with no such event takes its own `updated_at`.
 *
 * The backfill runs at every boot, and that is what makes it idempotent: its WHERE clause matches no
 * row once nothing is owed, so a later boot writes nothing. The move verb stamps `done_at` for every
 * later arrival in Done, so the backfill has only to reach cards that were already in Done before the
 * column existed.
 *
 * An event whose payload is not valid JSON is never read as a move. A bad payload would otherwise make
 * `json_extract` fail the whole statement and with it the boot, and SQLite does not promise that AND
 * short-circuits, so the guard is a CASE, which is evaluated lazily.
 */
import type { Database } from 'better-sqlite3';

import {
  addColumnToTableIfNotExists,
  getTableInfo,
  tableExists,
} from '@/modules/database/migrations-columns.js';

const KANBAN_CARDS_TABLE = 'kanban_cards';
const DONE_AT_COLUMN = 'done_at';
// Nullable: a card that has not reached Done has no arrival time.
const DONE_AT_COLUMN_TYPE = 'TEXT NULL';
const CHANGELOG_COLUMN = 'changelog';
// Empty until a walk or a person writes the line; NOT NULL so every reader can test for '' alone.
const CHANGELOG_COLUMN_TYPE = "TEXT NOT NULL DEFAULT ''";

// The move-into-done test reads the payload only when it is valid JSON: CASE is evaluated lazily, so
// json_extract is never reached for a malformed payload, and an event that is not valid JSON is not a move.
const BACKFILL_DONE_AT_SQL = `
  UPDATE kanban_cards
  SET done_at = COALESCE(
    (
      SELECT e.ts
      FROM kanban_events AS e
      WHERE e.card_id = kanban_cards.id
        AND CASE WHEN json_valid(e.payload) THEN
          (e.kind = 'card.moved' AND json_extract(e.payload, '$.to') = 'done')
          OR (e.kind = 'feature.moved' AND json_extract(e.payload, '$.status') = 'done')
        ELSE 0 END
      ORDER BY e.id DESC
      LIMIT 1
    ),
    updated_at
  )
  WHERE status = 'done' AND done_at IS NULL
`;

/**
 * Brings a live `kanban_cards` table to the shape `kanban-schema.ts` declares for a new one, then
 * back-fills `done_at` for cards that were in Done before the column existed. Runs at every boot: a
 * database that has both columns and no unstamped Done card is left untouched, so running it again is
 * harmless and there is no separate "already ran" marker to fall out of step with the data.
 */
export const migrateKanbanCardDoneColumns = (db: Database): void => {
  // A database without the card table has nothing to alter; the schema script creates the table
  // with both columns already declared.
  if (!tableExists(db, KANBAN_CARDS_TABLE)) {
    return;
  }

  const columnNames = getTableInfo(db, KANBAN_CARDS_TABLE).map((column) => column.name);
  addColumnToTableIfNotExists(
    db,
    KANBAN_CARDS_TABLE,
    columnNames,
    DONE_AT_COLUMN,
    DONE_AT_COLUMN_TYPE
  );
  addColumnToTableIfNotExists(
    db,
    KANBAN_CARDS_TABLE,
    columnNames,
    CHANGELOG_COLUMN,
    CHANGELOG_COLUMN_TYPE
  );

  const { changes } = db.prepare(BACKFILL_DONE_AT_SQL).run();
  if (changes > 0) {
    console.log(`Running migration: stamped done_at on ${changes} done kanban cards`);
  }
};
