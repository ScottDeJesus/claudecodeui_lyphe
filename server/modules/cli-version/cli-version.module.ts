import type { Router } from 'express';

import { chatRunRegistry } from '@/modules/websocket/index.js';

import { createCliVersionRouter } from './cli-version.routes.js';
import { createCliVersionService, readInstalledCliVersion } from './cli-version.service.js';

/**
 * Builds the authenticated CLI-version router for the server entrypoint.
 *
 * Two dependencies, and both are joins this file is the place for: the run registry, which is
 * the only home of a live run's version, and the server's ONE cached reading of the installed
 * binary — the same instance the chat runtime asks at send time, so the version this route
 * reports and the version that decides whether a process is replaced are never two answers.
 *
 * The binary itself is resolved by that reading, through `claude-cli-path.ts` — the module that
 * answers "which file does a run spawn" for the SDK too, asked once and answered the same way for
 * both, so a version can never be reported about a binary nothing runs.
 */
export function createCliVersionModule(): Router {
  const cliVersionService = createCliVersionService({
    readInstalled: readInstalledCliVersion,
    // The registry is the ONLY home of a run's version: it is read live here
    // and never copied anywhere that outlives the run.
    listRunningRuns: () => chatRunRegistry.listRunningRuns(),
  });

  return createCliVersionRouter(cliVersionService);
}
