import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const EXPANDED_PROJECTS_STORAGE_KEY = 'cloudcli-expanded-projects';

/** Read browser-local project expansion, tolerating missing or invalid storage. */
function readExpandedProjects(): Set<string> | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY) ?? 'null');
    return Array.isArray(saved)
      ? new Set(saved.filter((id): id is string => typeof id === 'string'))
      : null;
  } catch {
    return null;
  }
}

/**
 * Used by useSidebarController to own which project groups are open in the Projects tab.
 *
 * With "Keep projects expanded" off, one group is open at a time (the controller's toggle
 * enforces that) and nothing is stored. With it on, groups open side by side and the set is
 * kept in this browser's localStorage, so a reload brings them back. The selected project's
 * group opens by itself whenever the selection moves to a new project.
 */
export function useExpandedProjects(
  selectedProjectId: string | undefined,
  keepProjectsExpanded: boolean,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  // Remember whether a saved set existed before the first persistence effect.
  const restoredExpandedProjects = useRef<Set<string> | null>(null);
  // Project expansion is browser-local; the opt-in preference follows the user.
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    restoredExpandedProjects.current = keepProjectsExpanded ? readExpandedProjects() : null;
    return restoredExpandedProjects.current ?? new Set();
  });
  // Detect preference hydration as well as a live toggle without overwriting saved groups.
  const previousKeepProjectsExpanded = useRef(keepProjectsExpanded);
  // Distinguish the initial restored selection from subsequent navigation.
  const selectionExpansion = useRef<{ seenSelection: boolean; projectId?: string }>({ seenSelection: false });

  useEffect(() => {
    const wasEnabled = previousKeepProjectsExpanded.current;
    previousKeepProjectsExpanded.current = keepProjectsExpanded;
    if (!keepProjectsExpanded) {
      if (wasEnabled && expandedProjects.size > 1) {
        const retainedId = selectedProjectId && expandedProjects.has(selectedProjectId)
          ? selectedProjectId
          : [...expandedProjects][0];
        setExpandedProjects(new Set([retainedId]));
      }
      return;
    }
    if (!wasEnabled) {
      const saved = readExpandedProjects();
      restoredExpandedProjects.current = saved;
      if (saved) {
        setExpandedProjects(saved);
        return;
      }
    }
    try {
      localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify([...expandedProjects]));
    } catch { /* Keep navigation working when browser storage is unavailable. */ }
  }, [expandedProjects, keepProjectsExpanded, selectedProjectId]);

  useEffect(() => {
    // Auto-expand only when the selected project identity changes.
    // Depending on the full `selectedProject` object (or `selectedSession`) causes
    // websocket-driven list refreshes to re-open projects users manually collapsed.
    if (selectionExpansion.current.projectId === selectedProjectId) return;
    const isInitialSelection = !selectionExpansion.current.seenSelection;
    selectionExpansion.current.projectId = selectedProjectId;
    if (!selectedProjectId) return;
    selectionExpansion.current.seenSelection = true;
    // A saved set is authoritative on reload, including an intentionally empty set.
    if (isInitialSelection && keepProjectsExpanded && restoredExpandedProjects.current !== null) return;

    setExpandedProjects((prev) => {
      if (prev.has(selectedProjectId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(selectedProjectId);
      return next;
    });
  }, [selectedProjectId, keepProjectsExpanded]);

  return [expandedProjects, setExpandedProjects];
}
