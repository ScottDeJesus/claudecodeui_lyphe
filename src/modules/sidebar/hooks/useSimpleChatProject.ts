import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import type { Project } from '@/shared/types';

/**
 * The project a new simple-list chat starts in: the saved choice, else the first project, else
 * none. Read by `SidebarSimpleList`, which keeps Files, Git and Shell pointed at it while no chat
 * is open and hands it to its New chat row. The choice itself is made in the new-chat screen's
 * project picker and in Settings.
 */
export function useSimpleChatProject(projects: Project[]): Project | null {
  const { projectId } = useSimpleChatListPreferences();
  return projects.find((project) => project.projectId === projectId) ?? projects[0] ?? null;
}
