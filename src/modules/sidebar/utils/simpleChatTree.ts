import type {
  RecentConversationListItem,
  SimpleListDropTarget,
  SimpleListFolder,
  SimpleListItem,
  SimpleListItemRef,
  SimpleListLayoutItem,
  SimpleListPosition,
} from '@/shared/types';

/**
 * The simple chat list's tree: pure functions and nothing else — no React, no state, no fetch.
 *
 * Two hooks of this module are its consumers. `hooks/useSimpleChatList.ts` (the feed) holds the tree
 * and makes every change to it here: a page becomes `treeFromFeed`, a later page `appendPage`, a
 * rename `patchChat`, a fold `patchFolder`, an archive `removeChat`, a carried row `moveItem`.
 * `hooks/useSimpleChatDrag.ts` (the carry) turns the row under the pointer into a position through
 * `positionForDrop`.
 *
 * A CONTAINER is where rows sit: the top level holds loose chats and folders, and a folder holds its
 * chats. A `SimpleListPosition` names a container (`folderId`, null for the top level) and the row
 * the moved one sits directly after in it, null meaning first. `positionOf` reads a row's place in
 * exactly those terms and `moveItem` writes it, so the two agree by construction — which is what
 * lets `positionForDrop` answer null for a drop that changes nothing rather than send the server a
 * write it would refuse.
 */

/** One container of the tree: the refs of the rows it holds, in order, and the folder id that names it (null = the top level). */
type Container = { folderId: string | null; refs: SimpleListItemRef[] };

/** What a top-level row is held by: a chat by its session id, a folder by its folder id, the two prefixed so a folder cannot pass for a chat of that id. */
const keyOf = (item: SimpleListItem): string =>
  item.kind === 'chat' ? `chat:${item.chat.sessionId}` : `folder:${item.folder.folderId}`;

/** Whether two refs name the same row. */
const refsEqual = (a: SimpleListItemRef, b: SimpleListItemRef): boolean => a.kind === b.kind && a.id === b.id;

/** Whether two positions name the same place: one container, and one row to sit after. */
function positionsEqual(a: SimpleListPosition, b: SimpleListPosition): boolean {
  if (a.folderId !== b.folderId) return false;
  if (a.after === null || b.after === null) return a.after === b.after;
  return refsEqual(a.after, b.after);
}

/** The feed's two halves joined: `layout` in order, each id replaced by its row of `conversations`. An id with no row is dropped. */
export function treeFromFeed(conversations: RecentConversationListItem[], layout: SimpleListLayoutItem[]): SimpleListItem[] {
  const bySessionId = new Map(conversations.map((chat) => [chat.sessionId, chat]));
  const chatsOf = (sessionIds: string[]): RecentConversationListItem[] =>
    sessionIds.flatMap((sessionId) => {
      const chat = bySessionId.get(sessionId);
      return chat === undefined ? [] : [chat];
    });
  return layout.flatMap((entry): SimpleListItem[] => {
    if (entry.kind === 'chat') {
      const chat = bySessionId.get(entry.sessionId);
      return chat === undefined ? [] : [{ kind: 'chat', chat }];
    }
    return [{
      kind: 'folder',
      folder: { folderId: entry.folderId, name: entry.name, collapsed: entry.collapsed, chats: chatsOf(entry.sessionIds) },
    }];
  });
}

/** The ref that names a top-level row. */
export function refOf(item: SimpleListItem): SimpleListItemRef {
  return item.kind === 'chat'
    ? { kind: 'chat', id: item.chat.sessionId }
    : { kind: 'folder', id: item.folder.folderId };
}

/** Every chat of the tree, flat, in drawn order: a folder's chats in its place, folded or not. */
export function flattenChats(items: SimpleListItem[]): RecentConversationListItem[] {
  return items.flatMap((item) => (item.kind === 'chat' ? [item.chat] : item.folder.chats));
}

/** `previous` with the top-level rows of `page` it does not already hold appended. */
export function appendPage(previous: SimpleListItem[], page: SimpleListItem[]): SimpleListItem[] {
  const held = new Set(previous.map(keyOf));
  const appended = page.filter((item) => !held.has(keyOf(item)));
  // A folder already held keeps its own chats, so a page that brings nothing new changes nothing.
  return appended.length === 0 ? previous : [...previous, ...appended];
}

/** `items` with that chat's fields replaced — at the top level, or in whichever folder holds it. Every other row keeps its identity. */
export function patchChat(
  items: SimpleListItem[],
  sessionId: string,
  patch: Partial<Pick<RecentConversationListItem, 'sessionTitle' | 'icon'>>,
): SimpleListItem[] {
  return items.map((item): SimpleListItem => {
    if (item.kind === 'chat') {
      return item.chat.sessionId === sessionId ? { kind: 'chat', chat: { ...item.chat, ...patch } } : item;
    }
    const chats = item.folder.chats.map((chat) => (chat.sessionId === sessionId ? { ...chat, ...patch } : chat));
    const changed = chats.some((chat, index) => chat !== item.folder.chats[index]);
    return changed ? { kind: 'folder', folder: { ...item.folder, chats } } : item;
  });
}

/** `items` with that folder's name or fold replaced. Every other row keeps its identity. */
export function patchFolder(
  items: SimpleListItem[],
  folderId: string,
  patch: Partial<Pick<SimpleListFolder, 'name' | 'collapsed'>>,
): SimpleListItem[] {
  return items.map((item): SimpleListItem => (
    item.kind === 'folder' && item.folder.folderId === folderId
      ? { kind: 'folder', folder: { ...item.folder, ...patch } }
      : item
  ));
}

/** The tree without that chat, and whether it was a top-level row. Null when the tree does not hold it. */
export function removeChat(items: SimpleListItem[], sessionId: string): { items: SimpleListItem[]; wasTopLevel: boolean } | null {
  const at = chatIn(items, sessionId);
  if (at === null) return null;
  return { items: withoutChat(items, sessionId), wasTopLevel: at.folderId === null };
}

/** Where a row sits now. Null when the tree does not hold it. */
export function positionOf(items: SimpleListItem[], ref: SimpleListItemRef): SimpleListPosition | null {
  const container = containerOf(items, ref);
  if (container === null) return null;
  const index = container.refs.findIndex((row) => refsEqual(row, ref));
  return { folderId: container.folderId, after: index <= 0 ? null : container.refs[index - 1] };
}

/** The tree with the row at `position`. The SAME array when the row, the folder or the anchor is not in it. */
export function moveItem(items: SimpleListItem[], ref: SimpleListItemRef, position: SimpleListPosition): SimpleListItem[] {
  return ref.kind === 'folder' ? moveFolder(items, ref, position) : moveChat(items, ref, position);
}

/** The position a drop asks for. Null when it asks for nothing. */
export function positionForDrop(
  items: SimpleListItem[],
  carried: SimpleListItemRef,
  target: SimpleListDropTarget,
): SimpleListPosition | null {
  const position = placeForDrop(items, carried, target);
  if (position === null) return null;
  const current = positionOf(items, carried);
  // A row the tree does not hold cannot be moved, and a drop asking for the place the row already
  // has is no move at all: both answer null, so the carry sends no write the server would refuse.
  if (current === null) return null;
  return positionsEqual(current, position) ? null : position;
}

/** The folder a folder id names, or null when the tree holds none. */
function folderIn(items: SimpleListItem[], folderId: string): SimpleListFolder | null {
  for (const item of items) {
    if (item.kind === 'folder' && item.folder.folderId === folderId) return item.folder;
  }
  return null;
}

/** Where the tree holds a chat row, and the folder it sits in (null = the top level). Null when it holds none. */
function chatIn(items: SimpleListItem[], sessionId: string): { chat: RecentConversationListItem; folderId: string | null } | null {
  for (const item of items) {
    if (item.kind === 'chat') {
      if (item.chat.sessionId === sessionId) return { chat: item.chat, folderId: null };
      continue;
    }
    const chat = item.folder.chats.find((row) => row.sessionId === sessionId);
    if (chat !== undefined) return { chat, folderId: item.folder.folderId };
  }
  return null;
}

/** The tree without that chat row, wherever it sat; the tree itself when it held none. */
function withoutChat(items: SimpleListItem[], sessionId: string): SimpleListItem[] {
  if (items.some((item) => item.kind === 'chat' && item.chat.sessionId === sessionId)) {
    return items.filter((item) => !(item.kind === 'chat' && item.chat.sessionId === sessionId));
  }
  return items.map((item): SimpleListItem => {
    if (item.kind !== 'folder') return item;
    const chats = item.folder.chats.filter((chat) => chat.sessionId !== sessionId);
    return chats.length === item.folder.chats.length ? item : { kind: 'folder', folder: { ...item.folder, chats } };
  });
}

/** The container a row sits in: its refs, and the folder id that names it (null = the top level). Null when the tree holds no such row. */
function containerOf(items: SimpleListItem[], ref: SimpleListItemRef): Container | null {
  if (ref.kind === 'folder') {
    return folderIn(items, ref.id) === null ? null : { folderId: null, refs: items.map(refOf) };
  }
  if (items.some((item) => item.kind === 'chat' && item.chat.sessionId === ref.id)) {
    return { folderId: null, refs: items.map(refOf) };
  }
  for (const item of items) {
    if (item.kind !== 'folder') continue;
    if (item.folder.chats.some((chat) => chat.sessionId === ref.id)) {
      return {
        folderId: item.folder.folderId,
        refs: item.folder.chats.map((chat) => ({ kind: 'chat', id: chat.sessionId })),
      };
    }
  }
  return null;
}

/** The ref directly above `ref` in its own container, not counting `skip`; null when none is. */
function refAbove(items: SimpleListItem[], ref: SimpleListItemRef, skip: SimpleListItemRef): SimpleListItemRef | null {
  const container = containerOf(items, ref);
  if (container === null) return null;
  const index = container.refs.findIndex((row) => refsEqual(row, ref));
  for (let above = index - 1; above >= 0; above -= 1) {
    const row = container.refs[above];
    if (!refsEqual(row, skip)) return row;
  }
  return null;
}

/** The last top-level row, not counting `skip`; null when none is. */
function lastTopLevel(items: SimpleListItem[], skip: SimpleListItemRef): SimpleListItemRef | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const ref = refOf(items[index]);
    if (!refsEqual(ref, skip)) return ref;
  }
  return null;
}

/** Where among top-level `rows` the row lands: directly after `after`, or first when it is null. Null when `after` is not one of them. */
function insertIndex(rows: SimpleListItem[], after: SimpleListItemRef | null): number | null {
  if (after === null) return 0;
  const index = rows.findIndex((row) => refsEqual(refOf(row), after));
  return index === -1 ? null : index + 1;
}

/**
 * A chat goes to the top level or into a folder. It leaves its own container first — so the anchor is
 * judged against what then stands, a chat cannot anchor on itself, and one already in the target
 * folder leaves it before it is put back.
 */
function moveChat(items: SimpleListItem[], ref: SimpleListItemRef, position: SimpleListPosition): SimpleListItem[] {
  const at = chatIn(items, ref.id);
  if (at === null) return items;
  const rest = withoutChat(items, ref.id);

  if (position.folderId === null) {
    const landing = insertIndex(rest, position.after);
    if (landing === null) return items;
    return [...rest.slice(0, landing), { kind: 'chat', chat: at.chat }, ...rest.slice(landing)];
  }

  const folderIndex = rest.findIndex((item) => item.kind === 'folder' && item.folder.folderId === position.folderId);
  const folderItem = rest[folderIndex];
  if (folderItem === undefined || folderItem.kind !== 'folder') return items;
  const anchor = position.after;
  if (anchor !== null && anchor.kind !== 'chat') return items;
  const anchorIndex = anchor === null ? -1 : folderItem.folder.chats.findIndex((chat) => chat.sessionId === anchor.id);
  if (anchor !== null && anchorIndex === -1) return items;
  const chats = folderItem.folder.chats;
  const landing = anchorIndex + 1;
  const folder: SimpleListFolder = {
    ...folderItem.folder,
    chats: [...chats.slice(0, landing), at.chat, ...chats.slice(landing)],
  };
  return rest.map((item, index) => (index === folderIndex ? { kind: 'folder', folder } : item));
}

/** A folder lives at the top level alone and keeps its chats, so any other container is refused. */
function moveFolder(items: SimpleListItem[], ref: SimpleListItemRef, position: SimpleListPosition): SimpleListItem[] {
  if (position.folderId !== null) return items;
  const index = items.findIndex((item) => item.kind === 'folder' && item.folder.folderId === ref.id);
  if (index === -1) return items;
  const moved = items[index];
  const rest = [...items.slice(0, index), ...items.slice(index + 1)];
  const landing = insertIndex(rest, position.after);
  if (landing === null) return items;
  return [...rest.slice(0, landing), moved, ...rest.slice(landing)];
}

/** The table of Interfaces 5, before its no-op rule: what each carried row, over each drawn target, asks for. */
function placeForDrop(items: SimpleListItem[], carried: SimpleListItemRef, target: SimpleListDropTarget): SimpleListPosition | null {
  if (target.at === 'end') {
    return { folderId: null, after: lastTopLevel(items, carried) };
  }
  if (target.at === 'into') {
    // Only a chat may go into a folder: a folder is a top-level row and nowhere else.
    return carried.kind === 'folder' ? null : { folderId: target.folderId, after: null };
  }
  const container = containerOf(items, target.item);
  if (container === null) return null;
  // A folder carried over a chat the tree holds inside a folder: that is no place for it.
  if (carried.kind === 'folder' && container.folderId !== null) return null;
  return {
    folderId: container.folderId,
    after: target.edge === 'after' ? target.item : refAbove(items, target.item, carried),
  };
}
