import { useCallback, useEffect, useRef } from 'react';

import type { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import type { SimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import { getAllSessions } from '@/shared/sessionRecency';

type OpenProjectChatInput = Pick<
  ReturnType<typeof useProjectsState>,
  'projects' | 'selectedProject' | 'handleProjectSelect' | 'handleSessionSelect' | 'handleNewSession'
>;

/**
 * Used by ProjectsStateProvider to give the workspace one door into a project's conversation, for
 * the chat host's door, its floating header and the switcher's actions.
 *
 * The door keeps ONE identity for the provider's life: every input is read through a ref, written
 * in an effect (the `projectsRef` shape in ProjectsStateContext), so a session upsert that rebuilds
 * `projects`, or a selection that changes the handlers, never hands its readers a new function.
 */
export function useOpenProjectChat(input: OpenProjectChatInput) {
  const { projects, selectedProject, handleProjectSelect, handleSessionSelect, handleNewSession } = input;
  const { enabled: simpleListEnabled, setProjectId: saveSimpleListProject } = useSimpleChatListPreferences();

  // The newest of the inputs, read at call time: the five above and the simple list's two. Held in a
  // ref because the door must keep its identity while `projects` churns; written in an effect so the
  // ref only ever names a committed render.
  const inputRef = useRef<OpenProjectChatInput & Pick<SimpleChatListPreferences, 'enabled' | 'setProjectId'>>({
    ...input,
    enabled: simpleListEnabled,
    setProjectId: saveSimpleListProject,
  });
  useEffect(() => {
    inputRef.current = {
      projects,
      selectedProject,
      handleProjectSelect,
      handleSessionSelect,
      handleNewSession,
      enabled: simpleListEnabled,
      setProjectId: saveSimpleListProject,
    };
  }, [projects, selectedProject, handleProjectSelect, handleSessionSelect, handleNewSession, simpleListEnabled, saveSimpleListProject]);

  /**
   * Points the workspace at a project's conversation. `latest`: nothing when the workspace is already on that project, else its most recent session (`getAllSessions(project)[0]`, selected tagged with the project), else a new chat there. `new`: a new chat there. A null or unknown path means the selected project. Answers whether a project was found.
   *
   * "Found" is `projectPath` itself naming a known project: a path that fell back to the selected
   * project answers false, and so does a call with no selected project to fall back on (that one also
   * does nothing).
   */
  const openProjectChat = useCallback((projectPath: string | null, mode: 'latest' | 'new'): boolean => {
    const current = inputRef.current;
    const named = projectPath === null
      ? undefined
      : current.projects.find((candidate) => candidate.fullPath === projectPath);
    const project = named ?? current.selectedProject;
    if (!project) return false;

    // A new chat in `project`. With the simple list on, the project is saved as the list's project
    // first — the new-chat picker's own rule (ProviderSelectionEmptyState.handleProjectChange) —
    // because SidebarSimpleList re-selects the saved project whenever no chat is open, and would
    // otherwise move the workspace off `project` in the commit after this call answered true.
    const startNewChat = () => {
      if (current.enabled) current.setProjectId(project.projectId);
      current.handleNewSession(project);
    };

    if (mode === 'new') {
      startNewChat();
    } else if (project.projectId !== current.selectedProject?.projectId) {
      const newest = getAllSessions(project)[0];
      if (newest) {
        // The sidebar's own select path (SidebarSimpleList's row): the project first, then the
        // session tagged with it, so the session handler sees which project it belongs to.
        current.handleProjectSelect(project);
        current.handleSessionSelect({ ...newest, __projectId: project.projectId });
      } else {
        startNewChat();
      }
    }
    return named !== undefined;
  }, []);

  return openProjectChat;
}
