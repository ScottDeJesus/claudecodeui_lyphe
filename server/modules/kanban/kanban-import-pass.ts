import {
  kanbanIdsDb,
  kanbanImportDb,
  type KanbanImportTable,
} from '@/modules/database/index.js';

/**
 * The pass runner — the four steps every table of the mapping walks, written once.
 *
 * Look the source row up by `descent_id`, mint a local id when it is new, write it, count it.
 * `kanban-import.mapping.ts` and `kanban-import-satellites.ts` each drive their own tables through
 * this, and it sits in its own file so that neither has to import the other to reach it: the two
 * are siblings sharing a runner, not a chain with a load-order that happens to work. The id
 * arithmetic below is where "DESCENT'S IDS ARE NEVER REUSED AS PRIMARY KEYS" is executed.
 */

/** What one table's pass did. */
export type ImportPass = { written: number; inserted: number; updated: number };

/** Everything one pass returns: the tally, and the local ids the later tables look up. */
export type ImportTableResult = { pass: ImportPass; ids: Map<string, string> };

/**
 * The timestamp a source row with none of its own is given.
 *
 * It is the epoch, never "now". A fresh timestamp would be *newer* than every local edit on the
 * next run, so a row whose source carries no timestamp would outrank the guard meant to protect
 * those edits — and it would differ on every run, so two imports of one source could not agree.
 * The epoch says what is actually true: nothing is known about when this row was made.
 */
const SOURCE_EPOCH = new Date(0).toISOString();

/**
 * A translated id, or the empty string when the row it names never landed here.
 *
 * The empty string is how `canLand` says "skip this source row": every write closure is reached
 * only by a row that has already been checked, so the empty case is a guard's answer rather than a
 * cast's escape hatch.
 */
export function lookup(ids: Map<string, string>, descentId: string | null): string {
  return ids.get(descentId ?? '') ?? '';
}

/** The same lookup where a missing parent is a legitimate null rather than a skipped row. */
export function maybe(ids: Map<string, string>, descentId: string | null): string | null {
  return ids.get(descentId ?? '') ?? null;
}

/** A NULL where the target demands a value becomes the epoch. See `SOURCE_EPOCH` for why. */
export function stamp(value: string | null): string {
  return value === null ? SOURCE_EPOCH : (normalise(value) ?? SOURCE_EPOCH);
}

/**
 * The same normalisation where the column is nullable and stays null.
 *
 * EVERY `*_at` COLUMN HOLDS THE ONE SPELLING `new Date().toISOString()` PRODUCES, whether the row
 * was written here or imported. Descent writes its own: `2026-06-24T03:09:28.168342+00:00` —
 * microsecond precision and a numeric offset, not the millisecond `Z` form — and two spellings of
 * one instant compare WRONG as text, because `'…28.168342+00:00' >= '…28.168Z'` is false. The card
 * and board upserts' guards and the done lane's `ORDER BY updated_at DESC` are all text comparisons,
 * so a Descent row newer by less than a millisecond would lose a tie it should win and sort behind
 * a row it should follow. `Date.parse` reads both spellings, so the lease predicate's `julianday()`
 * needed nothing; the ordering comparisons are what did.
 *
 * A value that will not parse is kept EXACTLY AS IT IS rather than dropped or zeroed: nothing is
 * known about it, a stamp the UI can still show beats a null, and the one reader that assigns it
 * meaning — the lease predicate — already treats an unparseable stamp as an unheld lease.
 */
export function isoOrNull(value: string | null): string | null {
  if (value === null) return null;
  return normalise(value) ?? value;
}

/** Descent's spelling of an instant, in this module's one spelling. Null when it will not parse. */
function normalise(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A source row that cannot exist here, because its parent never landed. Logged, never fatal. */
export function skipDangling(table: string, descentId: string): void {
  console.warn(
    `[Kanban] import: skipped the ${table} row "${descentId}" — it names a parent that is not here.`
  );
}

/**
 * Counts one row a pass just wrote.
 *
 * `isNew` is the lookup's verdict: a row the target did not have is an insert, and one it did
 * have is a refresh only when the statement actually changed it — a card whose `updated_at` guard
 * held is neither, and counting it would report an overwrite that never happened.
 */
export function tallyRow(pass: ImportPass, isNew: boolean, changes: number): void {
  if (isNew) {
    pass.inserted += 1;
    pass.written += 1;
    return;
  }

  if (changes > 0) {
    pass.updated += 1;
    pass.written += 1;
  }
}

/**
 * One table's pass: look the row up, mint an id when it is new, write it, count it.
 *
 * `canLand` is the escape hatch for a source row that cannot stand here — a card whose board is
 * missing, a child whose card never landed: the row is logged and left behind rather than aborting
 * an import of twelve thousand good rows at the first bad one.
 *
 * `prefix` is absent for a table whose rows carry their own primary key: the audit log's is the
 * table's own counter, so nothing is minted for it and nothing is mapped from it.
 */
export function importTable<TRow>(input: {
  table: KanbanImportTable;
  prefix?: string;
  rows: TRow[];
  descentId: (row: TRow) => string;
  canLand?: (row: TRow) => boolean;
  write: (row: TRow, id: string) => number;
}): ImportTableResult {
  const ids = new Map<string, string>();
  const pass: ImportPass = { written: 0, inserted: 0, updated: 0 };

  for (const row of input.rows) {
    const descentId = input.descentId(row);

    if (input.canLand !== undefined && !input.canLand(row)) {
      skipDangling(input.table, descentId);
      continue;
    }

    const existing = kanbanImportDb.findIdByDescentId(input.table, descentId);
    const id = existing ?? (input.prefix === undefined ? '' : kanbanIdsDb.mintId(input.prefix));
    const changes = input.write(row, id);

    tallyRow(pass, existing === null, changes);
    if (input.prefix !== undefined) ids.set(descentId, id);
  }

  return { pass, ids };
}
