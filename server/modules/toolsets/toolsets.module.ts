import type { Router } from 'express';

import { providerRuntimeService } from '@/modules/providers/index.js';

import { ensureToolsetCommandLink } from './toolsets.command-link.js';
import { createToolsetsCommandRouter, createToolsetsUserRouter } from './toolsets.routes.js';
import { ensureToolsetsFile } from './toolsets.registry.js';
import { toolsetsService } from './toolsets.service.js';

/**
 * Builds tool sets for the server entrypoint, which mounts the two routers: the user router at
 * `/api/toolsets` behind `authenticateToken`, the command router at `/api/toolsets-cmd` with no
 * user guard, because its own first middleware checks the chat's credential.
 *
 * Three things happen at creation. The box file is created as `{}` so it exists from the first boot,
 * and `~/.local/bin/toolset` is linked to `bin/toolset.mjs` so the command the pointer names resolves
 * in a chat's Bash tool; each call is wrapped and a failure is one warning, because a read-only root
 * or home must never take down chat, files and git for the sake of a list of sets — the view answers
 * the broken setup on the one request that needs the file. Then the launch hook is registered with
 * the Claude runtime, which reads it at call time: inert until this runs, live from then on.
 */
export function createToolsetsModule(): { userRouter: Router; commandRouter: Router } {
  try {
    ensureToolsetsFile();
  } catch (error) {
    console.warn(
      '[toolsets] could not create the tool-set file — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    ensureToolsetCommandLink();
  } catch (error) {
    console.warn(
      '[toolsets] could not link the toolset command — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  providerRuntimeService.useChatToolsets({ launchFor: toolsetsService.launchFor });

  return { userRouter: createToolsetsUserRouter(), commandRouter: createToolsetsCommandRouter() };
}
