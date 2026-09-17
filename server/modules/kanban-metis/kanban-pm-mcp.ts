#!/usr/bin/env node
/**
 * The `kanban-pm` stdio MCP server: Descent's twenty-five PM tools, served over the board's own
 * HTTP verbs.
 *
 * This is a PROGRAM, not a service. It is spawned as a stdio child of the CLI, one per Metis
 * session, and it holds nothing: no database handle, no router, no websocket fan-out. Everything it
 * knows arrives in its environment (`KANBAN_PM_*`, read by `kanban-pm-client.ts`) and every answer
 * it gives is one or more calls to the routes the board already serves. That is why the module
 * below composes three tool tables and a transport and implements nothing itself: the tools live
 * in the three `mcp/kanban-pm-tools-*` modules, the HTTP in `mcp/kanban-pm-client.ts`, the
 * protocol in `mcp/mcp-protocol.ts`, and the lease heartbeat in `mcp/kanban-pm-heartbeat.ts`.
 *
 * It is also a LEAF: nothing under `mcp/` reaches past `mcp/` itself, the Node builtins and
 * `server/shared`, so no import here pulls in a sibling feature module or a service. An import
 * reaching back into `kanban-metis` would drag a database handle and a router into a process that
 * has to start in milliseconds and hold nothing.
 *
 * Consumers: the `kanban-pm-mcp` command in `server/modules/cli/cli.service.ts`, and the command
 * `getKanbanPmMcpCommand()` resolves for the spawner — both of which merely start it.
 */
import { createKanbanPmClient, readKanbanPmConfig } from './mcp/kanban-pm-client.js';
import { startKanbanPmHeartbeat } from './mcp/kanban-pm-heartbeat.js';
import { createBoardTools } from './mcp/kanban-pm-tools-board.js';
import { createCardTools } from './mcp/kanban-pm-tools-cards.js';
import { createDetailTools } from './mcp/kanban-pm-tools-detail.js';
import { startStdioTransport, type ToolTable } from './mcp/mcp-protocol.js';

function main(): void {
  const client = createKanbanPmClient(readKanbanPmConfig());

  const tables: ToolTable[] = [
    createCardTools(client),
    createDetailTools(client),
    createBoardTools(client),
  ];

  const handlers: ToolTable['handlers'] = {};
  for (const table of tables) {
    Object.assign(handlers, table.handlers);
  }

  // Before the transport: the first lease this process claims is refreshed on the first tick after
  // it is claimed, and a heartbeat started later would leave a window where a claim is never
  // re-stamped at all.
  startKanbanPmHeartbeat(client);

  startStdioTransport({ tools: tables.flatMap((table) => table.tools), handlers });
}

try {
  main();
} catch (error) {
  // A server that cannot be configured must not start: it would answer every tool with a request to
  // an unknown origin, and the session would read that as a broken board.
  process.stderr.write(`[kanban-pm] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
