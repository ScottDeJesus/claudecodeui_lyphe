import type { Router } from 'express';

import { readDeepseekApiKey } from '@/modules/deepseek/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { KanbanMetisSession, KanbanMetisStateEvent } from '@/shared/types.js';

import { createKanbanMetisRouter, readAppJwtSecret } from './kanban-metis.routes.js';
import { createMetisDriver } from './metis-driver.service.js';
import { createMetisRegistry, setLiveMetisRegistry } from './metis-registry.service.js';
import { createMetisSpawner } from './metis-spawn.service.js';
import { startTelemetryWatcher } from './metis-telemetry.service.js';

/**
 * The composition root: the one place in `kanban-metis` that reads an environment, names a URL or
 * touches a socket.
 *
 * Everything under it takes what it needs as an argument, which is what lets a probe hand the
 * whole module a different origin, a different key and a state root in a temporary directory. That
 * is also why `metis-env.service.ts` can be proven to never spell `process.env`: the two values it
 * needs out of the environment are read HERE and passed down.
 */

/**
 * The port this process is listening on, resolved from the environment the server itself starts
 * with — the shape `browser-use.service.ts:190-193` uses for its own MCP URL, `SERVER_PORT` then
 * `PORT` then the house default.
 *
 * It matters that the answer is the RUNNING process's port and not a constant: a Metis child writes
 * to the board through this origin, so a server started on 7893 by a probe would otherwise have its
 * child writing through the operator's server on 3001 — and its frames would land in a chat nobody
 * has open.
 */
function resolveApiOrigin(): string {
  // The override seam, first: a deployment that fronts the API through a proxy, or a probe that
  // wants to hand a child an origin it can observe, says so explicitly rather than being guessed at.
  const override = process.env.KANBAN_PM_API_URL;
  if (override !== undefined && override !== '') return override.replace(/\/+$/, '');
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

/**
 * How often the registry's picture is taken. `dispatch-souls.module.ts`'s own cadence, for the same
 * reason: fast enough that a launch or an ending reaches the panel while the reader is still
 * looking at it, slow enough over a few small files to be free.
 */
const POLL_MS = 2000;

/**
 * Builds the Metis module for the server entrypoint, which mounts it at `/api/kanban-metis` behind
 * `authenticateToken`.
 *
 * IT RETURNS A ROUTER, not the `{ router, start, stop }` object the launcher-souls module returns,
 * because the plan's own mount line is one expression: `app.use('/api/kanban-metis',
 * authenticateToken, createKanbanMetisModule())`. So the lane this module exists to feed starts
 * here, with the module — and it is safe to start it that way because `createPolledLane` unrefs its
 * interval (`polled-lane.service.ts:113`), so a poll in flight is never a reason for the process to
 * stay alive at shutdown.
 *
 * The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
 * `wss.clients` set, which would also deliver it to `/shell`, `/plugin-ws` and
 * `/desktop-notifications`, where it would be parsed and dropped, and on `/plugin-ws` handed to
 * third-party plugin frontends that have no business seeing which boards the operator is building.
 */
export function createKanbanMetisModule(): Router {
  // A probe server sets KANBAN_METIS_STATE_ROOT (with DATABASE_PATH) so its registry never
  // adopts, stops or deletes the operator's own sessions under the default root.
  const registry = createMetisRegistry(process.env.KANBAN_METIS_STATE_ROOT || undefined);
  // The process's one registry, published before any request can arrive: the `kanban-pm` guard is
  // mounted as a bare middleware and has no argument to receive it through.
  setLiveMetisRegistry(registry);

  const spawner = createMetisSpawner({
    registry,
    apiOrigin: resolveApiOrigin(),
    appSecret: readAppJwtSecret(),
    readDeepseekKey: readDeepseekApiKey,
  });

  const broadcast = (frame: KanbanMetisStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  /**
   * The lane's one door to the journal. Everything under this root polls every two seconds, so a
   * fault that persists is a fault that repeats: said once per distinct message, for the life of
   * the process.
   */
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(message);
  };

  const lane = createPolledLane<KanbanMetisSession[], KanbanMetisStateEvent>({
    snapshot: () => registry.list(),
    // ON CHANGE ONLY, and the change is the whole picture: a session appearing, a state moving and
    // a log's mtime advancing are the same comparison, and a quiet board puts nothing on the wire.
    frame: (sessions) => ({ kind: 'kanban_metis_state', sessions, at: Date.now() }),
    broadcast,
    pollMs: POLL_MS,
    logError: (message) => logErrorOnce(`[KanbanMetis] ${message}`),
  });
  lane.start();

  /**
   * The autonomy loop, built beside the two services it drives and started AFTER them.
   *
   * The order is the whole of its correctness. `createMetisRegistry` is the line that re-adopts
   * every session already on disk — a Metis is detached and outlives this server, so at boot there
   * are children still thinking whose records this process has never held. The driver must tick
   * over THAT registry, with those sessions in it, or its first pass would find an empty map and
   * spawn a second child for a board that is already being built.
   *
   * It is started here and nowhere else, which is why this module's barrel exports nothing for it:
   * there is no second composition root to hand it to. The interval it starts is unreferenced
   * (`metis-driver.service.ts`), so it is never a reason for the process to stay alive; this
   * module's contract is to return a router rather than a `{ router, start, stop }`, so there is no
   * teardown path for a `stop()` to hang off, and nothing needs one — an unreferenced interval
   * ends with the process it lives in.
   */
  const metisDriver = createMetisDriver({ registry, spawner });
  metisDriver.start();

  /**
   * The token watcher, started beside the two services it reads.
   *
   * It takes no argument because everything it needs is the process's own state: the registry the
   * line above publishes, and the board, which it reaches through the board's barrel. Like the
   * driver's, its interval is unreferenced, so it is never a reason for the process to stay alive —
   * and it reads the clock itself, one second from now rather than one from construction.
   */
  startTelemetryWatcher();

  return createKanbanMetisRouter({ registry, spawner, driver: metisDriver });
}
