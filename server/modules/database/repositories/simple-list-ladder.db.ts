import type { Database } from 'better-sqlite3';

/**
 * The simple list's one ladder: a tagged chat holds a place by `sessions.simple_list_rank`, a
 * folder by `simple_list_folders.rank`, and both are read as one ordered list of items.
 *
 * The two tables are read together through `SIMPLE_LIST_LADDER_SQL`, so one number space orders
 * the whole list and a move is one piece of arithmetic rather than a rule per table. Everything
 * here assumes the caller has validated the item and the anchor and holds the transaction: the
 * reads decide the rank that is then written, so a concurrent move would otherwise let two items
 * claim one slot.
 */

/** One thing that holds a place in the simple list: a tagged chat by its session id, or a folder by its folder id. */
export type SimpleListLadderItem = { kind: 'chat' | 'folder'; id: string };

/** A ladder item as the ladder reads it. `folderId` is the LIVE folder a chat sits in: null for a loose chat, for a folder, and for a chat whose folder row is gone. */
export type SimpleListLadderEntry = SimpleListLadderItem & { rank: number | null; folderId: string | null };

/**
 * The ladder's one written form: every tagged chat and every folder, each with the rank that
 * places it in the list's single number space, in the shape of `SimpleListLadderEntry`.
 *
 * Every table in it is aliased, so the same text can sit inside an INSERT or an UPDATE of either
 * table. Consumed by the reads and the rank expression below; exported so a statement that needs
 * the ladder composes this one text instead of writing a second union of the two tables.
 */
export const SIMPLE_LIST_LADDER_SQL = `
SELECT 'chat' AS kind, tagged.session_id AS id, tagged.simple_list_rank AS rank,
       (SELECT live.folder_id FROM simple_list_folders AS live WHERE live.folder_id = tagged.simple_list_folder_id) AS folder_id
FROM sessions AS tagged WHERE tagged.simple_list_at IS NOT NULL
UNION ALL
SELECT 'folder' AS kind, folders.folder_id AS id, folders.rank AS rank, NULL AS folder_id
FROM simple_list_folders AS folders
`;

/**
 * The one written form of "the rank above every item, never below now": an item written with it
 * lands first and always outranks the current maximum. Consumed by `sessions.db.ts`
 * (`createAppSession`, where a chat made from the simple list is born at the top), by
 * `simple-list.db.ts` (`createFolder`, where a folder is born the same way), and by
 * `placeInLadder` below.
 */
export const NEXT_TOP_SIMPLE_LIST_RANK_SQL = `MAX(julianday('now'), COALESCE((SELECT MAX(top_rank.rank) FROM (${SIMPLE_LIST_LADDER_SQL}) AS top_rank), 0) + 0.000001)`;

/** The gap left between two neighbours when an item is spliced between them. */
const RANK_EPSILON = 0.000001;

/** The ladder's rows, wrapped so a caller can filter and order them without restating the union. */
const SELECT_LADDER_SQL = `SELECT ladder.kind AS kind, ladder.id AS id, ladder.rank AS rank, ladder.folder_id AS folder_id FROM (${SIMPLE_LIST_LADDER_SQL}) AS ladder`;

/** One ladder row as SQLite hands it over: `folder_id`, where an entry names the same value `folderId`. */
type LadderRow = { kind: 'chat' | 'folder'; id: string; rank: number | null; folder_id: string | null };

/** The one place a ladder row becomes an entry, so every reader names the folder the same way. */
const toEntry = (row: LadderRow): SimpleListLadderEntry => ({
  kind: row.kind,
  id: row.id,
  rank: row.rank,
  folderId: row.folder_id,
});

/** Whether two refs name the same ladder item. */
const sameItem = (left: SimpleListLadderItem, right: SimpleListLadderItem): boolean =>
  left.kind === right.kind && left.id === right.id;

/** Writes one item's rank to the table that owns it: a chat to `sessions`, a folder to `simple_list_folders`. */
function writeRank(db: Database, item: SimpleListLadderItem, rank: number): void {
  if (item.kind === 'chat') {
    db.prepare('UPDATE sessions SET simple_list_rank = ? WHERE session_id = ?').run(rank, item.id);
    return;
  }

  db.prepare('UPDATE simple_list_folders SET rank = ? WHERE folder_id = ?').run(rank, item.id);
}

/**
 * Renumbers the whole ladder with `item` spliced directly after `after`. The move arithmetic's
 * fallback for the cases a midpoint cannot answer: a tie, a spent interval, an anchor that was
 * never ranked.
 */
function renumberAfter(db: Database, item: SimpleListLadderItem, after: SimpleListLadderItem): void {
  const order = readLadder(db)
    .filter((entry) => !sameItem(entry, item))
    .map(({ kind, id }) => ({ kind, id }));

  order.splice(order.findIndex((entry) => sameItem(entry, after)) + 1, 0, item);
  renumberLadder(db, order);
}

/** Every entry of the ladder in its own order, highest rank first, the id breaking a tie. Consumed by the move arithmetic below; the one read of the list as a whole. */
export function readLadder(db: Database): SimpleListLadderEntry[] {
  const rows = db
    .prepare(`${SELECT_LADDER_SQL} ORDER BY ladder.rank DESC, ladder.id DESC`)
    .all() as LadderRow[];

  return rows.map(toEntry);
}

/**
 * One item as the ladder reads it, or null when the ladder holds no such item: an unknown id, an
 * untagged chat, or a chat whose folder row is gone (whose entry has a null `folderId`).
 *
 * Consumed by `simple-list.db.ts`'s `moveItem`, which asks it for the item and again for the
 * anchor.
 */
export function readLadderEntry(db: Database, item: SimpleListLadderItem): SimpleListLadderEntry | null {
  const row = db
    .prepare(`${SELECT_LADDER_SQL} WHERE ladder.kind = ? AND ladder.id = ?`)
    .get(item.kind, item.id) as LadderRow | undefined;

  return row ? toEntry(row) : null;
}

/**
 * Puts one item directly after another, or at the top of the list when `after` is null, writing
 * the rank to whichever table owns the item.
 *
 * The middle of a pair of neighbours is the rank; a pair with no room left for one — a tie, or a
 * midpoint that is not strictly between the neighbours — falls back to renumbering the ladder.
 *
 * Preconditions: the caller has checked that both items are in the ladder and has opened the
 * transaction, because this reads the ladder and then writes a rank derived from that read.
 * Consumed by `simple-list.db.ts`'s `moveItem`.
 */
export function placeInLadder(db: Database, item: SimpleListLadderItem, after: SimpleListLadderItem | null): void {
  if (after === null) {
    const update =
      item.kind === 'chat'
        ? `UPDATE sessions SET simple_list_rank = ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} WHERE session_id = ?`
        : `UPDATE simple_list_folders SET rank = ${NEXT_TOP_SIMPLE_LIST_RANK_SQL} WHERE folder_id = ?`;
    db.prepare(update).run(item.id);
    return;
  }

  const anchor = readLadderEntry(db, after);
  // The caller has checked the anchor is in the ladder; an anchor that is not leaves nowhere to
  // put the item, so the order stands rather than the item being hoisted over it.
  if (anchor === null) return;

  // Tagged but never ranked: renumbering the ladder is the repair.
  if (anchor.rank === null) {
    renumberAfter(db, item, after);
    return;
  }

  const afterRank = anchor.rank;
  // `below` is the next rank down among every other item. `tied` catches another item sharing
  // the anchor's rank: equal ranks leave no interval to land in, so that case renumbers instead
  // of halving a rank the neighbour already holds.
  const near = db
    .prepare(
      `SELECT MAX(CASE WHEN ladder.rank < ? THEN ladder.rank END) AS below,
              MAX(CASE WHEN ladder.rank = ? THEN 1 END) AS tied
       FROM (${SIMPLE_LIST_LADDER_SQL}) AS ladder
       WHERE NOT (ladder.kind = ? AND ladder.id = ?)
         AND NOT (ladder.kind = ? AND ladder.id = ?)`
    )
    .get(afterRank, afterRank, item.kind, item.id, after.kind, after.id) as { below: number | null; tied: number | null };
  const below = near.below;

  // Halfway to the neighbour below when there is one, just under the anchor otherwise.
  const rank = below === null ? afterRank - RANK_EPSILON : (afterRank + below) / 2;
  if (near.tied !== null || rank >= afterRank || (below !== null && rank <= below)) {
    renumberAfter(db, item, after);
    return;
  }

  writeRank(db, item, rank);
}

/**
 * Rewrites every item's rank from the order given: `top - index * epsilon`, where `top` is the
 * ladder's greatest rank. The repair a move falls back on when a midpoint runs out of room, and
 * the way a delete re-seats the rows it released: consumed by the move arithmetic above and by
 * `simple-list.db.ts` (`deleteFolder`).
 */
export function renumberLadder(db: Database, order: SimpleListLadderItem[]): void {
  const topRow = db
    .prepare(`SELECT MAX(top_rank.rank) AS rank FROM (${SIMPLE_LIST_LADDER_SQL}) AS top_rank`)
    .get() as { rank: number | null } | undefined;
  const top = topRow?.rank ?? 0;

  order.forEach((item, index) => {
    writeRank(db, item, top - index * RANK_EPSILON);
  });
}
