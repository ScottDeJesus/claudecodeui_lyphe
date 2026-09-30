import { useCallback, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import type {
  RecentConversationListItem,
  SimpleListFolder,
  SimpleListItem,
  SimpleListItemRef,
  SimpleListPosition,
} from '@/shared/types';

/** The folder whose chats hold that session; null when the chat sits at the top level, or in no tree at all. */
function folderHoldingChat(items: SimpleListItem[], sessionId: string): string | null {
  for (const item of items) {
    if (item.kind !== 'folder') continue;
    if (item.folder.chats.some((chat) => chat.sessionId === sessionId)) return item.folder.folderId;
  }
  return null;
}

/**
 * Owns the simple list's folder verbs — making a folder, renaming, folding, deleting, and moving
 * rows into and out of one — so SidebarSimpleList stays the composer and its rows stay
 * presentational, the division `useSimpleChatRemove` keeps for the disposals.
 *
 * EVERY WRITE IS OPTIMISTIC AND EVERY REFUSAL IS SETTLED BY THE SERVER. A rename, a fold and a move
 * land in the tree first (`patchFolderLocal`, `moveLocal`) and the route is asked for the same thing
 * a moment later; a route that refuses or fails is logged and followed by a `reload()`, which puts
 * the list back to exactly what the server holds. One rule, all seven verbs.
 *
 * THE FOLDER'S BIRTH NAME IS A WORD, NOT AN EMPTY STRING: a new folder is called
 * `simpleList.newFolder` until the fresh header opens its rename input — the row's `isFresh` turn,
 * driven by the id this hook remembers — and the reader types over it, selected whole.
 *
 * Used by SidebarSimpleList.
 */
export function useSimpleChatFolders(input: {
  /** The tree as the feed holds it: which folders exist, where a chat sits now, and what a delete releases. */
  items: SimpleListItem[];
  /** Re-reads the feed; the floor every refused or failed write falls back to. */
  reload: () => Promise<void>;
  /** The optimistic write behind a folder's rename and its fold. */
  patchFolderLocal: (folderId: string, patch: Partial<Pick<SimpleListFolder, 'name' | 'collapsed'>>) => void;
  /** The optimistic write behind a carried row. */
  moveLocal: (item: SimpleListItemRef, position: SimpleListPosition) => void;
  /** The sidebar's translations: a new folder is born with the "New folder" name. */
  t: TFunction;
}): {
  /** The folder just made, or null: its header opens its rename input once, then calls `onFreshShown`. */
  freshFolderId: string | null;
  /** The fresh header has been seen; the list stops treating that folder as fresh. */
  onFreshShown: () => void;
  /** The chat whose "Move to folder…" dialog is open, or null when none is. */
  pickerChat: RecentConversationListItem | null;
  /** The folder that chat sits in now; null for a chat in none. */
  pickerFolderId: string | null;
  /** The folder whose delete waits on a yes, or null when no question is open. */
  pendingDeleteFolder: SimpleListFolder | null;
  createFolder: () => void;
  renameFolder: (folderId: string, name: string) => void;
  toggleFolder: (folder: SimpleListFolder) => void;
  requestDelete: (folder: SimpleListFolder) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
  openFolderPicker: (chat: RecentConversationListItem) => void;
  closeFolderPicker: () => void;
  moveToFolder: (folderId: string | null) => void;
  move: (item: SimpleListItemRef, position: SimpleListPosition) => void;
} {
  const { items, reload, patchFolderLocal, moveLocal, t } = input;

  // The chat whose "Move to folder…" dialog is open, null when none is. The chat the question is
  // about and the dialog's own open flag are the same fact, so closing is one write of null and
  // the two can never disagree about which row the answer belongs to.
  const [pickerChat, setPickerChat] = useState<RecentConversationListItem | null>(null);
  // The folder whose delete waits on a yes, null when no question is open. Only a folder that
  // HOLDS CHATS is ever held here: an empty one releases nothing, so it is deleted at once and
  // this stays null for it.
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<SimpleListFolder | null>(null);
  // The folder that has just been made: its header opens its name for typing and scrolls itself
  // into view, once. Cleared through `onFreshShown` the moment the row has shown it, so the input
  // opens exactly once per folder and a rename the reader starts by hand is never re-seeded.
  const [freshFolderId, setFreshFolderId] = useState<string | null>(null);

  // The folder the picker's chat sits in, read from the tree so the option the dialog presses
  // cannot disagree with where the chat is drawn. Derived rather than state: the tree is the one
  // answer, and a second copy could go stale against a reload.
  const pickerFolderId = useMemo(
    () => (pickerChat === null ? null : folderHoldingChat(items, pickerChat.sessionId)),
    [items, pickerChat],
  );

  /** Deletes one folder and re-reads the feed. A refusal or a failure is logged first; the reload settles the list either way. */
  const deleteFolderNow = useCallback(async (folderId: string) => {
    try {
      const response = await api.simpleList.deleteFolder(folderId);
      if (!response.ok) throw new Error(`deleteFolder answered HTTP ${response.status}`);
    } catch (error) {
      console.error('[SidebarSimpleList] Failed to delete the folder:', error);
    }
    await reload();
  }, [reload]);

  /** The optimistic write behind a folder's rename and its fold: the header changes at once, the route is asked, and a refusal or a failure is logged and answered with a reload that puts the header back. */
  const pushFolderChange = useCallback(async (folderId: string, change: { name?: string; collapsed?: boolean }) => {
    try {
      const response = await api.simpleList.updateFolder(folderId, change);
      if (!response.ok) throw new Error(`updateFolder answered HTTP ${response.status}`);
    } catch (error) {
      console.error('[SidebarSimpleList] Failed to update the folder:', error);
      await reload();
    }
  }, [reload]);

  /** Makes a folder named "New folder", re-reads the feed so its block is drawn, and remembers its id as the fresh one. */
  const createFolder = useCallback(() => {
    void (async () => {
      try {
        const response = await api.simpleList.createFolder(t('simpleList.newFolder'));
        if (!response.ok) throw new Error(`createFolder answered HTTP ${response.status}`);
        const payload = (await response.json()) as { data?: { folderId?: string } };
        const folderId = payload.data?.folderId;
        await reload();
        if (typeof folderId === 'string') setFreshFolderId(folderId);
      } catch (error) {
        console.error('[SidebarSimpleList] Failed to create the folder:', error);
        await reload();
      }
    })();
  }, [reload, t]);

  const renameFolder = useCallback((folderId: string, name: string) => {
    patchFolderLocal(folderId, { name });
    void pushFolderChange(folderId, { name });
  }, [patchFolderLocal, pushFolderChange]);

  const toggleFolder = useCallback((folder: SimpleListFolder) => {
    patchFolderLocal(folder.folderId, { collapsed: !folder.collapsed });
    void pushFolderChange(folder.folderId, { collapsed: !folder.collapsed });
  }, [patchFolderLocal, pushFolderChange]);

  const requestDelete = useCallback((folder: SimpleListFolder) => {
    // A folder that holds chats gives them back to the list where it stood, so it stops to ask;
    // an empty one has nothing to release and goes at once.
    if (folder.chats.length === 0) {
      void deleteFolderNow(folder.folderId);
      return;
    }
    setPendingDeleteFolder(folder);
  }, [deleteFolderNow]);

  const confirmDelete = useCallback(() => {
    const folder = pendingDeleteFolder;
    setPendingDeleteFolder(null);
    if (folder !== null) void deleteFolderNow(folder.folderId);
  }, [deleteFolderNow, pendingDeleteFolder]);

  const cancelDelete = useCallback(() => setPendingDeleteFolder(null), []);

  const onFreshShown = useCallback(() => setFreshFolderId(null), []);

  /** The carry's `onMove`: the row lands where the pointer left it at once, and the server is asked for the same place. */
  const move = useCallback((item: SimpleListItemRef, position: SimpleListPosition) => {
    moveLocal(item, position);
    void (async () => {
      try {
        const response = await api.simpleList.move(item, position);
        if (!response.ok) throw new Error(`move answered HTTP ${response.status}`);
      } catch (error) {
        console.error('[SidebarSimpleList] Failed to move the row:', error);
        await reload();
      }
    })();
  }, [moveLocal, reload]);

  const openFolderPicker = useCallback((chat: RecentConversationListItem) => setPickerChat(chat), []);
  const closeFolderPicker = useCallback(() => setPickerChat(null), []);

  const moveToFolder = useCallback((folderId: string | null) => {
    const chat = pickerChat;
    // Closed first: the row's own move below is this pick's feedback, and the dialog must not
    // outlive the answer it was asked for.
    setPickerChat(null);
    if (chat === null) return;
    const ref: SimpleListItemRef = { kind: 'chat', id: chat.sessionId };

    if (folderId !== null) {
      // Into a folder: the chat lands first in it, directly under the folder's own name.
      move(ref, { folderId, after: null });
      return;
    }

    // Out of one: the chat lands at the top level directly UNDER the folder it leaves, so the
    // reader can see where it went rather than hunting for it at the top of the list. A chat
    // already at the top level leaves nothing, and picking "No folder" for it asks for the place
    // it already holds — no write.
    const leaving = folderHoldingChat(items, chat.sessionId);
    if (leaving === null) return;
    move(ref, { folderId: null, after: { kind: 'folder', id: leaving } });
  }, [items, move, pickerChat]);

  return {
    freshFolderId,
    onFreshShown,
    pickerChat,
    pickerFolderId,
    pendingDeleteFolder,
    createFolder,
    renameFolder,
    toggleFolder,
    requestDelete,
    confirmDelete,
    cancelDelete,
    openFolderPicker,
    closeFolderPicker,
    moveToFolder,
    move,
  };
}
