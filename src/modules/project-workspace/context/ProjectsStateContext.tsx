import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import { GIT_REPO_PATHS } from '@/shared/constants';
import type { GitRepository, IsSessionProcessing, ProjectChoice, ServerEvent } from '@/shared/types';

type ProjectsState = ReturnType<typeof useProjectsState>;

type ProjectSidebarState = Pick<
  ProjectsState,
  'sidebarOpen' | 'setSidebarOpen' | 'sidebarSharedProps' | 'activeTab' | 'setActiveTab'
>;

type ProjectMainState = Pick<
  ProjectsState,
  | 'selectedProject'
  | 'selectedSession'
  | 'activeTab'
  | 'setActiveTab'
  | 'setSidebarOpen'
  | 'isLoadingProjects'
  | 'openSettings'
  | 'externalMessageUpdate'
  | 'newSessionTrigger'
  | 'registerOptimisticSession'
  | 'handleProjectSelect'
  | 'refreshProjectsSilently'
> & {
  /** The git tab's repositories in strip order, memoised on the fields the tab reads. */
  gitRepositories: GitRepository[];
  /** Every project a new chat can start in, by name, memoised on those two fields. */
  projectChoices: ProjectChoice[];
  /** Points the workspace at a project by id; an id no longer in the list does nothing. */
  selectProjectById: (projectId: string) => void;
};

type ProjectCommandState = Pick<
  ProjectsState,
  'selectedProject' | 'handleNewSession' | 'openSettings' | 'activeTab' | 'setActiveTab'
>;

type ProjectEffectsState = Pick<
  ProjectsState,
  'openSettings' | 'refreshProjectsSilently' | 'setActiveTab' | 'setSidebarOpen'
>;

type ProjectActiveSessionState = {
  activeSessionId: string | null;
};

type ProjectsStateProviderProps = {
  children: ReactNode;
  sessionId?: string;
  navigate: NavigateFunction;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  isMobile: boolean;
  isSessionProcessing: IsSessionProcessing;
};

const ProjectSidebarContext = createContext<ProjectSidebarState | null>(null);
const ProjectMainContext = createContext<ProjectMainState | null>(null);
const ProjectCommandContext = createContext<ProjectCommandState | null>(null);
const ProjectEffectsContext = createContext<ProjectEffectsState | null>(null);
const ProjectActiveSessionContext = createContext<ProjectActiveSessionState | null>(null);

/** Rendered by ProjectWorkspaceRoute to own the workspace's project and session state and expose it through this module's context hooks. */
export function ProjectsStateProvider({
  children,
  sessionId,
  navigate,
  subscribe,
  isMobile,
  isSessionProcessing,
}: ProjectsStateProviderProps) {
  const state = useProjectsState({
    sessionId,
    navigate,
    subscribe,
    isMobile,
    isSessionProcessing,
  });

  const sidebarState = useMemo<ProjectSidebarState>(
    () => ({
      sidebarOpen: state.sidebarOpen,
      setSidebarOpen: state.setSidebarOpen,
      sidebarSharedProps: state.sidebarSharedProps,
      // The workspace tab strip renders in the sidebar now, so the sidebar needs the same tab
      // state the main region switches its panes on — the one `useProjectsState` already owns.
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
    }),
    [
      state.activeTab,
      state.setActiveTab,
      state.sidebarOpen,
      state.setSidebarOpen,
      state.sidebarSharedProps,
    ],
  );

  // The git tab's repositories, matched by path and narrowed to the three fields the tab reads.
  // `state.projects` is rebuilt on every background session upsert, and handing it to the main tree
  // would wake it on each one — the very thing the `session_upserted` handler in useProjectsState
  // is written to avoid. So the list is keyed on a string of just those fields, and its identity
  // moves only when one of them does.
  const gitRepositoriesKey = JSON.stringify(
    GIT_REPO_PATHS.flatMap((repoPath) => {
      const project = state.projects.find((candidate) => candidate.fullPath === repoPath);
      return project ? [[project.projectId, project.fullPath, project.displayName]] : [];
    }),
  );
  const gitRepositories = useMemo<GitRepository[]>(
    () => (JSON.parse(gitRepositoriesKey) as [string, string, string][])
      .map(([projectId, fullPath, displayName]) => ({ projectId, fullPath, displayName })),
    [gitRepositoriesKey],
  );

  // The same discipline for the new-chat project picker: a list keyed on the id and name alone,
  // so a session upsert that rebuilds `state.projects` does not wake the chat pane.
  const projectChoicesKey = JSON.stringify(
    [...state.projects]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((project) => [project.projectId, project.displayName]),
  );
  const projectChoices = useMemo<ProjectChoice[]>(
    () => (JSON.parse(projectChoicesKey) as [string, string][])
      .map(([projectId, displayName]) => ({ projectId, displayName })),
    [projectChoicesKey],
  );
  // The full project is looked up at pick time, from the newest list, through a ref, so the
  // callback keeps one identity while the list churns.
  const projectsRef = useRef(state.projects);
  useEffect(() => {
    projectsRef.current = state.projects;
  }, [state.projects]);
  const { handleProjectSelect } = state;
  const selectedProjectIdRef = useRef(state.selectedProject?.projectId ?? null);
  useEffect(() => {
    selectedProjectIdRef.current = state.selectedProject?.projectId ?? null;
  }, [state.selectedProject?.projectId]);
  // Re-picking the current project does nothing, and a pick made on the new-chat screen (already
  // at `/`) replaces the history entry instead of pushing one, so Back still leaves the screen.
  const selectProjectById = useCallback((projectId: string) => {
    if (projectId === selectedProjectIdRef.current) return;
    const project = projectsRef.current.find((candidate) => candidate.projectId === projectId);
    if (project) handleProjectSelect(project, { replaceHistory: true });
  }, [handleProjectSelect]);

  const mainState = useMemo<ProjectMainState>(
    () => ({
      gitRepositories,
      projectChoices,
      selectProjectById,
      selectedProject: state.selectedProject,
      selectedSession: state.selectedSession,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
      isLoadingProjects: state.isLoadingProjects,
      openSettings: state.openSettings,
      externalMessageUpdate: state.externalMessageUpdate,
      newSessionTrigger: state.newSessionTrigger,
      registerOptimisticSession: state.registerOptimisticSession,
      handleProjectSelect: state.handleProjectSelect,
      refreshProjectsSilently: state.refreshProjectsSilently,
    }),
    [
      state.activeTab,
      state.externalMessageUpdate,
      state.handleProjectSelect,
      state.isLoadingProjects,
      state.newSessionTrigger,
      gitRepositories,
      projectChoices,
      selectProjectById,
      state.openSettings,
      state.refreshProjectsSilently,
      state.registerOptimisticSession,
      state.selectedProject,
      state.selectedSession,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const commandState = useMemo<ProjectCommandState>(
    () => ({
      selectedProject: state.selectedProject,
      handleNewSession: state.handleNewSession,
      openSettings: state.openSettings,
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
    }),
    [state.activeTab, state.handleNewSession, state.openSettings, state.selectedProject, state.setActiveTab],
  );

  const effectsState = useMemo<ProjectEffectsState>(
    () => ({
      openSettings: state.openSettings,
      refreshProjectsSilently: state.refreshProjectsSilently,
      setActiveTab: state.setActiveTab,
      setSidebarOpen: state.setSidebarOpen,
    }),
    [
      state.openSettings,
      state.refreshProjectsSilently,
      state.setActiveTab,
      state.setSidebarOpen,
    ],
  );

  const activeSessionState = useMemo<ProjectActiveSessionState>(
    () => ({ activeSessionId: state.selectedSession?.id ?? sessionId ?? null }),
    [sessionId, state.selectedSession?.id],
  );

  return (
    <ProjectEffectsContext.Provider value={effectsState}>
      <ProjectCommandContext.Provider value={commandState}>
        <ProjectMainContext.Provider value={mainState}>
          <ProjectSidebarContext.Provider value={sidebarState}>
            <ProjectActiveSessionContext.Provider value={activeSessionState}>
              {children}
            </ProjectActiveSessionContext.Provider>
          </ProjectSidebarContext.Provider>
        </ProjectMainContext.Provider>
      </ProjectCommandContext.Provider>
    </ProjectEffectsContext.Provider>
  );
}

function useRequiredProjectContext<T>(value: T | null, hookName: string): T {
  if (!value) {
    throw new Error(`${hookName} must be used within ProjectsStateProvider`);
  }
  return value;
}

export function useProjectSidebarState(): ProjectSidebarState {
  return useRequiredProjectContext(useContext(ProjectSidebarContext), 'useProjectSidebarState');
}

export function useProjectMainState(): ProjectMainState {
  return useRequiredProjectContext(useContext(ProjectMainContext), 'useProjectMainState');
}

export function useProjectCommandState(): ProjectCommandState {
  return useRequiredProjectContext(useContext(ProjectCommandContext), 'useProjectCommandState');
}

export function useProjectEffectsState(): ProjectEffectsState {
  return useRequiredProjectContext(useContext(ProjectEffectsContext), 'useProjectEffectsState');
}

export function useProjectActiveSessionState(): ProjectActiveSessionState {
  return useRequiredProjectContext(
    useContext(ProjectActiveSessionContext),
    'useProjectActiveSessionState',
  );
}
