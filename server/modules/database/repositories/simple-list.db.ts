import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';
import {
  type SimpleListLadderEntry,
  type SimpleListLadderItem,
  NEXT_TOP_SIMPLE_LIST_RANK_SQL,
  placeInLadder,
  readLadderEntry,
  readLadder,
  renumberLadder,
} from '@/modules/database/repositories/simple-list-ladder.db.js';

/**
 * The simple list's folders, and every move of a row — a chat or a folder — into a container and
 * a place in it. The order itself lives one file down (`simple-list-ladder.db.ts`): this file
 * reads the ladder and writes ranks through it, and never restates the union of its two tables.
 *
 * A move is one transaction whatever it answers: the ladder is read to find the anchor and its
 * neighbours, and the rank written comes out of that read, so two moves running apart would
 * otherwise be free to claim one slot.
 *
 * Consumers: the providers module's simple-list service, for the list's folders and every move;
 * it reaches this repository through `@/modules/database/index.js`.
 */

/** A folder's own row. */
export type SimpleListFolderRow = { folder_id: string; name: string; collapsed: number };

/** What a move answered. */
export type SimpleListMoveVerdict = 'moved' | 'unknown-item' | 'unknown-folder' | 'refused';

/** A folder's columns in one spelling, so no statement here is the odd one out. */
const FOLDER_COLUMNS = 'folder_id, name, collapsed';

/** Whether a folder row exists: the read between a move into a folder and an `unknown-folder`. */
function folderExists(db: Database, folderId: string): boolean {
  return db.prepare('SELECT 1 FROM simple_list_folders WHERE folder_id = ?').get(folderId) !== undefined;
}

/**
 * Whether an anchor sits in the container an item is moving to, read off the anchor's own ladder
 * entry: the top level holds folders and chats in no live folder; a folder holds only its own
 * chats. A chat whose folder row is gone has a null `folderId`, so it counts as loose.
 */
function anchorFitsContainer(anchor: SimpleListLadderEntry, folderId: string | null): boolean {
  if (folderId === null) return anchor.kind === 'folder' || anchor.folderId === null;

  return anchor.kind === 'chat' && anchor.folderId === folderId;
}

export const simpleListDb = {
  /**
   * Every folder, in the ladder's order for them: highest rank first, the id breaking a tie.
   * The service turns each row into a layout folder; the ladder then places it in the feed.
   */
  listFolders(): SimpleListFolderRow[] {
    return getConnection()
      .prepare(`SELECT ${FOLDER_COLUMNS} FROM simple_list_folders ORDER BY rank DESC, folder_id DESC`)
      .all() as SimpleListFolderRow[];
  },

  /** The whole ladder as the list reads it, bound to the connection so callers hold none of their own. */
  readLadder(): SimpleListLadderEntry[] {
    return readLadder(getConnection());
  },

  /**
   * Makes one folder at the top of the list, in the same number space as a chat's rank, and
   * answers the row as stored: born expanded, its rank already resolved by the one rank
   * expression, so nothing has to repair a null later.
   */
  createFolder(folderId: string, name: string): SimpleListFolderRow {
    const row = getConnection()
      .prepare(
        `INSERT INTO simple_list_folders (folder_id, name, rank, collapsed)
         VALUES (?, ?, ${NEXT_TOP_SIMPLE_LIST_RANK_SQL}, 0)
         RETURNING ${FOLDER_COLUMNS}`
      )
      .get(folderId, name) as SimpleListFolderRow | undefined;

    if (!row) throw new Error(`Could not insert simple-list folder "${folderId}".`);
    return row;
  },

  /**
   * Writes only the keys `change` carries, `collapsed` stored as 1 or 0, and answers the row as
   * it then stands, or null when no such folder exists. One transaction, so the answer is the
   * row the write left rather than whatever a later write makes of it.
   */
  updateFolder(folderId: string, change: { name?: string; collapsed?: boolean }): SimpleListFolderRow | null {
    const db = getConnection();
    const assignments: string[] = [];
    const values: (string | number)[] = [];

    if (change.name !== undefined) {
      assignments.push('name = ?');
      values.push(change.name);
    }
    if (change.collapsed !== undefined) {
      assignments.push('collapsed = ?');
      values.push(change.collapsed ? 1 : 0);
    }

    return db.transaction(() => {
      if (assignments.length > 0) {
        db.prepare(`UPDATE simple_list_folders SET ${assignments.join(', ')} WHERE folder_id = ?`).run(...values, folderId);
      }

      const row = db.prepare(`SELECT ${FOLDER_COLUMNS} FROM simple_list_folders WHERE folder_id = ?`).get(folderId) as
        | SimpleListFolderRow
        | undefined;

      return row ?? null;
    })();
  },

  /**
   * Deletes one folder and releases its chats into the folder's own place, in their order inside
   * it; every other row keeps its relative order, because the renumber only runs when the folder
   * held someone. Answers how many chats it released, or null when no such folder exists.
   */
  deleteFolder(folderId: string): number | null {
    const db = getConnection();

    return db.transaction(() => {
      const ladder = readLadder(db);
      if (!ladder.some((entry) => entry.kind === 'folder' && entry.id === folderId)) return null;

      // The folder's chats are the ladder entries whose LIVE folder is this one, in ladder order:
      // a chat whose folder row is gone reads as loose and was never a member.
      const members = ladder.filter((entry) => entry.kind === 'chat' && entry.folderId === folderId);

      // The ladder with the folder's entry replaced by its chats and their own places taken out.
      const order: SimpleListLadderItem[] = [];
      for (const entry of ladder) {
        if (entry.kind === 'chat' && entry.folderId === folderId) continue;
        if (entry.kind === 'folder' && entry.id === folderId) {
          order.push(...members.map((member) => ({ kind: 'chat' as const, id: member.id })));
          continue;
        }
        order.push({ kind: entry.kind, id: entry.id });
      }

      db.prepare('UPDATE sessions SET simple_list_folder_id = NULL WHERE simple_list_folder_id = ?').run(folderId);
      db.prepare('DELETE FROM simple_list_folders WHERE folder_id = ?').run(folderId);

      if (members.length > 0) renumberLadder(db, order);

      return members.length;
    })();
  },

  /**
   * Moves one item into a container — a folder's id, or the top level as null — directly after an
   * anchor, or to the first place in it when the anchor is null. The checks run in one order, so
   * an item that does not exist is told apart from an anchor that cannot hold it:
   *
   * 1. the item is not in the ladder: `unknown-item`;
   * 2. a folder asked into a folder: `refused` — a folder lives at the top level;
   * 3. a destination folder that does not exist: `unknown-folder`;
   * 4. an anchor that is the item, is not in the ladder, or sits outside the destination
   *    container: `refused`.
   *
   * Only then does the chat change its container and either row take its new rank, all of it in
   * one transaction, and the answer is `moved`.
   */
  moveItem(
    item: SimpleListLadderItem,
    folderId: string | null,
    after: SimpleListLadderItem | null
  ): SimpleListMoveVerdict {
    const db = getConnection();

    return db.transaction((): SimpleListMoveVerdict => {
      // An untagged chat, a session that is gone, a folder that is gone: no place to move.
      if (readLadderEntry(db, item) === null) return 'unknown-item';

      if (item.kind === 'folder' && folderId !== null) return 'refused';

      if (folderId !== null && !folderExists(db, folderId)) return 'unknown-folder';

      if (after !== null) {
        // Itself, an item the ladder does not hold, or one outside the destination container:
        // no such place, and the caller's 409 rather than a silent move to the top.
        if (after.kind === item.kind && after.id === item.id) return 'refused';

        const anchor = readLadderEntry(db, after);
        if (anchor === null || !anchorFitsContainer(anchor, folderId)) return 'refused';
      }

      // The container is the column alone: a chat lands in the folder it names, or in none.
      if (item.kind === 'chat') {
        db.prepare('UPDATE sessions SET simple_list_folder_id = ? WHERE session_id = ?').run(folderId, item.id);
      }

      placeInLadder(db, item, after);
      return 'moved';
    })();
  },
};
