import type { Router } from 'express';

import { ensureChatCommandLink } from '@/modules/chat-commands/index.js';

import { createFollowupsCommandRoutes } from './followups.command-routes.js';
import { createFollowupsRoutes } from './followups.routes.js';
import { followupsService } from './followups.service.js';

/**
 * Builds the followups lane for the server entrypoint, which mounts its two routers: the widget's at
 * `/api/followups` behind `authenticateToken`, and the `followups` command's at `/api/followups-cmd` with no
 * user guard, because its own first middleware checks the chat's credential.
 *
 * There is nothing to read here: no environment, no path, no database handle. The rows live in the same
 * database as everything else, reached through the repository barrel, and the frame goes to the gateway's open
 * sockets through the websocket barrel. This composition root names the one service instance and hands it to
 * both routers — which is why the two doors cannot disagree about what a line may be or about whether a write
 * sends its frame.
 *
 * One thing happens at creation: `~/.local/bin/followups` is linked to `bin/followups.mjs`, so the command the
 * surface prompt names resolves in a chat's Bash tool. It is wrapped, because a read-only home must never take
 * down chat, files and git for the sake of a command: a link that cannot be made is one warning.
 */
export function createFollowupsModule(): { userRouter: Router; commandRouter: Router } {
  try {
    ensureChatCommandLink('followups', 'followups');
  } catch (error) {
    console.warn(
      '[followups] could not link the followups command — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return { userRouter: createFollowupsRoutes(followupsService), commandRouter: createFollowupsCommandRoutes(followupsService) };
}
