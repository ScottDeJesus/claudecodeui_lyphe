import { useCallback, useState } from 'react';

const FILE_TREE_SHOW_IGNORED_STORAGE_KEY = 'file-tree-show-ignored';

type UseFileTreeShowIgnoredResult = {
  showIgnored: boolean;
  toggleShowIgnored: () => void;
};

function readStoredShowIgnored(): boolean {
  try {
    return localStorage.getItem(FILE_TREE_SHOW_IGNORED_STORAGE_KEY) === 'true';
  } catch {
    // Keep the default when storage is unavailable.
  }
  return false;
}

/**
 * Whether the tree shows the files the project's `.gitignore` ignores — a `.env`, a `dist/`, a
 * `state/` folder. Off by default: the server walks the tree through `.gitignore` and those never
 * arrive (`api.getFiles`, `respectGitignore`). On, the tree asks for everything, and only the
 * server's hard exclusions (`node_modules`, `.git`, build output) still hide. Persisted beside the
 * view mode so the choice outlives a reload; the header's filter button flips it.
 */
export function useFileTreeShowIgnored(): UseFileTreeShowIgnoredResult {
  // Read once during initialization, as the view mode is, so the first paint already has it.
  const [showIgnored, setShowIgnored] = useState<boolean>(readStoredShowIgnored);

  const toggleShowIgnored = useCallback(() => {
    const next = !showIgnored;
    setShowIgnored(next);

    try {
      localStorage.setItem(FILE_TREE_SHOW_IGNORED_STORAGE_KEY, String(next));
    } catch {
      // Keep runtime state even when persistence fails.
    }
  }, [showIgnored]);

  return {
    showIgnored,
    toggleShowIgnored,
  };
}
