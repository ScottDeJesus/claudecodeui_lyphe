/**
 * Boot re-adoption: giving a registry run back to every CLI that outlived the API.
 *
 * Three rules this file exists to keep:
 * - It COMPOSES `runDetachedChatTurn` and never re-implements `dispatchRun` (D-11). The session
 *   row, the `hasRuntime` check, the busy check, the model recording and the
 *   `completeRunIfCurrent` safety net ARE the shape a run has to have; a second copy of them
 *   here would be a second answer to every question the gateway already answers.
 * - The provider run is never awaited, but the registry run is registered synchronously
 *   (`dispatchRun` calls `startRun` ahead of its first await). That is the whole reason this
 *   step runs before `server.listen`: a browser that subscribes into a registry which has not
 *   re-adopted yet reads a live session as idle.
 * - A host whose turn already reported `complete` has its run completed the instant it is
 *   registered. Leaving it `running` would wedge the session behind RUN_IN_PROGRESS
 *   (chat-websocket.service.ts:228-238) with no terminal event left to release it.
 *
 * consumer: index.ts — re-exported through the providers barrel for server/index.ts
 */

import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { listLiveHosts, retireHost, retireOlderHosts, sweepDeadHosts } from './hosts.js';
import type { LiveHost } from './hosts.js';
import { keepaliveEnabled } from './spawner.js';

type ReadoptDeps = { runtime: ProviderRuntimeGateway };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Hands one live host back to the gateway. Returns false when the host has nothing to be
 * re-adopted INTO — a session deleted while the API was down leaves a CLI with no row, no
 * transcript to append to and no one who can ever see it again, so it is wound down instead.
 */
function readoptHost(host: LiveHost, deps: ReadoptDeps): boolean {
  const row = sessionsDb.getSessionById(host.appSessionId);
  if (!row) {
    console.log(`[keepalive] host ${host.hostId} has no session row left — retiring it`);
    retireHost(host.hostId);
    return false;
  }

  console.log(`[keepalive] re-adopting host ${host.hostId} for session ${host.appSessionId}`);
  runDetachedChatTurn(
    {
      sessionId: host.appSessionId,
      userId: host.userId,
      // No prompt: the CLI is mid-conversation and the provider skips prompt building
      // entirely in re-attach mode. This turn exists to re-attach to a stream, not to ask.
      content: '',
      options: {
        cwd: row.project_path ?? host.cwd ?? undefined,
        keepalive: {
          reattach: true,
          hostId: host.hostId,
          turnCompleteSent: host.turnCompleteSent,
          heldForBackgroundWork: host.heldForBackgroundWork
        }
      },
      beforeRun: (run) => {
        // Before the provider is asked for anything: the run must never be observable as
        // `running` for a turn whose `complete` this API's predecessor already sent.
        if (host.turnCompleteSent) chatRunRegistry.completeRunIfCurrent(run, { exitCode: 0 });
      }
    },
    deps
  )
    .then((outcome) => {
      if (!outcome.started) {
        console.warn(
          `[keepalive] host ${host.hostId} was NOT re-adopted after all — the re-adopted count above overstates by one: ${outcome.error ?? 'the turn did not start'}`
        );
      }
    })
    .catch((err: unknown) => {
      // Not `void`: an unhandled rejection is fatal to the whole API under Node's default
      // policy, and a single unreachable host must never take the server down with it.
      console.error(`[keepalive] re-adopted turn for host ${host.hostId} failed: ${errorText(err)}`);
    });

  return true;
}

/**
 * The boot step: sweep what died, keep the newest host per session, and re-adopt each keeper.
 *
 * Counts what it DISPATCHED, not what has finished — the turns it starts outlive it by design.
 * consumer: index.ts
 */
export async function readoptKeepaliveSessions(
  deps: ReadoptDeps
): Promise<{ readopted: number; swept: number }> {
  const swept = sweepDeadHosts();
  // D-7 reaches this step too, or the gate is not the reversal it is documented to be. With it
  // off the provider refuses every reattach (`keepaliveReadopt` → null), so a turn dispatched
  // here would become a REAL, promptless turn on a REAL session — tokens spent and a junk entry
  // in the transcript — while the live host it meant to rejoin is orphaned. Dead files are
  // litter under either setting, so the sweep above still stands.
  if (!keepaliveEnabled()) return { readopted: 0, swept };

  // Newest wins, exactly as the provider's supersede branch decides it at runtime (D-8).
  const keepers = retireOlderHosts(listLiveHosts());

  let readopted = 0;
  for (const host of keepers) {
    if (readoptHost(host, deps)) readopted += 1;
  }

  return { readopted, swept };
}
