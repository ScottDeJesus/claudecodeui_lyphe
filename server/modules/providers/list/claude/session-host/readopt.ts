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

import fs from 'node:fs';
import path from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { lastTurnFinishedAt, listLiveHosts, retireHost, retireOlderHosts, sessionsDir, sweepDeadHosts } from './hosts.js';
import type { LiveHost } from './hosts.js';
import { keepaliveEnabled } from './spawner.js';

/** `supervised`: this boot is the systemd unit's own child (server/index.ts knows; this module is not told how). */
type ReadoptDeps = { runtime: ProviderRuntimeGateway; supervised: boolean };

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
          heldForBackgroundWork: host.heldForBackgroundWork,
          profile: host.profile,
          deferredTools: host.deferredTools
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
          const finishedAt = lastTurnFinishedAt(host.hostId);
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
 * Ownership of the keepalive: ONE server per sessions dir may adopt, retire or sweep its hosts.
 *
 * The keepalive tmux server is single-owner by construction (one socket name, one sessions dir),
 * while nothing stops a second API from booting beside the serving one — a plan phase's probe on
 * a scratch database and a spare port is exactly how a phase proves itself. Measured 2026-09-15:
 * nine such probes each read the shared keepalive, found no session row in THEIR database for the
 * live chats, and retired them — nine SIGHUPs to the operator's open sessions. So ownership is a
 * claim file beside the hosts, `.owner` (no host suffix, so `listHostIds` never reads it as one),
 * naming the owning pid, and the claim FAILS CLOSED: a boot that cannot prove the holder is gone
 * touches nothing. The holder is gone when its pid is unassigned, or assigned to something that is
 * not a cloudcli server (a recycled pid, read from /proc); a pid this user may not signal (EPERM)
 * is alive and definitively not us. One override: the supervised server — the systemd unit's own
 * child — takes the claim from an unsupervised holder, because a probe that found the dir
 * unclaimed (the real server down at that moment) must not keep the real server from its hosts
 * when it comes back. Released at shutdown; a crash leaves a stale pid the next boot walks over.
 */
const OWNER_PATH = path.join(sessionsDir, '.owner');

type Owner = { pid: number; supervised: boolean; startedAt: number };

function readOwner(): Owner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(OWNER_PATH, 'utf8')) as Partial<Owner>;
    if (!Number.isInteger(parsed.pid) || (parsed.pid as number) <= 0) return null;
    return { pid: parsed.pid as number, supervised: parsed.supervised === true, startedAt: Number(parsed.startedAt) || 0 };
  } catch {
    return null;
  }
}

/** Alive AND a cloudcli server — anything else is a stale claim this boot may walk over. */
function holderIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true; // alive, and not ours to signal
    return false; // ESRCH: nobody
  }
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmdline.includes('server/index') || cmdline.includes('cloudcli');
  } catch {
    return true; // unreadable: assume the worst, which here is "someone is there"
  }
}

/** This process's pid once it holds the claim, or the live holder's pid when it does not. */
function claimKeepalive(supervised: boolean): { owner: true } | { owner: false; holder: number } {
  const holder = readOwner();
  if (holder && holder.pid !== process.pid && holderIsLive(holder.pid)) {
    if (!(supervised && !holder.supervised)) return { owner: false, holder: holder.pid };
    console.log(`[keepalive] supervised boot takes the claim from unsupervised pid ${holder.pid}`);
  }
  const mine: Owner = { pid: process.pid, supervised, startedAt: Date.now() };
  const tmp = `${OWNER_PATH}.${process.pid}.tmp`;
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(mine), 'utf8');
  fs.renameSync(tmp, OWNER_PATH);
  return { owner: true };
}

/** Drops the claim if it is ours. consumer: server/index.ts (shutdown) */
export function releaseKeepaliveOwnership(): void {
  const holder = readOwner();
  if (holder && holder.pid === process.pid) {
    try {
      fs.unlinkSync(OWNER_PATH);
    } catch {
      // Already gone; nothing to release.
    }
  }
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
  const claim = claimKeepalive(deps.supervised);
  if (!claim.owner) {
    console.log(`[keepalive] pid ${claim.holder} owns the keepalive — this boot adopts, retires and sweeps nothing`);
    return { readopted: 0, swept: 0 };
  }
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
