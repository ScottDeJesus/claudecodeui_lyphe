import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { Project } from '@/shared/types';

export type BoardProject = { name: string; path: string };

/**
 * Lists the projects the app already knows, for the board dialog's Repositories picker.
 *
 * It reads the app's own project list (`GET /api/projects`), the one the sidebar draws.
 *
 * ASKED ONLY WHILE `wanted` — the panel passes whether the dialog is open on a row that asks for repositories — so a board that never opens the dialog never reads the list, and each opening reads it fresh (a project added since is there).
 *
 * A PROJECT WHOSE FOLDER IS MISSING IS LEFT OUT, because the server refuses a path that is not a directory.
 *
 * A LIST THAT CANNOT BE READ IS AN EMPTY LIST, not an error on screen: the dialog still takes a typed path, which is the whole of what the list saves.
 */
export function useBoardProjects(wanted: boolean): BoardProject[] {
  const [projects, setProjects] = useState<BoardProject[]>([]);

  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;

    const readProjects = async (): Promise<void> => {
      try {
        const response = await api.projects.list();
        if (!response.ok) {
          console.warn('[useBoardProjects] the project list could not be read:', response.status);
          return;
        }
        const body: unknown = await response.json();
        if (!cancelled) setProjects(projectsOf(body));
      } catch (error) {
        console.warn('[useBoardProjects] the project list could not be read:', error);
      }
    };

    void readProjects();
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return projects;
}

/** Keeps the server's order, drops missing folders and repeated paths. */
function projectsOf(body: unknown): BoardProject[] {
  if (!Array.isArray(body)) return [];
  const rows: unknown[] = body;
  const seen = new Set<string>();
  const projects: BoardProject[] = [];
  for (const entry of rows) {
    if (!isProjectRow(entry)) continue;
    if (entry.isFolderMissing === true) continue;
    if (seen.has(entry.fullPath)) continue;
    seen.add(entry.fullPath);
    projects.push({ name: entry.displayName, path: entry.fullPath });
  }
  return projects;
}

function isProjectRow(
  entry: unknown,
): entry is Pick<Project, 'displayName' | 'fullPath' | 'isFolderMissing'> {
  if (typeof entry !== 'object' || entry === null) return false;
  return (
    'displayName' in entry &&
    typeof entry.displayName === 'string' &&
    'fullPath' in entry &&
    typeof entry.fullPath === 'string' &&
    entry.fullPath !== ''
  );
}
