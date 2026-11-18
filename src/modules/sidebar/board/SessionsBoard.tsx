import { useCallback, useMemo, useState } from 'react';
import { Archive, FolderPlus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BoardChatRow } from '@/modules/sidebar/board/BoardChatRow';
import { ClosedChatsDialog } from '@/modules/sidebar/board/ClosedChatsDialog';
import { BoardFolder } from '@/modules/sidebar/board/BoardFolder';
import { useBoardCarry } from '@/modules/sidebar/hooks/useBoardCarry';
import { useSimpleChatFolders } from '@/modules/sidebar/hooks/useSimpleChatFolders';
import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { useSimpleChatProject } from '@/modules/sidebar/hooks/useSimpleChatProject';
import { useSimpleChatRemove } from '@/modules/sidebar/hooks/useSimpleChatRemove';
import { subagentDots } from '@/modules/sidebar/utils/simpleChatMarks';
import SidebarSimpleDeleteDialog from '@/modules/sidebar/SidebarSimpleDeleteDialog';
import SidebarSimpleFolderPicker from '@/modules/sidebar/SidebarSimpleFolderPicker';
import SidebarSimpleStopDialog from '@/modules/sidebar/SidebarSimpleStopDialog';
import { api } from '@/shared/api';
import { useSessionHostLiveSet } from '@/shared/context/SessionHostLivenessContext';
import { useAwaitingInputSessionIdSet, useBusySessionIdSet, useSubagentRunningSessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useSubagentModelsBySession } from '@/shared/context/subagentModelsContext';
import { projectNameHints } from '@/shared/projectNameHints';
import type { Project, RecentConversationListItem } from '@/shared/types';
import { Button, ConfirmDialog, EmptyState, Spinner } from '@/shared/ui';

type SessionsBoardProps = {
  /** The workspace's projects: what names a chat's project apart from another of its name, and where a new chat starts. */
  projects: Project[];
  /** False until the board's page has been on screen once: until then no page of the feed is read and no socket subscription is held. */
  enabled: boolean;
  /** A chat was pressed: its page shows it. */
  onOpenChat: (chat: RecentConversationListItem) => void;
  /** New chat: the workspace's new-chat screen, in the project the simple list starts chats in. */
  onNewChat: (project: Project) => void;
  /** A chat was closed or deleted from the board, so the workspace lets go of it if it was the one open. */
  onSessionRemoved: (sessionId: string) => void;
};

/**
 * THE SIMPLE CHAT LIST AS A BOARD: every chat started from the list, laid out by folder, a column per folder and one for the chats in none, each chat a
 * tile that shows its state by how it stands (`SessionTile`). It is the sidebar's list (`SidebarSimpleList`) in another form and nothing else: the same feed
 * (`useSimpleChatList`, a second copy of its rows, kept on the same frames), the same folder verbs (`useSimpleChatFolders`), the same disposals with their
 * questions (`useSimpleChatRemove`, the stop and delete dialogs), the same pin write and the same rename. What a press does here it does there.
 *
 * CARRIED BY HAND, as on the list (`useBoardCarry`, the list's carry for columns side by side, feeding the same one write): a chat by its row, to a
 * place before or after a chat in any column, into a folder that holds none, or out of every folder; a folder by its name, with its whole column, to
 * either side of another folder. Where it would land is a line in the accent. While a chat from a folder is in the hand and no chat is outside one, the
 * "No folder" column is drawn empty, so there is somewhere to carry it out to. "Move to folder…" in a chat's menu still does it without a carry.
 *
 * WHAT THE BOARD LEAVES TO THE LIST: folding a folder (a column has no fold), and a chat's icon (the tile stands where the icon does).
 *
 * THE ORDER is the feed's: folders in the order the list draws them, each folder's chats in its own order, and the chats in no folder gathered, in their
 * order, in one last column.
 *
 * Exported through the sidebar barrel for project-workspace's sessions home (`WorkspaceHome`), which hands it the workspace's projects and its three presses.
 */
export function SessionsBoard({ projects, enabled, onOpenChat, onNewChat, onSessionRemoved }: SessionsBoardProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const busySessionIds = useBusySessionIdSet();
  const awaitingInputSessionIds = useAwaitingInputSessionIdSet();
  const subagentRunningSessionIds = useSubagentRunningSessionIdSet();
  const subagentModels = useSubagentModelsBySession();
  const liveHostSessionIds = useSessionHostLiveSet();

  const [closedOpen, setClosedOpen] = useState(false);

  // No chat is open on the board, so the feed is asked to keep none in view.
  const { items, hasMore, isLoading, hasError, reload, loadMore, patchLocal, patchFolderLocal, removeLocal, moveLocal } = useSimpleChatList(null, enabled);

  const handleClosed = useCallback((sessionId: string) => {
    removeLocal(sessionId);
    onSessionRemoved(sessionId);
  }, [removeLocal, onSessionRemoved]);
  const { pendingStop, pendingDelete, failedSessionId, remove, confirmStop, cancelStop, confirmDelete, cancelDelete } = useSimpleChatRemove({ onClosed: handleClosed });

  const newChatProject = useSimpleChatProject(projects);
  const projectHints = useMemo(() => projectNameHints(projects), [projects]);

  // The list's own rename: the title shows at once, and a write the server refused puts it back.
  const handleRename = useCallback(async (chat: RecentConversationListItem, title: string) => {
    patchLocal(chat.sessionId, { sessionTitle: title });
    try {
      const response = await api.renameSession(chat.sessionId, title);
      if (!response.ok) throw new Error(`renameSession answered HTTP ${response.status}`);
    } catch (error) {
      console.error('[SessionsBoard] Failed to rename the chat:', error);
      patchLocal(chat.sessionId, { sessionTitle: chat.sessionTitle });
    }
  }, [patchLocal]);

  // The list's own pin: the mark shows at once, the server's `session_upserted` re-read confirms it, and a refused write puts the mark back.
  const handleTogglePin = useCallback(async (chat: RecentConversationListItem) => {
    const next = !chat.pinned;
    patchLocal(chat.sessionId, { pinned: next });
    try {
      const response = await api.setSessionPinned(chat.sessionId, next);
      if (!response.ok) throw new Error(`setSessionPinned answered HTTP ${response.status}`);
    } catch (error) {
      console.error('[SessionsBoard] Failed to pin or unpin the chat:', error);
      patchLocal(chat.sessionId, { pinned: chat.pinned });
    }
  }, [patchLocal]);

  const {
    freshFolderId, onFreshShown, pickerChat, pickerFolderId, pendingDeleteFolder, createFolder, renameFolder, requestDelete,
    openFolderPicker, closeFolderPicker, moveToFolder, move, confirmDelete: confirmFolderDelete, cancelDelete: cancelFolderDelete,
  } = useSimpleChatFolders({ items, reload, patchFolderLocal, moveLocal, t });

  // The carry, feeding the folder hook's own `move`: a drop and a "Move to folder…" are one write.
  const { dragging, dropTarget, dragProps, boardRef } = useBoardCarry({ items, onMove: move });
  // Where the thing in the hand would land, as each row and column reads it.
  const rowTarget = dropTarget !== null && dropTarget.at === 'row' ? dropTarget : null;

  const folders = items.flatMap((item) => (item.kind === 'folder' ? [item.folder] : []));
  const loose = items.flatMap((item) => (item.kind === 'chat' ? [item.chat] : []));

  const chatRow = (chat: RecentConversationListItem) => (
    <BoardChatRow
      key={chat.sessionId}
      row={chat}
      isRunning={busySessionIds.has(chat.sessionId)}
      isAwaitingInput={awaitingInputSessionIds.has(chat.sessionId)}
      isSubagentRunning={subagentRunningSessionIds.has(chat.sessionId)}
      subagents={subagentDots(subagentRunningSessionIds.has(chat.sessionId), subagentModels.get(chat.sessionId))}
      // Only a Claude chat can have a session host, so only one can be asleep, and none is until the server's first census has arrived.
      isAsleep={liveHostSessionIds !== null && chat.provider === 'claude' && !liveHostSessionIds.has(chat.sessionId)}
      isRemoveFailed={failedSessionId === chat.sessionId}
      projectNameHint={(chat.projectId && projectHints.get(chat.projectId)) || null}
      onSelect={() => onOpenChat(chat)}
      onClose={() => remove(chat, 'close')}
      onTogglePin={() => void handleTogglePin(chat)}
      onDelete={() => remove(chat, 'delete')}
      onRename={(title) => void handleRename(chat, title)}
      // A board with no folder offers no way into one.
      onMoveToFolder={folders.length === 0 ? null : () => openFolderPicker(chat)}
      dragProps={dragProps}
      isDragging={dragging !== null && dragging.kind === 'chat' && dragging.id === chat.sessionId}
      dropEdge={rowTarget !== null && rowTarget.item.kind === 'chat' && rowTarget.item.id === chat.sessionId ? rowTarget.edge : null}
      t={t}
    />
  );

  // The two ways something new starts, and the way back to a closed chat, after the last column: each a button with its mark and its word; under a finger, the mark alone.
  const starts = (
    <div className="flex flex-wrap gap-2 pl-[13px]">
      <Button
        data-board-new-chat
        variant="outline"
        size="sm"
        className="finger:h-11 finger:w-11 finger:px-0"
        disabled={!newChatProject}
        aria-label={t('simpleList.newChat')}
        title={t('simpleList.newChat')}
        onClick={() => newChatProject && onNewChat(newChatProject)}
      >
        <Plus aria-hidden="true" />
        <span className="finger:hidden">{t('simpleList.newChat')}</span>
      </Button>
      <Button
        data-board-new-folder
        variant="outline"
        size="sm"
        className="finger:h-11 finger:w-11 finger:px-0"
        aria-label={t('simpleList.newFolder')}
        title={t('simpleList.newFolder')}
        onClick={() => void createFolder()}
      >
        <FolderPlus aria-hidden="true" />
        <span className="finger:hidden">{t('simpleList.newFolder')}</span>
      </Button>
      <Button
        data-board-closed
        variant="outline"
        size="sm"
        className="finger:h-11 finger:w-11 finger:px-0"
        aria-label={t('search.modeClosed')}
        title={t('search.modeClosed')}
        onClick={() => setClosedOpen(true)}
      >
        <Archive aria-hidden="true" />
        <span className="finger:hidden">{t('search.modeClosed')}</span>
      </Button>
    </div>
  );

  return (
    <div ref={boardRef} data-sessions-board data-board-carrying={dragging?.kind} className="mx-auto flex w-full min-w-0 max-w-[1180px] flex-col gap-7">
      {hasError && items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
          <Button variant="outline" size="sm" onClick={() => void reload()}>{t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}</Button>
        </div>
      ) : isLoading && items.length === 0 ? (
        <div className="grid place-items-center py-16"><Spinner size={32} /></div>
      ) : items.length === 0 ? (
        <div data-board-empty className="flex flex-col items-center gap-4 py-10">
          <EmptyState title={t('board.empty')} />
          {starts}
        </div>
      ) : (
        <>
          <div className="grid items-start gap-x-8 gap-y-7 [grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),1fr))]">
            {folders.map((folder) => (
              <BoardFolder
                key={folder.folderId}
                folder={folder}
                isFresh={folder.folderId === freshFolderId}
                onFreshShown={onFreshShown}
                onRename={(name) => renameFolder(folder.folderId, name)}
                onDelete={() => requestDelete(folder)}
                dragProps={dragProps}
                isDragging={dragging !== null && dragging.kind === 'folder' && dragging.id === folder.folderId}
                dropInto={dropTarget !== null && dropTarget.at === 'into' && dropTarget.folderId === folder.folderId}
                dropSide={rowTarget !== null && rowTarget.item.kind === 'folder' && rowTarget.item.id === folder.folderId ? rowTarget.edge : null}
                t={t}
              >
                {folder.chats.map(chatRow)}
              </BoardFolder>
            ))}
            {/* The chats in no folder; and, with none, the same column drawn empty while a chat is in the hand, so it can be carried out of its folder. */}
            {(loose.length > 0 || dragging?.kind === 'chat') && (
              <BoardFolder
                folder={null}
                isFresh={false}
                onFreshShown={onFreshShown}
                onRename={NO_RENAME}
                onDelete={NO_PRESS}
                dropInto={dropTarget !== null && dropTarget.at === 'end'}
                t={t}
              >
                {loose.map(chatRow)}
              </BoardFolder>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {starts}
            {hasMore && <Button data-board-load-more variant="ghost" size="sm" onClick={() => void loadMore()}>{t('simpleList.loadMore')}</Button>}
          </div>
        </>
      )}

      <SidebarSimpleStopDialog open={pendingStop !== null} onConfirm={confirmStop} onCancel={cancelStop} t={t} />
      <SidebarSimpleDeleteDialog
        open={pendingDelete !== null}
        // Read at open time from the same busy model the hook acts on, so the sentence and the path it takes on confirm cannot disagree.
        isRunning={pendingDelete !== null && busySessionIds.has(pendingDelete.sessionId)}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        t={t}
      />
      <SidebarSimpleFolderPicker
        open={pickerChat !== null}
        folders={folders}
        currentFolderId={pickerFolderId}
        onPick={moveToFolder}
        onCancel={closeFolderPicker}
        t={t}
      />
      <ConfirmDialog
        open={pendingDeleteFolder !== null}
        title={t('simpleList.folderDeleteTitle')}
        message={t('simpleList.folderDeleteBody')}
        actions={[
          { label: t('actions.cancel'), variant: 'outline', onSelect: cancelFolderDelete },
          { label: t('simpleList.folderDelete'), variant: 'destructive', onSelect: confirmFolderDelete },
        ]}
        onDismiss={cancelFolderDelete}
      />
      {closedOpen && <ClosedChatsDialog onDismiss={() => setClosedOpen(false)} />}
    </div>
  );
}

/** The column of the chats in no folder has no name to change and nothing to delete. */
const NO_RENAME = (_name: string) => {};
const NO_PRESS = () => {};
