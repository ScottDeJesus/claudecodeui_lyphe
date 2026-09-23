/**
 * Retiring an IDLE host that is on an older CLI than the binary on disk — the one retirement no
 * message asked for.
 *
 * Until this existed a stale host was replaced at its NEXT message (`chat-process.ts`'s
 * `planLiveChanges`), so an idle conversation sat on the old build for up to the idle closer's two
 * hours with nothing in the UI saying so — the banner keys on a turn in flight, and a host between
 * turns is listed by no report at all. The operator asked for that gap closed: a conversation with
 * a turn in flight is never touched (the banner's own case, and the reason the press still exists),
 * and one that is merely between turns is wound down here, so its next message spawns fresh on the
 * installed build and resumes the same conversation — exactly what a retirement at message time
 * already did, an hour earlier.
 *
 * TWO TRIGGERS, ONE TEST:
 * - The installed reading MOVES — an install, seen by the probe whose cache the version route and
 *   the message path share (`cli-version-change.ts` is the transition; `watchInstalledCliVersionChanges`
 *   below is this package's subscription to it). The sweep rides the probe's own cache window, so
 *   there is no timer here and none is wanted: a client polls the route about once a minute, and a
 *   send re-asks the same reading.
 * - BOOT RE-ADOPTION — `readopt.ts` applies the same test to each keeper after `retireOlderHosts`,
 *   so an API restart after an update does not hand a conversation back to the old build. A boot
 *   covers the machine whose server was down when the install happened, and the server nobody has
 *   open a browser against.
 *
 * The test is the message path's, not a second one: BOTH sides a version string (a process that has
 * not spoken, or a reading of `null`, is "not heard" — never a reason to replace anything), the
 * process BEHIND the binary in the ordered comparison (`chat-process.ts`'s `isBehindInstalled`,
 * so a downgrade retires nothing that is ahead of it), and no work in flight for its app session
 * (`busyReason` below — the registry where it can answer, the host's own meta where it cannot).
 *
 * consumer: readopt.ts (boot), and the observer this package registers with the reading
 */

import { observeInstalledCliVersionChanges } from '@/modules/cli-version/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';

import { isBehindInstalled } from '../chat-process.js';

import { listLiveHosts, retireHost } from './hosts.js';
import type { LiveHost } from './hosts.js';

/**
 * Why this host must not be wound down, or `null` when it is genuinely idle.
 *
 * The run registry is the first answer and the wrong one at a BOOT: it is per-process memory, this
 * step runs from `soleServerDuties()` before the port is even listening (`server/index.ts`), and so
 * it is empty — it answers "no turn in flight" for every session on the machine, including one that
 * was mid-answer when the API restarted. The host's own meta is the witness that survives the
 * restart, and it carries what the runtime's idle closer reads there (`isBusy`,
 * `claude-runtime.provider.js`): a turn that started and has not reported (`turnCompleteSent`, set
 * `false` when a turn is accepted and back to `true` at its result) and background work the result
 * did not wait for (`heldForBackgroundWork`, or the `deferredTools` list it is derived from — kept
 * as well because a meta written before that list existed holds only the boolean).
 *
 * Both matter here because `retireHost` winds a host down for good: it interrupts FIRST and then ends
 * the CLI's stdin — the EOF, not the interrupt, is what takes the background work still running in
 * that CLI down — and the exit frame that follows deletes the journal. So a retirement the run
 * registry could not see does not merely end a process, it destroys the work in flight and its only
 * record. `readoptHost` gets `turnCompleteSent` for exactly this case; the sweep must honour it
 * rather than retire the host the boot step was about to hand back its turn.
 */
function busyReason(host: LiveHost): string | null {
  if (chatRunRegistry.isProcessing(host.appSessionId)) return 'a turn is running in this process';
  if (!host.turnCompleteSent) return 'a turn was in flight';
  if (host.heldForBackgroundWork || host.deferredTools.length > 0) return 'background work is outstanding';
  return null;
}

/**
 * Winds down every host in `hosts` that is idle AND behind `installedVersion`; returns the ones
 * left standing.
 *
 * Returning the survivors rather than a count is what lets the boot path and the install path share
 * one function: the boot continues into re-adoption with what survived, and the install path only
 * ever wanted the retirement to have happened.
 *
 * `null` — the CLI is chosen when a run starts, or `--version` did not answer — retires nothing at
 * all. That is the same "not heard" the message path reads it as, and the same reason a host with
 * no version in its journal is left alone rather than declared stale.
 */
export function retireStaleIdleHosts(hosts: LiveHost[], installedVersion: string | null): LiveHost[] {
  if (typeof installedVersion !== 'string') return hosts;

  const standing: LiveHost[] = [];
  for (const host of hosts) {
    const reported = host.cliVersion;
    const stale = typeof reported === 'string'
      && reported !== installedVersion
      && isBehindInstalled(reported, installedVersion);
    const busy = stale ? busyReason(host) : null;
    if (!stale || busy) {
      // A turn in flight keeps the version its turn started on: winding the CLI down mid-answer is
      // the interruption the banner asks a person for, never something the server does on its own.
      // Said out loud, and only for a host that WAS stale — that is the near-miss an operator would
      // otherwise have to infer from a retirement that did not happen.
      if (busy) {
        console.log(
          `[keepalive] keeping host ${host.hostId} on cli ${reported}: ${busy} — it is retired at its next message, not now`
        );
      }
      standing.push(host);
      continue;
    }
    // The journal is the version's source (`hosts.ts`'s `lastReportedCliVersion`), so this line can
    // only be printed for a version the process itself announced.
    console.log(`[keepalive] retiring idle host ${host.hostId}: cli ${reported} → ${installedVersion}`);
    retireHost(host.hostId);
  }
  return standing;
}

/**
 * Subscribes the sweep to the install it exists for. Called once per boot by the process that has
 * CLAIMED the keepalive (`readopt.ts`), because a second API beside the serving one must not walk
 * this machine's hosts — the same rule that keeps that process from adopting or retiring anything.
 *
 * The walk is DEFERRED by one turn of the event loop: `listLiveHosts` runs tmux, and this fires
 * inside the probe's own promise — the version route and the message send that asked for the
 * reading must not wait on it. Deferring also means a reading that arrives while the sweep runs is
 * not held up by it; the sweep is idempotent, so an install seen twice retires once.
 */
export function watchInstalledCliVersionChanges(): void {
  // Once per process, enforced here rather than assumed: the registry is a plain set, so a second
  // registration would be a second sweep of every host on the machine, and the boot step would log
  // each retirement as many times as it had been called.
  if (watchingForInstalls) return;
  watchingForInstalls = true;
  observeInstalledCliVersionChanges(({ to }) => {
    setImmediate(() => {
      try {
        retireStaleIdleHosts(listLiveHosts(), to);
      } catch (error) {
        // A sweep that failed must not take the API down with it, and it says so once per install:
        // the hosts it did not reach are retired at the next boot or at their own next message.
        console.warn(
          `[keepalive] the idle-host sweep failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  });
}

/** `watchInstalledCliVersionChanges` registers at most once per process — this is that record. */
let watchingForInstalls = false;
