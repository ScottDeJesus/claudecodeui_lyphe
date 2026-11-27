import type { Router } from 'express';

import { broadcastToAll, chatRunRegistry } from '@/modules/websocket/index.js';
import { resolveSpawnedClaudeBinaryPath } from '@/shared/claude-cli-path.js';
import { createPacedHint } from '@/shared/index.js';

import { createCliVersionRouter } from './cli-version.routes.js';
import { observeInstalledCliVersionChanges } from './cli-version-change.js';
import { startCliVersionWatch } from './cli-version-watch.js';
import { createCliVersionService, readInstalledCliVersion } from './cli-version.service.js';

/** `cli_version_changed` is sent at most once per second: a run's start and its first permission arrive together. */
const CLI_VERSION_HINT_GAP_MS = 1_000;

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
 *
 * Beside the router it arms the report's hint (`startCliVersionHint`), once, at boot.
 */
export function createCliVersionModule(): Router {
  const cliVersionService = createCliVersionService({
    readInstalled: readInstalledCliVersion,
    // The registry is the ONLY home of a run's version: it is read live here
    // and never copied anywhere that outlives the run.
    listRunningRuns: () => chatRunRegistry.listRunningRuns(),
  });

  startCliVersionHint();
  return createCliVersionRouter(cliVersionService);
}

/**
 * Tells every open tab `cli_version_changed` when the report moves: the installed version changed
 * (the watch on the binary probes, and the probe publishes the transition), or a run started or
 * ended — the report lists the runs still on an older version, so a run's coming and going is news.
 */
function startCliVersionHint(): void {
  const hint = createPacedHint({ kind: 'cli_version_changed', minGapMs: CLI_VERSION_HINT_GAP_MS, send: broadcastToAll });
  observeInstalledCliVersionChanges(() => hint.tell());
  chatRunRegistry.onRunChanged((_sessionId, { states }) => {
    if (states) hint.tell();
  });
  startCliVersionWatch({
    binaryPath: () => resolveSpawnedClaudeBinaryPath(),
    probe: readInstalledCliVersion,
    logError: (message) => console.error(`[cli-version] ${message}`),
  });
}
