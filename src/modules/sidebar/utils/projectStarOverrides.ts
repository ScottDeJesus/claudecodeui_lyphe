import { useSyncExternalStore } from 'react';

import type { Project } from '@/shared/types';

// The stars the reader toggled, kept until `projects[].isStarred` catches up. That field is refreshed only
// by a full project refresh (the server's `toggle-star` answers the caller and broadcasts nothing), so a
// star the sidebar has already resolved is in this map and in no `projects` entry. It is a store, not the
// sidebar controller's state, because the compact session picker orders projects by the same star and is
// mounted where the controller's state is not: one map, read by both, so their orders cannot disagree.
let overrides: ReadonlyMap<string, boolean> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readOverrides(): ReadonlyMap<string, boolean> {
  return overrides;
}

/** Used by useSidebarController: records the star the reader just set (or the server just answered) for a project. */
export function setProjectStarOverride(projectId: string, starred: boolean): void {
  const next = new Map(overrides);
  next.set(projectId, starred);
  overrides = next;
  listeners.forEach((listener) => listener());
}

/** Used by useSidebarController: drops each override `projects` has caught up with, and those of projects that are gone. */
export function reconcileProjectStarOverrides(projects: Project[]): void {
  if (overrides.size === 0) {
    return;
  }

  const next = new Map(overrides);
  for (const [projectId, overrideValue] of overrides) {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    if (!project || Boolean(project.isStarred) === overrideValue) {
      next.delete(projectId);
    }
  }

  if (next.size !== overrides.size) {
    overrides = next;
    listeners.forEach((listener) => listener());
  }
}

/** Used by useSidebarController and useSessionPicker: the reader's star toggles, re-read whenever one changes. */
export function useProjectStarOverrides(): ReadonlyMap<string, boolean> {
  return useSyncExternalStore(subscribe, readOverrides);
}

/** Used by useSidebarController and useSessionPicker: `projects` with each toggled star applied, the same array when none differs. */
export function withResolvedStarState(
  projects: Project[],
  starOverrides: ReadonlyMap<string, boolean>,
): Project[] {
  if (starOverrides.size === 0) {
    return projects;
  }

  return projects.map((project) => {
    const starOverride = starOverrides.get(project.projectId);
    if (starOverride === undefined || Boolean(project.isStarred) === starOverride) {
      return project;
    }

    return { ...project, isStarred: starOverride };
  });
}
