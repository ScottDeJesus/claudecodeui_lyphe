import { useSyncExternalStore } from 'react';

/** Where the Files view remembers the root it last showed, so a reload lands on the same one. */
const SELECTED_ROOT_STORAGE_KEY = 'filesTab.selectedRootPath';

const readStoredRootPath = (): string | null => {
  try {
    return localStorage.getItem(SELECTED_ROOT_STORAGE_KEY);
  } catch {
    return null;
  }
};

// The selected root, by absolute path, at MODULE scope rather than in the view's state: the workspace
// unmounts the Files view whenever another view is showing, and an open request selects its root
// before the view's file manager mounts — so the choice has to outlive the component. Per device,
// as the git tab's repository is: another device's pick is not this one's.
let selectedRootPath: string | null = readStoredRootPath();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSelectedRootPath = () => selectedRootPath;

/**
 * Selects the root the Files view shows, and remembers it across reloads.
 *
 * Used inside this module by the view's strip, by an open request moving the view to the root that
 * holds its file, and by the pin flow selecting the folder it just added.
 */
export function selectFilesRoot(rootPath: string): void {
  selectedRootPath = rootPath;
  try {
    localStorage.setItem(SELECTED_ROOT_STORAGE_KEY, rootPath);
  } catch {
    // localStorage unavailable: the choice holds until the page reloads.
  }
  for (const listener of listeners) listener();
}

/**
 * The root path the Files view last showed, or null before one was ever selected. Read by
 * FilesView, which falls back to its first root when the path is no longer on the strip; it is
 * never the workspace's selected project, which is the point.
 */
export function useSelectedFilesRoot(): string | null {
  return useSyncExternalStore(subscribe, getSelectedRootPath);
}
