import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  useAwaitingInputSessionIdSet,
  useBusySessionIdSet,
  useSubagentRunningSessionIdSet,
} from '@/shared/context/SessionProtectionContext';
import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import { getAllSessions } from '@/shared/sessionRecency';
import type {
  Project,
  ProjectSession,
  SessionPickerGroup,
  SessionPickerMarks,
  SessionPickerRow,
  SessionPickerStatus,
  SessionWithProvider,
} from '@/shared/types';
import { subscribeToUserPreferences } from '@/shared/userSettings';
import { useSimpleChatList } from '@/modules/sidebar/hooks/useSimpleChatList';
import { useProjectStarOverrides, withResolvedStarState } from '@/modules/sidebar/utils/projectStarOverrides';
import { groupsFromProjects, groupsFromSimpleList } from '@/modules/sidebar/utils/sessionPickerGroups';
import { sortProjects } from '@/modules/sidebar/utils/sidebarProjectFormatting';
import { readProjectSortOrder } from '@/modules/sidebar/utils/sidebarStoredPreferences';

// File-local: SidebarSessionPicker is this hook's one caller, and it hands over what the sidebar's
// own props already carry.
type SessionPickerInput = {
  projects: Project[];
  selectedSessionId: string | null;
  /** The sidebar's naming rule (`getSessionName`), bound to the caller's translator. */
  nameOf: (session: ProjectSession) => string;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
};

/**
 * Used by SidebarSessionPicker: the sidebar's facts, gathered for the compact picker — the list the
 * sidebar holds for this reader, the state it is in, and the pick that goes the way a sidebar row goes.
 *
 * THE LIST is whichever of the sidebar's two shapes the reader chose. With the simple chat list on,
 * it is the simple list's own feed (`useSimpleChatList`), rows in the order the server keeps for the
 * reader. Otherwise it is the project tree: each project in `sortProjects` order under the reader's
 * `projectSortOrder` (read, and followed as it changes, through the preference store the sidebar's
 * controller listens to), each with its loaded sessions newest first. The feed is only fetched and
 * subscribed to while its shape is the one on screen.
 *
 * TWO LIMITS, both because the sidebar's own state is private to the sidebar. The tree is ordered over the
 * workspace's `projects`, whose `isStarred` is that of the last full project refresh: a star toggled in the
 * sidebar reorders the sidebar at once (its resolved-star map lives inside `useSidebarController`) and this
 * list at the next refresh. The picker's feed is its own instance of `useSimpleChatList`, so a row the
 * sidebar archives or deletes (`removeLocal` on the sidebar's instance) leaves this list at its next
 * `session_upserted` reload, and the server broadcasts nothing for an archive or a delete.
 *
 * THE STATUS follows the sidebar's simple list: the first fetch in flight is 'loading' and a failed
 * one is 'error' only while there are no rows to show. A reload behind rows already drawn (every
 * `session_upserted` triggers one) leaves the list where it is, as the sidebar's does; blanking it for
 * a skeleton on each upsert would make the panel flicker while the reader reads it.
 *
 * THE PICK is the sidebar's path: the project first, then the session tagged with that project. The
 * simple list builds its session from its row, `summary` carried across, exactly as SidebarSimpleList's
 * `handleRowSelect` does (a session with an id and nothing else would title the workspace "New Session"
 * beside a list reading the real name). The project tree hands over the project's own loaded session,
 * as its rows do.
 */
export function useSessionPicker({
  projects,
  selectedSessionId,
  nameOf,
  onProjectSelect,
  onSessionSelect,
}: SessionPickerInput): {
  groups: SessionPickerGroup[];
  status: SessionPickerStatus;
  hasMore: boolean;
  loadMore: () => void;
  pick: (row: SessionPickerRow) => void;
} {
  const { enabled: simpleListEnabled } = useSimpleChatListPreferences();
  const list = useSimpleChatList(selectedSessionId, simpleListEnabled);
  // The reader's project order, followed live: the sidebar's controller keeps it in state and re-reads it on
  // every preference notification, and the picker must not order its projects by a value that went stale
  // while the chat floated. A store read (not state of its own), so it cannot drift from the preference.
  const sortOrder = useSyncExternalStore(subscribeToUserPreferences, readProjectSortOrder);

  const running = useBusySessionIdSet();
  const awaitingInput = useAwaitingInputSessionIdSet();
  const subagentRunning = useSubagentRunningSessionIdSet();
  const marks = useMemo<SessionPickerMarks>(
    () => ({ running, awaitingInput, subagentRunning }),
    [running, awaitingInput, subagentRunning],
  );

  // The stars the reader toggled that `projects[].isStarred` has not caught up with — the same map the
  // sidebar's own order reads, so a project starred there is first here too.
  const starOverrides = useProjectStarOverrides();

  // The tree's order is a sort of every project by its newest session, so it is kept until the projects,
  // their stars or the reader's order move — not redone for a mark changing.
  const sortedProjects = useMemo(
    () => (simpleListEnabled ? [] : sortProjects(withResolvedStarState(projects, starOverrides), sortOrder)),
    [simpleListEnabled, projects, starOverrides, sortOrder],
  );
  const groups = useMemo(
    () => (simpleListEnabled
      ? groupsFromSimpleList(list.rows, marks)
      : groupsFromProjects(sortedProjects, marks, nameOf)),
    [simpleListEnabled, list.rows, sortedProjects, marks, nameOf],
  );

  const hasRows = list.rows.length > 0;
  let status: SessionPickerStatus = 'ready';
  if (simpleListEnabled && !hasRows) {
    if (list.hasError) status = 'error';
    else if (list.isLoading) status = 'loading';
  }

  const { loadMore: loadMoreRows } = list;
  const loadMore = useCallback(() => {
    if (simpleListEnabled) void loadMoreRows();
  }, [simpleListEnabled, loadMoreRows]);

  const pick = useCallback((row: SessionPickerRow) => {
    const project = projects.find((candidate) => candidate.projectId === row.projectId);
    const fromRow: SessionWithProvider = {
      id: row.sessionId,
      summary: row.title,
      __provider: row.provider,
      __projectId: row.projectId ?? undefined,
    };
    const session = !simpleListEnabled && project
      ? getAllSessions(project).find((candidate) => candidate.id === row.sessionId) ?? fromRow
      : fromRow;

    if (project) {
      // Project first, then session — the order Sidebar.tsx's own handlers take.
      onProjectSelect(project);
      onSessionSelect({ ...session, __projectId: project.projectId });
    } else {
      onSessionSelect({ ...session, __projectId: row.projectId ?? '' });
    }
  }, [projects, simpleListEnabled, onProjectSelect, onSessionSelect]);

  return {
    groups,
    status,
    hasMore: simpleListEnabled && list.hasMore,
    loadMore,
    pick,
  };
}
