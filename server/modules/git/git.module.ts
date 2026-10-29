import * as fs from 'node:fs/promises';

import { projectsDb } from '@/modules/database/index.js';

import { createGitRouter } from './git.routes.js';

type GitExternalDependencies = Pick<
  Parameters<typeof createGitRouter>[0],
  'queryClaude' | 'queryCursor'
>;

/** Assembles the Git router with runners from the centralized provider runtime service. */
export function createGitModule(externalDependencies: GitExternalDependencies) {
  return createGitRouter({
    fileSystem: fs,
    resolveProjectPathById: (projectId) => projectsDb.getProjectPathById(projectId),
    ...externalDependencies,
  });
}
