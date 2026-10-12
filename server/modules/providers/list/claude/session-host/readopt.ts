/**
 * Boot re-adoption: giving a registry run back to every CLI that outlived the API.
 *
 * The rules of handing ONE host back (it COMPOSES `runDetachedChatTurn`, never re-implements
 * `dispatchRun`; the registry run is registered synchronously; a host whose turn already reported
 * `complete` has its run completed at once) are `readopt-host.ts`'s, shared with a node's link-up
 * re-adoption. What this file keeps:
 * - The claim. ONE server per sessions dir may adopt, retire or sweep its hosts, and everything
 *   below it — this machine's hosts AND the watch for a node's link — happens only after it is held.
 * - The step runs before `server.listen`: a browser that subscribes into a registry which has not
 *   re-adopted yet reads a live session as idle.
 * - The boot does not hand a conversation back to a build it has already replaced: the keepers go
 *   through the same version test a message applies (`idle-version-sweep.ts`), and the process that
 *   took the claim is the one that keeps watching for the next install.
 *
 * consumer: index.ts — re-exported through the providers barrel for server/index.ts
 */

import fs from 'node:fs';
import path from 'node:path';

import { installedCliVersionForLaunch } from '../installed-cli-version.js';

import { listLiveHosts, retireOlderHosts, sessionsDir, sweepDeadHosts } from './hosts.js';
import { retireStaleIdleHosts, watchInstalledCliVersionChanges } from './idle-version-sweep.js';
import { releaseNodeReadoptionWait, watchNodeLinks } from './node-readopt.js';
import { readoptHost } from './readopt-host.js';
import type { ReadoptDeps } from './readopt-host.js';
import { keepaliveEnabled } from './spawner.js';

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
    releaseNodeReadoptionWait();
    return { readopted: 0, swept: 0 };
  }
  const swept = sweepDeadHosts();
  // D-7 reaches this step too, or the gate is not the reversal it is documented to be. With it
  // off the provider refuses every reattach (`keepaliveReadopt` → null), so a turn dispatched
  // here would become a REAL, promptless turn on a REAL session — tokens spent and a junk entry
  // in the transcript — while the live host it meant to rejoin is orphaned. Dead files are
  // litter under either setting, so the sweep above still stands.
  if (!keepaliveEnabled()) {
    releaseNodeReadoptionWait();
    return { readopted: 0, swept };
  }

  // This process owns the keepalive from here on, so it is also the one that watches the installed
  // reading for an INSTALL: a host left idle on an older build is retired the moment the version
  // moves, not only at its next message (`idle-version-sweep.ts`). Registered after the claim,
  // never before: the process that did not take the claim touches nothing.
  watchInstalledCliVersionChanges();

  // A node's hosts come back when its warden is heard, not at this boot: the gateway only starts
  // listening after this step, so the wardens redial afterwards. Registered here, after the claim and
  // the gate, for the reason everything above is: a process that did not take the claim touches nothing.
  watchNodeLinks(deps);

  // Newest wins, exactly as the provider's supersede branch decides it at runtime (D-8). Then the
  // version test, on the survivors: a restart after an install must not re-adopt a host on the
  // build the install replaced. The reading is the same cached one the route serves and the
  // message path asks, taken with the send path's own bound — a boot must not wait out a binary
  // that will not answer `--version`, and a `null` retires nothing.
  const keepers = retireOlderHosts(listLiveHosts());
  const fresh = retireStaleIdleHosts(keepers, await installedCliVersionForLaunch());

  let readopted = 0;
  for (const host of fresh) {
    if (readoptHost(host, deps)) readopted += 1;
  }

  return { readopted, swept };
}
