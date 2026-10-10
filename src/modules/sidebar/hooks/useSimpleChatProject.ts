import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import type { Project } from '@/shared/types';

/**
 * The project a new simple-list chat starts in: the saved choice, else the first project, else
 * none. A project whose folder is gone (`isFolderMissing`) is not a choice, saved or first: a chat
 * cannot start there, so the saved one falls back as if it were not in the list. Read by
 * `SidebarSimpleList`, which keeps Files, Git and Shell pointed at it while no chat
 * is open and hands it to its New chat row. The choice itself is made in the new-chat screen's
 * project picker and in Settings.
 */
export function useSimpleChatProject(projects: Project[]): Project | null {
  const { projectId } = useSimpleChatListPreferences();
  const startable = projects.filter((project) => !project.isFolderMissing);
  return startable.find((project) => project.projectId === projectId) ?? startable[0] ?? null;
}
