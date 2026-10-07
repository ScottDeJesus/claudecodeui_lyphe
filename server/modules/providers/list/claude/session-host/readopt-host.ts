/**
 * Handing ONE live host back to the gateway — the step the boot re-adoption (`readopt.ts`) and a
 * node's link-up re-adoption (`node-readopt.ts`) both end in.
 *
 * Rules this file exists to keep:
 * - It COMPOSES `runDetachedChatTurn` and never re-implements `dispatchRun` (D-11). The session
 *   row, the `hasRuntime` check, the busy check, the model recording and the
 *   `completeRunIfCurrent` safety net ARE the shape a run has to have; a second copy of them
 *   here would be a second answer to every question the gateway already answers.
 * - The provider run is never awaited, but the registry run is registered synchronously
 *   (`dispatchRun` calls `startRun` ahead of its first await). That is the whole reason the boot
 *   step runs before `server.listen`: a browser that subscribes into a registry which has not
 *   re-adopted yet reads a live session as idle.
 * - A host whose turn already reported `complete` has its run completed the instant it is
 *   registered. Leaving it `running` would wedge the session behind RUN_IN_PROGRESS
 *   (chat-websocket.service.ts:228-238) with no terminal event left to release it.
 * - The host answers to the machine that holds it: `node` is the warden's node, or null for this
 *   machine's own keepalive. It rides the reattach the provider reads, so the CLI is rejoined where
 *   it lives and never anywhere else — and a host with no session row left is wound down through
 *   the same door it is reached by.
 *
 * consumer: readopt.ts (the boot), node-readopt.ts (a node's link-up)
 */

import { nodeSessions } from '@/modules/cerberus/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { noteNodeHostsChanged } from './colocated-hosts.js';
import { lastTurnFinishedAt, retireHost } from './hosts.js';
import type { LiveHost } from './hosts.js';

/**
 * A host to hand back: one this machine's registry listed, or one a node's warden listed — which
 * already carries the warden's own reading of when the CLI last ended a turn.
 */
export type ReadoptableHost = LiveHost & { lastTurnFinishedAt?: number | null };

/** `supervised`: this boot is the systemd unit's own child (server/index.ts knows; this module is not told how). */
export type ReadoptDeps = { runtime: ProviderRuntimeGateway; supervised: boolean };

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Hands one live host back to the gateway. Returns false when the host has nothing to be
 * re-adopted INTO — a session deleted while the API was down leaves a CLI with no row, no
 * transcript to append to and no one who can ever see it again, so it is wound down instead.
 *
 * A node's host brings its own `lastTurnFinishedAt` (null when it never ended a turn); a local
 * host's is read from its journal when the run is registered, because a local `LiveHost` has none.
 *
 * consumer: readopt.ts, node-readopt.ts
 */
export function readoptHost(host: ReadoptableHost, deps: ReadoptDeps, node: string | null = null): boolean {
  const where = node === null ? '' : ` on node ${node}`;
  const row = sessionsDb.getSessionById(host.appSessionId);
  if (!row) {
    console.log(`[keepalive] host ${host.hostId}${where} has no session row left — retiring it`);
    if (node === null) {
      retireHost(host.hostId);
    } else {
      nodeSessions.retireHost(node, host.hostId);
      // The node's last list still names the host just retired, and its card counts that list.
      noteNodeHostsChanged(node);
    }
    return false;
  }

  console.log(`[keepalive] re-adopting host ${host.hostId}${where} for session ${host.appSessionId}`);
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
          heldForBackgroundWork: host.heldForBackgroundWork,
          profile: host.profile,
          cliVersion: host.cliVersion,
          deferredTools: host.deferredTools,
          node
        }
      },
      beforeRun: (run) => {
        // Before the provider is asked for anything: the run must never be observable as
        // `running` for a turn whose `complete` this API's predecessor already sent.
        if (host.turnCompleteSent) {
          // Stamped only when the CLI ended a turn after the session's last recorded completion:
          // a follow-up turn a background task pushed ends with no `complete` of its own, so that
          // is news. A turn the predecessor already recorded is not — re-stamping it made the chat
          // unread on every restart with no new activity.
          const finishedAt = host.lastTurnFinishedAt !== undefined ? host.lastTurnFinishedAt : lastTurnFinishedAt(host.hostId);
          const stampedAt = row.last_completed_at ? Date.parse(row.last_completed_at) : Number.NaN;
          const alreadyRecorded = finishedAt === null || (Number.isFinite(stampedAt) && finishedAt <= stampedAt);
          chatRunRegistry.completeRunIfCurrent(run, { exitCode: 0, alreadyRecorded });
        }
      }
    },
    deps
  )
    .then((outcome) => {
      if (!outcome.started) {
        console.warn(
          `[keepalive] host ${host.hostId}${where} was NOT re-adopted after all — the re-adopted count above overstates by one: ${outcome.error ?? 'the turn did not start'}`
        );
      }
    })
    .catch((err: unknown) => {
      // Not `void`: an unhandled rejection is fatal to the whole API under Node's default
      // policy, and a single unreachable host must never take the server down with it.
      console.error(`[keepalive] re-adopted turn for host ${host.hostId}${where} failed: ${errorText(err)}`);
    });

  return true;
}
