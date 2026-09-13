import { useSyncExternalStore } from 'react';

/** Where the git tab remembers the repository it last showed, so a reload lands on the same one. */
const SELECTED_REPO_STORAGE_KEY = 'gitTab.selectedRepoPath';

const readStoredRepoPath = (): string | null => {
  try {
    return localStorage.getItem(SELECTED_REPO_STORAGE_KEY);
  } catch {
    return null;
  }
};

// The selected repository, by path, at MODULE scope rather than in the tab's state: the workspace
// unmounts the git tab whenever another tab is showing, and the command palette selects a
// repository before it brings the tab forward — so the choice has to outlive the component.
let selectedRepoPath: string | null = readStoredRepoPath();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSelectedRepoPath = () => selectedRepoPath;

/**
 * Selects the repository the git tab shows, and remembers it across reloads.
 *
 * Exported through the git-panel barrel for the project-workspace module's command palette, whose
 * commit and branch rows bring the git tab forward on the selected project's repository; used
 * inside this module by the tab's own repository strip.
 */
export function selectGitRepository(repoPath: string): void {
  selectedRepoPath = repoPath;
  try {
    localStorage.setItem(SELECTED_REPO_STORAGE_KEY, repoPath);
  } catch {
    // localStorage unavailable: the choice holds until the page reloads.
  }
  for (const listener of listeners) listener();
}

/**
 * The repository path the git tab shows, or null before one was ever selected. Read by
 * GitRepositoriesPanel; it is never the workspace's selected project, which is the point.
 */
export function useSelectedGitRepository(): string | null {
  return useSyncExternalStore(subscribe, getSelectedRepoPath);
}
