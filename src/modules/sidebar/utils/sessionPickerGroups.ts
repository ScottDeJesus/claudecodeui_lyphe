import { getAllSessions } from '@/shared/sessionRecency';
import type {
  Project,
  RecentConversationListItem,
  SessionPickerGroup,
  SessionPickerMarks,
  SessionWithProvider,
} from '@/shared/types';

/**
 * Used by useSessionPicker in the project tree's shape: one block per project, in the order the
 * caller hands them (the reader's `projectSortOrder` is applied by the caller, through `sortProjects`),
 * each with the project's loaded sessions newest first. `getAllSessions` is the tree's own reader, so
 * this list and the sidebar's tree cannot disagree about which session is newest. A project with no
 * loaded sessions stays as a block with no rows: the picker says "no conversations yet" under it.
 * `nameOf` is the sidebar's naming rule for a session, handed in so this file holds no copy of it.
 */
export function groupsFromProjects(
  projects: Project[],
  marks: SessionPickerMarks,
  nameOf: (session: SessionWithProvider) => string,
): SessionPickerGroup[] {
  return projects.map((project) => ({
    key: project.projectId,
    heading: project.displayName || project.projectId,
    rows: getAllSessions(project).map((session) => ({
      sessionId: session.id,
      title: nameOf(session),
      provider: session.__provider,
      projectId: project.projectId,
      projectName: null,
      icon: null,
      isRunning: marks.running.has(session.id),
      isAwaitingInput: marks.awaitingInput.has(session.id),
      isSubagentRunning: marks.subagentRunning.has(session.id),
      unread: false,
    })),
  }));
}

/**
 * Used by useSessionPicker for the simple list's shape (`useSimpleChatList` is the feed that hands it the
 * rows): ONE block with no heading, the rows in the order the feed gave them (the reader's
 * own order, which the server keeps). Each row names its own project, because nothing above it does.
 */
export function groupsFromSimpleList(
  rows: RecentConversationListItem[],
  marks: SessionPickerMarks,
): SessionPickerGroup[] {
  return [{
    key: 'simple-list',
    heading: null,
    rows: rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.sessionTitle,
      provider: row.provider,
      projectId: row.projectId,
      projectName: row.projectDisplayName,
      icon: row.icon,
      isRunning: marks.running.has(row.sessionId),
      isAwaitingInput: marks.awaitingInput.has(row.sessionId),
      isSubagentRunning: marks.subagentRunning.has(row.sessionId),
      unread: row.unread,
    })),
  }];
}
