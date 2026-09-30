import { randomUUID } from 'node:crypto';

import {
  simpleListDb,
  type SimpleListLadderItem,
  type SimpleListMoveVerdict,
} from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { SimpleListChangedEvent } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * The simple chat list's feed and its four writes — the folders and the moves — as the provider
 * routes serve them.
 *
 * The order itself is not decided here: the ladder's repository ranks every row, and this file
 * only draws the tree the feed answers with. Every write broadcasts one `simple_list_changed`
 * frame after its repository call has succeeded, so a client that hears it re-reads the feed
 * rather than guessing at the change.
 *
 * Consumed by `simple-list.routes.ts`, which owns the transport contract and calls one verb per
 * request; `provider.routes.ts` reads the feed through `readFeed` for `GET /sessions/recent`.
 */

/** One row of the feed, as the service that makes it spells it: this file never declares a chat row of its own. */
type RecentChat = ReturnType<typeof sessionsService.listRecentSessions>['conversations'][number];

/** One top-level row of the simple list: a loose chat by its id, or a folder with its chats' ids in order. */
type SimpleListLayoutItem =
  | { kind: 'chat'; sessionId: string }
  | { kind: 'folder'; folderId: string; name: string; collapsed: boolean; sessionIds: string[] };

/** The folder arm of a layout row: what the ladder walk fills with the folder's chats. */
type SimpleListLayoutFolder = Extract<SimpleListLayoutItem, { kind: 'folder' }>;

/**
 * The limit that asks the sessions service for every tagged chat: SQLite reads a negative LIMIT as
 * no upper bound, so the walk below sees each chat once and then answers one page of top-level
 * rows (run on a copy of the live database, 2026-09-30: 38 rows).
 */
const EVERY_TAGGED_CHAT = -1;

/** The folder a request names is gone: the 404 a folder write answers with. A move's `unknown-folder` is only ever said with a non-null id. */
function folderNotFound(folderId: string | null): AppError {
  return new AppError(`Simple-list folder "${folderId}" was not found.`, {
    code: 'SIMPLE_LIST_FOLDER_NOT_FOUND',
    statusCode: 404,
  });
}

/**
 * The error a refused move answers with, named by the verdict the repository gave: an item the
 * ladder cannot find is a 404, a destination folder that is gone a 404, and a place the list's own
 * rules refuse a 409.
 */
function moveRefused(
  verdict: Exclude<SimpleListMoveVerdict, 'moved'>,
  item: SimpleListLadderItem,
  folderId: string | null
): AppError {
  if (verdict === 'unknown-item') {
    return new AppError(`Simple-list item "${item.kind}:${item.id}" was not found.`, {
      code: 'SIMPLE_LIST_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  }

  if (verdict === 'unknown-folder') {
    return folderNotFound(folderId);
  }

  return new AppError(`The simple list refuses to move "${item.kind}:${item.id}" there.`, {
    code: 'SIMPLE_LIST_POSITION_REFUSED',
    statusCode: 409,
  });
}

/**
 * Puts one frame on every open gateway socket: the list's shape changed, and nothing more — a
 * reader that hears it re-reads the feed.
 *
 * The fan-out copies `kanban-broadcast.service.ts`: `JSON.stringify` once for the whole set rather
 * than once per socket, then a walk of `connectedClients` sending to each client whose
 * `readyState` is `WS_OPEN_STATE`. A socket that throws mid-send is caught PER CLIENT, because a
 * dead socket is that client's problem and must not cost every client after it in the set their
 * frame.
 */
function broadcastSimpleListChanged(): void {
  const frame: SimpleListChangedEvent = { kind: 'simple_list_changed', at: Date.now() };
  const message = JSON.stringify(frame);

  connectedClients.forEach((client) => {
    if (client.readyState !== WS_OPEN_STATE) return;

    try {
      client.send(message);
    } catch (error) {
      console.error(
        `[SimpleList] could not send a simple_list_changed frame to a client: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });
}

/**
 * The simple list's folders and its feed. Consumed by `simple-list.routes.ts` (the four writes)
 * and by `provider.routes.ts`'s `GET /sessions/recent` (`readFeed`, when `simpleList=true`).
 */
export const simpleListService = {
  /**
   * The simple list's feed: one page of top-level rows, each folder whole.
   *
   * The rows are the ladder's order thinned to what the recents query can see: a tagged chat the
   * query leaves out — archived, in an archived project, or in a scratch folder — is dropped, so
   * the feed never names a chat the sidebar cannot draw. A chat whose folder row is gone reads as
   * loose and lands at the top level. Every chat the drawn rows hold is answered in `conversations`
   * in drawn order, a folder's chats in the folder's own place.
   */
  readFeed(
    limit: number,
    offset: number
  ): { conversations: RecentChat[]; layout: SimpleListLayoutItem[]; total: number; hasMore: boolean } {
    // Every tagged chat in one read, unpaged: the walk below has to see a chat to place it, and a
    // chat it cannot see is one this page does not draw.
    const chats = sessionsService.listRecentSessions(EVERY_TAGGED_CHAT, 0, { simpleListOnly: true })
      .conversations;
    const chatById = new Map(chats.map((chat) => [chat.sessionId, chat]));

    // One layout folder per stored folder, filled by the ladder walk below. A folder the ladder
    // does not hold draws nowhere, so the two reads cannot put a folder in the feed twice.
    const foldersById = new Map<string, SimpleListLayoutFolder>();
    for (const folder of simpleListDb.listFolders()) {
      foldersById.set(folder.folder_id, {
        kind: 'folder',
        folderId: folder.folder_id,
        name: folder.name,
        collapsed: Boolean(folder.collapsed),
        sessionIds: [],
      });
    }

    const topLevel: SimpleListLayoutItem[] = [];
    for (const entry of simpleListDb.readLadder()) {
      if (entry.kind === 'folder') {
        const folder = foldersById.get(entry.id);
        if (folder) topLevel.push(folder);
        continue;
      }

      if (!chatById.has(entry.id)) continue;

      const folder = entry.folderId === null ? undefined : foldersById.get(entry.folderId);
      if (folder) {
        folder.sessionIds.push(entry.id);
        continue;
      }

      topLevel.push({ kind: 'chat', sessionId: entry.id });
    }

    const layout = topLevel.slice(offset, offset + limit);
    const total = topLevel.length;

    // What the picker lists, in the order the list draws it, so the two can never disagree.
    const conversations: RecentChat[] = [];
    for (const chat of layout) {
      const sessionIds = chat.kind === 'chat' ? [chat.sessionId] : chat.sessionIds;
      for (const sessionId of sessionIds) {
        const row = chatById.get(sessionId);
        if (row) conversations.push(row);
      }
    }

    return { conversations, layout, total, hasMore: offset + layout.length < total };
  },

  /** Makes one folder at the top of the list. The id is the server's to mint: a client never chooses one. */
  createFolder(name: string): { folderId: string; name: string; collapsed: boolean } {
    const row = simpleListDb.createFolder(randomUUID(), name);
    broadcastSimpleListChanged();

    return { folderId: row.folder_id, name: row.name, collapsed: Boolean(row.collapsed) };
  },

  /** Renames a folder, folds it, or both. A folder that is gone answers the 404 the routes carry. */
  updateFolder(
    folderId: string,
    change: { name?: string; collapsed?: boolean }
  ): { folderId: string; name: string; collapsed: boolean } {
    const row = simpleListDb.updateFolder(folderId, change);
    if (row === null) throw folderNotFound(folderId);

    broadcastSimpleListChanged();
    return { folderId: row.folder_id, name: row.name, collapsed: Boolean(row.collapsed) };
  },

  /**
   * Deletes a folder and answers how many chats it released into the folder's own place. A folder
   * that is gone answers the 404 the routes carry.
   */
  deleteFolder(folderId: string): { folderId: string; released: number } {
    const released = simpleListDb.deleteFolder(folderId);
    if (released === null) throw folderNotFound(folderId);

    broadcastSimpleListChanged();
    return { folderId, released };
  },

  /**
   * Moves one chat or folder into a container and directly after an anchor, and answers the
   * position back. What the state refuses is translated here, so the route only formats it.
   */
  moveItem(
    item: SimpleListLadderItem,
    folderId: string | null,
    after: SimpleListLadderItem | null
  ): { item: SimpleListLadderItem; folderId: string | null; after: SimpleListLadderItem | null } {
    const verdict = simpleListDb.moveItem(item, folderId, after);
    if (verdict !== 'moved') throw moveRefused(verdict, item, folderId);

    broadcastSimpleListChanged();
    return { item, folderId, after };
  },
};
