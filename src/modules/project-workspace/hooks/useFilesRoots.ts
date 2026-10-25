import { useMemo } from 'react';

import { useFilesPins } from '@/modules/file-manager';
import type { FilesRoot, GitRepository, Project } from '@/shared/types';

/**
 * The Files view's strip of roots: the git repositories first (`pinned` false), then each folder the
 * operator pinned, in pin order (`pinned` true). Every file route takes a registered project's id, so
 * a pin becomes a root only when it matches a registered project's `fullPath` exactly, and a project
 * that is already a root — a repository that was also pinned — is not listed twice.
 *
 * Called by ProjectsStateContext. Memoised on a key string of exactly the fields a root carries, as
 * `gitRepositories` is: `projects` is rebuilt on every background session upsert, and a list handed on
 * by identity would wake the whole main tree on each one.
 */
export function useFilesRoots(projects: Project[], gitRepositories: GitRepository[]): FilesRoot[] {
  const pins = useFilesPins();

  const seen = new Set(gitRepositories.map((repository) => repository.projectId));
  const pinnedRows = pins.flatMap((pinPath) => {
    const project = projects.find((candidate) => candidate.fullPath === pinPath);
    if (!project || seen.has(project.projectId)) return [];
    seen.add(project.projectId);
    return [[project.projectId, project.fullPath, project.displayName, true]];
  });
  const rootsKey = JSON.stringify([
    ...gitRepositories.map((repository) => [repository.projectId, repository.fullPath, repository.displayName, false]),
    ...pinnedRows,
  ]);

  return useMemo<FilesRoot[]>(
    () => (JSON.parse(rootsKey) as [string, string, string, boolean][])
      .map(([projectId, fullPath, displayName, pinned]) => ({ projectId, fullPath, displayName, pinned })),
    [rootsKey],
  );
}
