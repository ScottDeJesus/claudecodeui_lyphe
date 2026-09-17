import { resolveMcpCommand } from '@/shared/mcp-command.js';

/**
 * How a spawned Metis child's MCP config should launch this module's stdio server.
 *
 * The three installs are the shared resolver's — the compiled `kanban-pm-mcp.js` beside this
 * module, the TypeScript entry through the repo's own tsx, or the `cloudcli` binary for an install
 * that has one on PATH and no sources to run. This file adds nothing to that decision; it names
 * which script and which CLI verb are being resolved, and the caller passes the answer straight
 * into the child's `--mcp-config`.
 *
 * Consumers: `kanban-metis`'s spawn path, which hands the pair to the child as its one MCP server
 * under `--strict-mcp-config`, and `server/modules/browser-use/browser-use.service.ts`'s sibling
 * call — the two callers of the one resolver, never two copies of it.
 */
export function getKanbanPmMcpCommand(): { command: string; args: string[] } {
  return resolveMcpCommand('kanban-pm-mcp', 'kanban-pm-mcp');
}

/**
 * Starts the `kanban-pm` stdio server in THIS process, for the `kanban-pm-mcp` CLI command.
 *
 * Separate from the resolver above on purpose, because the two run in different places: the
 * resolver hands a command to be spawned as a child, while this one is the child. The import is
 * lazy for the same reason `startBrowserUseMcp` is — loading the entrypoint is what starts the
 * server, and a static import would start a stdio server the moment anything read this barrel.
 */
export async function startKanbanPmMcp(): Promise<void> {
  await import('./kanban-pm-mcp.js');
}

// The Metis module: used by the server entrypoint to mount a board's Metis at `/api/kanban-metis`
// behind `authenticateToken` — the launch of one session for a board, her stop, her resume, the
// listing the panel seeds from, and the driver's own reading of one board. Its mount is one
// expression, so the polled state lane starts with it AND the autonomy loop does: the driver is a
// module-internal service, built and started in that composition root, and reachable from outside
// only through the routes this export mounts. Nothing here needs to be handed to it, which is why
// the module's barrel has nothing to say about it and why there is no export below for one.
export { createKanbanMetisModule } from './kanban-metis.module.js';

// kanbanMetisSecretGuard: used by the server entrypoint as the bare middleware on the second
// board mount, `/api/kanban-pm` without `authenticateToken` — the door the `kanban-pm` MCP child
// comes in through, on the derived per-session credential and with the descent importer refused
// before the router can see it. It reads the process's registry itself (`setLiveMetisRegistry`,
// called by the composition root above), so it too needs nothing here.
export { kanbanMetisSecretGuard } from './kanban-metis.routes.js';
