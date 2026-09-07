import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { Router } from 'express';

import { chatRunRegistry } from '@/modules/websocket/index.js';
import { resolveSpawnedClaudeBinaryPath } from '@/shared/claude-cli-path.js';

import { createCliVersionRouter } from './cli-version.routes.js';
import { createCliVersionService } from './cli-version.service.js';

const execFileAsync = promisify(execFile);

/**
 * Builds the authenticated CLI-version router for the server entrypoint.
 *
 * The composition root is the only place that reads the environment, spawns
 * anything, or reaches into the run registry; the service takes all of it as
 * dependencies, which is what lets the failure path and the cache be proven
 * without a server and without a real CLI.
 *
 * The binary comes from `claude-cli-path.ts`, which is the module that answers
 * "which file does a run spawn" for the SDK as well — asked once, answered the
 * same way for both, so a version can never be reported about a binary nothing
 * runs.
 */
export function createCliVersionModule(): Router {
  const cliVersionService = createCliVersionService({
    resolveBinaryPath: () => resolveSpawnedClaudeBinaryPath(),
    execFile: (file, args, options) => execFileAsync(file, [...args], options),
    now: () => Date.now(),
    // The registry is the ONLY home of a run's version: it is read live here
    // and never copied anywhere that outlives the run.
    listRunningRuns: () => chatRunRegistry.listRunningRuns(),
  });

  return createCliVersionRouter(cliVersionService);
}
