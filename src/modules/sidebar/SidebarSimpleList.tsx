import { useCallback, useEffect, useState } from 'react';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';
import { Button, ConfirmDialog, EmptyState } from '@/shared/ui';
import { useAwaitingInputSessionIdSet, useBusySessionIdSet, useSubagentRunningSessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { Project, ProjectSession, RecentConversationListItem, SessionWithProvider } from '@/shared/types';
import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { useSimpleChatProject } from '@/modules/sidebar/hooks/useSimpleChatProject';
import { useSimpleChatRemove } from '@/modules/sidebar/hooks/useSimpleChatRemove';
import { useSimpleChatDrag } from '@/modules/sidebar/hooks/useSimpleChatDrag';
import { useSimpleChatFolders } from '@/modules/sidebar/hooks/useSimpleChatFolders';
import SidebarSimpleListItems from '@/modules/sidebar/SidebarSimpleListItems';
import SidebarSimpleFolderPicker from '@/modules/sidebar/SidebarSimpleFolderPicker';
import SidebarNewChatButton from '@/modules/sidebar/SidebarNewChatButton';
import SidebarSimpleDeleteDialog from '@/modules/sidebar/SidebarSimpleDeleteDialog';
import SidebarSimpleStopDialog from '@/modules/sidebar/SidebarSimpleStopDialog';
import SidebarSimpleIconPicker from '@/modules/sidebar/SidebarSimpleIconPicker';

// File-local: this shape is read only here (the frontend standard's single-file rule for a
// prop type with exactly one consumer) — `SidebarProjectListProps` at src/shared/types.ts:1381
// is the two-file precedent this deliberately avoids.
//
// `onSessionSelect` is typed SessionWithProvider, not the wider ProjectSession the plan's prose
// names it after: it is wired directly to the controller's `handleSessionClick`, which already
// requires `__provider` (mirroring the sibling `SidebarProjectListProps.onSessionSelect`), and
// every row here always has one — RecentConversationListItem.provider is never optional.
type SidebarSimpleListProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectId: string) => void;
  onNewSession: (project: Project) => void;
  onSessionRemoved: (sessionId: string) => void;
  onRenameSession: (sessionId: string, summary: string) => Promise<void>;
  t: TFunction;
};

/**
 * Rendered by Sidebar (not SidebarContent) in place of the project tree when the "Simple chat
 * list" preference is on: the server-tagged feed of chats started from this view, drawn as a tree
 * — a loose chat, or a folder with its chats — and ending in the New chat pill and the New folder
 * button; a new chat's project is picked on the new-chat screen. The composer:
 * `useSimpleChatList` (the feed), `useSimpleChatDrag` (the carry), `useSimpleChatFolders` (the
 * folder verbs) and `useSimpleChatRemove` (the disposals) hold every rule; this file wires them to
 * `SidebarSimpleListItems` and the five dialogs below.
 */
export default function SidebarSimpleList({
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionRemoved,
  onRenameSession,
  t,
}: SidebarSimpleListProps) {
  const busySessionIds = useBusySessionIdSet();
  const awaitingInputSessionIds = useAwaitingInputSessionIdSet();
  const subagentRunningSessionIds = useSubagentRunningSessionIdSet();

  const { items, hasMore, isLoading, hasError, reload, loadMore, patchLocal, patchFolderLocal, removeLocal, moveLocal } =
    useSimpleChatList(selectedSession?.id ?? null);

  const handleArchived = useCallback((sessionId: string) => {
    removeLocal(sessionId);
    onSessionRemoved(sessionId);
  }, [removeLocal, onSessionRemoved]);

  const {
    pendingStop,
    pendingDelete,
    failedSessionId,
    remove,
    confirmStop,
    cancelStop,
    confirmDelete,
    cancelDelete,
  } = useSimpleChatRemove({ onArchived: handleArchived });

  const effectiveProject = useSimpleChatProject(projects);

  // Deliberately the ids, not the objects: a new selectedSession/selectedProject/effectiveProject
  // reference with the SAME id must not re-arm the effect below, or a parent re-render (not a
  // real transition) would fire onProjectSelect again.
  const effectiveProjectId = effectiveProject?.projectId ?? null;
  const selectedSessionId = selectedSession?.id ?? null;
  const selectedProjectId = selectedProject?.projectId ?? null;

  // Keeps Files/Git/Shell pointed at the saved project whenever no chat is open. Fires at
  // most once per transition to "no chat open": the moment it runs, selectedProject catches up
  // to effectiveProject and the guard below stops matching, so it never loops and never fires
  // while a chat IS open (the first guard). The deps array intentionally tracks ids rather than
  // the objects the body reads, for the reason above — exhaustive-deps' "missing dependency"
  // read on the objects would defeat the once-per-transition guarantee this effect exists for.
  /* oxlint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (selectedSession) return;
    if (!effectiveProject) return;
    if (selectedProject?.projectId === effectiveProject.projectId) return;
    onProjectSelect(effectiveProject);
  }, [effectiveProjectId, selectedSessionId, selectedProjectId, onProjectSelect]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  const handleRowSelect = useCallback((row: RecentConversationListItem) => {
    const project = projects.find((candidate) => candidate.projectId === row.projectId);
    // `summary` carries the row's own title across. Without it this handed the workspace a
    // session with an id and nothing else, and the workspace header read "New Session" beside
    // a sidebar row reading the real name — because `getSessionTitle` falls back to that
    // string when `summary` is empty. The URL-resolution effect in `useProjectsState` does NOT
    // repair it: its guard is `selectedSession?.id !== sessionId`, and by then the id already
    // matches, so the titleless stub stands. The list is rendering the title one line above;
    // dropping it here was the whole defect.
    const session: SessionWithProvider = {
      id: row.sessionId,
      summary: row.sessionTitle,
      __provider: row.provider,
      __projectId: row.projectId ?? undefined,
    };
    if (project) {
      // Project first, then session — mirrors Sidebar.tsx's own conversation-result handler.
      onProjectSelect(project);
      onSessionSelect(session, project.projectId);
    } else {
      onSessionSelect(session, row.projectId ?? '');
    }
  }, [projects, onProjectSelect, onSessionSelect]);

  const handleRename = useCallback(async (sessionId: string, title: string) => {
    await onRenameSession(sessionId, title);
    patchLocal(sessionId, { sessionTitle: title });
  }, [onRenameSession, patchLocal]);

  // The row whose icon picker is open, null when none is. The picker seeds its grid from this
  // very object, and closing the dialog is one write of null — so the target and the open flag
  // are the same fact rather than two that can disagree.
  const [iconTarget, setIconTarget] = useState<RecentConversationListItem | null>(null);
  const handlePickIcon = useCallback(async (icon: string | null) => {
    const target = iconTarget;
    if (!target) return;
    // Closed first: the row below is this click's feedback, and it shows the choice at once.
    setIconTarget(null);
    patchLocal(target.sessionId, { icon });
    try {
      const response = await api.setSessionIcon(target.sessionId, icon);
      if (!response.ok) throw new Error(`setSessionIcon answered HTTP ${response.status}`);
    } catch (error) {
      // The server never took the icon, so the row goes back to the one the picker opened on.
      console.error('[SidebarSimpleList] Failed to set the chat icon:', error);
      patchLocal(target.sessionId, { icon: target.icon });
    }
  }, [iconTarget, patchLocal]);

  // The folder verbs and the three facts behind them: the folder just made, the chat whose picker
  // is open, and the folder whose delete waits on a yes.
  const {
    freshFolderId, onFreshShown, pickerChat, pickerFolderId, pendingDeleteFolder, createFolder,
    renameFolder, toggleFolder, requestDelete, openFolderPicker, closeFolderPicker, moveToFolder,
    move, confirmDelete: confirmFolderDelete, cancelDelete: cancelFolderDelete,
  } = useSimpleChatFolders({ items, reload, patchFolderLocal, moveLocal, t });

  // The carry, feeding the folder hook's own `move`: a drop and a "Move to folder…" are one write.
  const { dragging, dropTarget, dragProps } = useSimpleChatDrag({ items, onMove: move });
  // The tree's folders in drawn order: what the folder picker lists.
  const folders = items.flatMap((item) => (item.kind === 'folder' ? [item.folder] : []));

  // Drawn at the end of the list in the empty state and the listed one alike, and the one way a
  // folder is born: named for the button that made it until its header opens the name for typing.
  const newFolderButton = (
    <Button
      data-testid="simple-chat-new-folder"
      variant="ghost"
      size="sm"
      className="mt-1"
      onClick={() => void createFolder()}
    >
      {t('simpleList.newFolder')}
    </Button>
  );

  return (
    <div data-testid="simple-chat-list" className="flex flex-col gap-2 px-2 py-2">
      {hasError && items.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
          <Button variant="ghost" size="sm" className="mt-2 block" onClick={() => void reload()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        </div>
      ) : !isLoading && items.length === 0 ? (
        <div className="flex flex-col gap-1">
          <div data-testid="simple-chat-empty">
            <EmptyState title={t('simpleList.empty')} />
          </div>
          <SidebarNewChatButton project={effectiveProject} onNewSession={onNewSession} t={t} />
          {newFolderButton}
        </div>
      ) : (
        <div
          data-testid="simple-chat-list-rows"
          // No text selection while a row is carried; the titles stay selectable at rest.
          className={dragging !== null ? 'flex select-none flex-col gap-1' : 'flex flex-col gap-1'}
        >
          <SidebarSimpleListItems
            items={items}
            selectedSessionId={selectedSessionId}
            busySessionIds={busySessionIds}
            awaitingInputSessionIds={awaitingInputSessionIds}
            subagentRunningSessionIds={subagentRunningSessionIds}
            failedSessionId={failedSessionId}
            freshFolderId={freshFolderId}
            onFreshShown={onFreshShown}
            dragging={dragging}
            dropTarget={dropTarget}
            dragProps={dragProps}
            onSelectChat={handleRowSelect}
            onArchiveChat={(chat) => remove(chat, 'archive')}
            onDeleteChat={(chat) => remove(chat, 'delete')}
            onChooseIcon={(chat) => setIconTarget(chat)}
            onRenameChat={(sessionId, title) => void handleRename(sessionId, title)}
            // A list with no folder offers no way into one: the entry is drawn only once `folders`
            // holds one, and null is what tells every row so.
            onMoveToFolder={folders.length === 0 ? null : openFolderPicker}
            onToggleFolder={toggleFolder}
            onRenameFolder={renameFolder}
            onDeleteFolder={requestDelete}
            t={t}
          />
          <SidebarNewChatButton project={effectiveProject} onNewSession={onNewSession} t={t} />
          {newFolderButton}
          {hasMore && (
            <Button
              data-testid="simple-chat-load-more"
              variant="ghost"
              size="sm"
              className="mt-1"
              onClick={() => void loadMore()}
            >
              {t('simpleList.loadMore')}
            </Button>
          )}
        </div>
      )}

      <SidebarSimpleStopDialog
        open={pendingStop !== null}
        onConfirm={confirmStop}
        onCancel={cancelStop}
        t={t}
      />

      <SidebarSimpleDeleteDialog
        open={pendingDelete !== null}
        // Read at open time from the same busy model the hook acts on, so the sentence the
        // dialog shows and the path it takes on confirm can never disagree.
        isRunning={pendingDelete !== null && busySessionIds.has(pendingDelete.sessionId)}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        t={t}
      />

      <SidebarSimpleIconPicker
        open={iconTarget !== null}
        currentIcon={iconTarget?.icon ?? null}
        onPick={handlePickIcon}
        onCancel={() => setIconTarget(null)}
        t={t}
      />

      <SidebarSimpleFolderPicker
        open={pickerChat !== null}
        // The tree's folders in drawn order, and the folder the chat is in now — the row the
        // dialog presses and disables.
        folders={folders}
        currentFolderId={pickerFolderId}
        onPick={moveToFolder}
        onCancel={closeFolderPicker}
        t={t}
      />

      {/* The one delete that stops to ask: a folder that holds chats gives them back to the list,
          and the sentence below says so before the yes. */}
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
    </div>
  );
}
