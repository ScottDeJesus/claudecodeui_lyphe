import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { Project, ProjectSession } from '@/shared/types';
import SidebarSessionPickerMenu from '@/modules/sidebar/SidebarSessionPickerMenu';
import { useSessionPicker } from '@/modules/sidebar/hooks/useSessionPicker';
import { getSessionName } from '@/modules/sidebar/utils/sidebarProjectFormatting';

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
 * The picker is drawn by SidebarSessionPickerMenu; this file is where the sidebar's facts reach it, and
 * `useSessionPicker` is what reads them.
 */
export function SidebarSessionPicker(props: SidebarSessionPickerProps) {
  const { t } = useTranslation('sidebar');
  const { selectedProject, selectedSession } = props;

  // The sidebar's naming rule for a session: its summary, else its name, else "New Session".
  const nameOf = useCallback((session: ProjectSession) => getSessionName(session, t), [t]);

  // The list, in the reader's order, in one of the sidebar's two shapes. Each session wears the marks the
  // sidebar's rows read: the simple list's `groupsFromSimpleList(list.rows, marks)` and the tree's
  // `groupsFromProjects(sortProjects(projects, order), marks, nameOf)` take the same three session-id sets.
  const { groups: rows, status, hasMore, loadMore, pick } = useSessionPicker({
    projects: props.projects,
    selectedSessionId: selectedSession?.id ?? null,
    nameOf,
    onProjectSelect: props.onProjectSelect,
    onSessionSelect: props.onSessionSelect,
  });

  return (
    <SidebarSessionPickerMenu
      name={selectedSession ? nameOf(selectedSession) : t('projects.newSession')}
      projectName={selectedProject ? selectedProject.displayName || selectedProject.projectId : null}
      groups={rows}
      status={status}
      currentSessionId={selectedSession?.id ?? null}
      hasMore={hasMore}
      onPick={pick}
      onNewChat={props.onNewChat}
      onLoadMore={loadMore}
    />
  );
}
