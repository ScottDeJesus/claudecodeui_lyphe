import { useTranslation } from 'react-i18next';

import type { Project, ProjectSession, SessionPickerStatus } from '@/shared/types';
import SidebarSessionPickerMenu from '@/modules/sidebar/SidebarSessionPickerMenu';
import { EMPTY_PICKER_MARKS, groupsFromProjects } from '@/modules/sidebar/utils/sessionPickerGroups';

// File-local: the five members are the ones `SidebarProps` (Sidebar.tsx) declares under these names,
// and `onNewChat` is the one thing the sidebar does not have — starting a conversation there is
// `onNewSession(project)`, and the floating chat's header starts one where the application in front
// points.
type SidebarSessionPickerProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewChat: () => void;
};

/**
 * Used by project-workspace's FloatingChatHeader: the sidebar's own list of conversations as a compact
 * picker, so a floating chat's header switches conversations the way the sidebar does.
 *
 * The trigger names the open conversation and its project. The panel opens with New chat, then the
 * list the sidebar holds for this reader: the simple list's rows in the reader's own order when that
 * preference is on, else each project in the reader's project order with its loaded conversations
 * newest first. The open conversation is marked. Rename, delete, star and reorder stay in the sidebar.
 * A pick goes the way the sidebar's row takes: the project first, then the session tagged with it.
 *
 * SCAFFOLD. It is composed and it renders from its props, and it reads nothing else: each FILL marker
 * below is a data read or a handler, and the composition around the markers is settled. The picker
 * is drawn by SidebarSessionPickerMenu; this file is where the sidebar's facts reach it.
 */
export function SidebarSessionPicker(props: SidebarSessionPickerProps) {
  const { t } = useTranslation('sidebar');
  const { selectedProject, selectedSession } = props;

  // The sidebar's naming rule for a session: its summary, else its name, else "New Session".
  const nameOf = (session: ProjectSession) => session.summary || session.name || t('projects.newSession'); // FILL: name — getSessionName

  // The list, in the reader's order, in one of the sidebar's two shapes. Each session wears the marks the
  // sidebar's rows read: the simple list's `groupsFromSimpleList(list.rows, marks)` and the tree's
  // `groupsFromProjects(sortProjects(projects, order), marks, nameOf)` take the same three session-id sets.
  const rows = groupsFromProjects(props.projects, EMPTY_PICKER_MARKS, nameOf); // FILL: rows — useSimpleChatList when useSimpleChatListPreferences().enabled, else sortProjects(projects, order) with getAllSessions (useSimpleChatList takes no enabled flag and fetches and subscribes on mount, so a bare call pays one page and one websocket subscription in tree mode too: give the hook an `enabled` argument, or read it where the preference is on); marks from useBusySessionIdSet, useAwaitingInputSessionIdSet, useSubagentRunningSessionIdSet
  const status: SessionPickerStatus = 'ready'; // FILL: status — the simple list's isLoading ('loading') and hasError ('error'); the project tree is always 'ready'
  const hasMore = false; // FILL: has-more — the simple list's hasMore; the tree is listed whole, so false there

  return (
    <SidebarSessionPickerMenu
      name={selectedSession ? nameOf(selectedSession) : t('projects.newSession')}
      projectName={selectedProject ? selectedProject.displayName || selectedProject.projectId : null}
      groups={rows}
      status={status}
      currentSessionId={selectedSession?.id ?? null}
      hasMore={hasMore}
      // FILL: pick — onProjectSelect(project) then onSessionSelect(session tagged with the project)
      onPick={() => undefined}
      // FILL: new-chat — onNewChat()
      onNewChat={() => undefined}
      // FILL: load-more — the simple list's loadMore()
      onLoadMore={() => undefined}
    />
  );
}
