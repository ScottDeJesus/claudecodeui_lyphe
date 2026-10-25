import type { Router } from 'express';

import { ensureChatCommandLink } from '@/modules/chat-commands/index.js';

import { createNotesCommandRoutes } from './notes.command-routes.js';
import { createNotesRoutes } from './notes.routes.js';
import { notesService } from './notes.service.js';

/**
 * Builds the notes lane for the server entrypoint, which mounts its two routers: the tab's at
 * `/api/notes` behind `authenticateToken`, and the `notes` command's at `/api/notes-cmd` with no user
 * guard, because its own first middleware checks the chat's credential.
 *
 * There is nothing to read here: no environment, no path, no database handle. The lane's rows live in
 * the same database as everything else, reached through the repository barrel, and its frame goes to
 * the gateway's open sockets through the websocket barrel. So this composition root names the one
 * service instance and hands it to both routers — which is why the two doors cannot disagree about a
 * title's length or about whether a write sends its frame.
 *
 * One thing happens at creation: `~/.local/bin/notes` is linked to `bin/notes.mjs`, so the command the
 * `notes` skill names resolves in a chat's Bash tool. It is wrapped, because a read-only home must never
 * take down chat, files and git for the sake of a command: a link that cannot be made is one warning.
 */
export function createNotesModule(): { userRouter: Router; commandRouter: Router } {
  try {
    ensureChatCommandLink('notes', 'notes');
  } catch (error) {
    console.warn(
      '[notes] could not link the notes command — the API stays up:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return { userRouter: createNotesRoutes(notesService), commandRouter: createNotesCommandRoutes(notesService) };
}
