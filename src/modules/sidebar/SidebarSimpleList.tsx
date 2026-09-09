import { useCallback, useEffect, useMemo } from 'react';
import type { TFunction } from 'i18next';

import { Button, EmptyState, Select } from '@/shared/ui';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import type { Project, ProjectSession, RecentConversationListItem, SessionWithProvider } from '@/shared/types';
import { useCompactSidebar } from '@/modules/sidebar/hooks/useCompactSidebar';
import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { useSimpleChatRemove } from '@/modules/sidebar/hooks/useSimpleChatRemove';
import SidebarSimpleListRow from '@/modules/sidebar/SidebarSimpleListRow';
import SidebarSimpleStopDialog from '@/modules/sidebar/SidebarSimpleStopDialog';

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
 * list" preference is on: one project picker, a New chat button, and a flat, server-tagged feed
 * of chats started from this view. Composes `useSimpleChatList` (the feed) and
 * `useSimpleChatRemove` (idle-archive / stop-then-archive) so this file stays presentational.
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
  const { projectId: preferredProjectId, setProjectId } = useSimpleChatListPreferences();
  const busySessionIds = useBusySessionIdSet();
  // Gate 9's 44px floor is compact-only: desktop keeps the New chat button's stock h-9.
  const isCompact = useCompactSidebar();

  const { rows, hasMore, isLoading, hasError, reload, loadMore, renameLocal, removeLocal } =
    useSimpleChatList(selectedSession?.id ?? null);

  const handleArchived = useCallback((sessionId: string) => {
    removeLocal(sessionId);
    onSessionRemoved(sessionId);
  }, [removeLocal, onSessionRemoved]);

  const { pendingStop, failedSessionId, remove, confirmStop, cancelStop } =
    useSimpleChatRemove({ onArchived: handleArchived });

  // The dropdown's options, sorted by the label a person reads — same order the row's own
  // project label uses.
  const projectOptions = useMemo(
    () => [...projects]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((project) => ({ value: project.projectId, label: project.displayName })),
    [projects],
  );

  const effectiveProject = projects.find((project) => project.projectId === preferredProjectId) ?? projects[0] ?? null;

  // Deliberately the ids, not the objects: a new selectedSession/selectedProject/effectiveProject
  // reference with the SAME id must not re-arm the effect below, or a parent re-render (not a
  // real transition) would fire onProjectSelect again.
  const effectiveProjectId = effectiveProject?.projectId ?? null;
  const selectedSessionId = selectedSession?.id ?? null;
  const selectedProjectId = selectedProject?.projectId ?? null;

  // Keeps Files/Git/Shell pointed at the dropdown's project whenever no chat is open. Fires at
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

  const handleNewChat = useCallback(() => {
    if (effectiveProject) onNewSession(effectiveProject);
  }, [effectiveProject, onNewSession]);

  const handleRename = useCallback(async (sessionId: string, title: string) => {
    await onRenameSession(sessionId, title);
    renameLocal(sessionId, title);
  }, [onRenameSession, renameLocal]);

  return (
    <div data-testid="simple-chat-list" className="flex flex-col gap-2 px-2 py-2">
      <div className="flex items-center gap-2">
        <div data-testid="simple-chat-project" className="min-w-0 flex-1">
          <Select
            ariaLabel={t('simpleList.project')}
            options={projectOptions}
            value={effectiveProject?.projectId ?? ''}
            onChange={setProjectId}
            placeholder={t('simpleList.project')}
            size="sm"
          />
        </div>
        <Button
          data-testid="simple-chat-new"
          size="sm"
          className={isCompact ? 'min-h-11' : undefined}
          onClick={handleNewChat}
          disabled={!effectiveProject}
        >
          {t('simpleList.newChat')}
        </Button>
      </div>

      {hasError && rows.length === 0 ? (
        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
          {t('recent.loadFailed', 'Could not load recent conversations')}
          <Button variant="ghost" size="sm" className="mt-2 block" onClick={() => void reload()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        </div>
      ) : !isLoading && rows.length === 0 ? (
        <div data-testid="simple-chat-empty">
          <EmptyState title={t('simpleList.empty')} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row) => (
            <SidebarSimpleListRow
              key={row.sessionId}
              row={row}
              isSelected={selectedSession?.id === row.sessionId}
              isRunning={busySessionIds.has(row.sessionId)}
              isRemoveFailed={failedSessionId === row.sessionId}
              onSelect={() => handleRowSelect(row)}
              onRemove={() => remove(row)}
              onRename={(title) => void handleRename(row.sessionId, title)}
              t={t}
            />
          ))}
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
    </div>
  );
}
