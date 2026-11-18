import type { Router } from 'express';

import { ensureChatCommandLink } from '@/modules/chat-commands/index.js';

import { createSessionPanelCommandRoutes } from './session-panel.command-routes.js';
import { createSessionPanelRoutes } from './session-panel.routes.js';
import { sessionPanelService } from './session-panel.service.js';

/**
 * Builds the session panel's lane for the server entrypoint, which mounts its two routers: the reader's at `/api/session-panel`
 * behind `authenticateToken`, and the `panel` command's at `/api/session-panel-cmd` with no user guard, because its own first
 * middleware checks the chat's credential.
 *
 * One service instance is handed to both routers, so the two doors cannot disagree about what a version is. One thing happens at
 * creation: `~/.local/bin/panel` is linked to `bin/panel.mjs`, so the command the surface prompt names resolves in a chat's Bash
 * tool. It is wrapped, as the followups lane's is: a link that cannot be made is one warning, and the API stays up.
 */
export function createSessionPanelModule(): { userRouter: Router; commandRouter: Router } {
  try {
    ensureChatCommandLink('panel', 'session-panel');
  } catch (error) {
    console.warn(
      '[session-panel] could not link the panel command — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return { userRouter: createSessionPanelRoutes(sessionPanelService), commandRouter: createSessionPanelCommandRoutes(sessionPanelService) };
}
