import { cerberusNodesDb, getCerberusConnection } from '@/modules/database/index.js';
import type { CerberusGatewayState, CerberusResultWire } from '@/shared/cerberus-types.js';

import { HUB_NODE_ID } from './definition-document.js';
import { ingest } from './ingest.service.js';
import { resolveNodeLink } from './read-model/node-links.js';
import { pauseWindows } from './updates.service.js';
import { wardenLinks } from './warden-links.js';

/**
 * Cerberus checking itself: the three checks of node `center`, service `cerberus`, every 30 seconds.
 *
 * Center has no warden, so nobody else reports for it. Each tick builds three `CerberusResultWire`s
 * and hands them to ingest exactly as a warden's would arrive (`seq` null, since no warden sequenced
 * them), so a self-check is stored by the same rule — a change, a keepalive, or nothing — and read by
 * the same read model as every other check. Nothing about them is special after this file.
 *
 *   `cerberus/wardens.fresh`     "1 of 1 reporting": ok while every node that has spoken is reporting,
 *                                failing while one is silent; no result (status null) with none yet.
 *                                A node whose warden is restarting for an update is neither: it is
 *                                named ("1 of 2 reporting · 1 updating") and does not fail the check.
 *   `cerberus/gateway.listening` "Listening on 100.103.222.79:3012"; failing with the bind error;
 *                                null with "CERBERUS_LISTEN is not set".
 *   `cerberus/store.write`       "Took the write lock in 2 ms": the time an empty `BEGIN IMMEDIATE`
 *                                took, measured just before the three are ingested.
 *
 * "A node that has spoken": a node whose warden has not yet sent a first heartbeat is mid-install, not
 * silent — the fleet screen calls it `never`, and counting it would turn this check failing for the
 * seconds between an enrollment and its first beat. The link rule is the screen's own
 * (`resolveNodeLink`), so this check and the screen cannot disagree about who is reporting — nor about
 * who is paused: a restart the warden was told to make is not an outage, and one that outlasts its 90 s
 * is the silence it then reads as.
 *
 * `prevAt` is the time of the last tick that INGESTED WITHOUT ERROR, null after a boot. Stored or not:
 * an unchanged tick stores nothing (a keepalive's business) and is still a link in the chain. A tick
 * that threw (the store could not write) claims no continuity, so the reader sees the gap for what it is. A store that
 * cannot write stores nothing at all, and the three checks go stale and read "No result" 90 seconds
 * later — which is the truth, and the reason `store.write` has no failing value of its own.
 *
 * A DEPLOY MUST NOT PAINT THE HUB GREY. Ingest stores an unchanged check only as a keepalive every
 * five minutes, so the last stored row can be minutes older than the last tick, and the successor's
 * first row has `prevAt` null — a lapse, which the reader can vouch for only back to that last stored
 * row + 90 s. The stretch between would read "No result" although this process was ticking all along.
 * Two things close it. `stopSelfChecks` stores the last tick as a keepalive (`ingestResults`' fourth
 * argument): a clean stop leaves a row saying "alive until T", and the successor's first row lands
 * within 90 s of it. And the first tick runs when the duties arm, not 30 s later: this repo restarts
 * the API on every save under `server/`, so a burst of processes that each live under 30 s would
 * otherwise leave no row at all, and the hub would read "No result" across the burst. With a tick at
 * the start every process leaves a row, and a burst is rows less than 90 s apart, not a hole. A
 * process that dies uncleanly leaves no keepalive, and the gap reads as the gap it is.
 *
 * `store.write` TRIES THE LOCK WITHOUT WAITING. The connection waits five seconds on a lock held
 * elsewhere, and it waits on the event loop's own thread — every route of the API would freeze for
 * those five seconds at every tick. A lock that is not free at once throws, the tick stores nothing,
 * and the checks go stale, which is again the truth.
 *
 * Started by the module's `soleDuties()`, never by a process that merely booted: a second API process
 * on a scratch or overlapping store must write no hub row (`readopt.ts` measured what a duty
 * performed by every process costs).
 *
 * Consumers: `cerberus.module.ts` (`startSelfChecks` from `soleDuties`, `stopSelfChecks` from `stop`).
 */

/** One tick every 30 s; the hub's checks are defined `every: 30`, so a missed tick reads unknown after 90 s. */
const TICK_INTERVAL_MS = 30_000;

const WARDENS_FRESH_KEY = 'cerberus/wardens.fresh';
const GATEWAY_LISTENING_KEY = 'cerberus/gateway.listening';
const STORE_WRITE_KEY = 'cerberus/store.write';

let tickTimer: NodeJS.Timeout | null = null;
/** The last tick that ingested without error: its time (the next tick's `prevAt`) and the results it carried. */
let lastIngestedTick: { at: number; results: CerberusResultWire[] } | null = null;

/** A self-check result: every field a warden would send, `source` being the check's own key. */
function resultOf(
  key: string,
  at: number,
  prevAt: number | null,
  outcome: { status: CerberusResultWire['status']; value: string; tookMs?: number }
): CerberusResultWire {
  return {
    check: key,
    source: key,
    at,
    fetchedAt: at,
    status: outcome.status,
    docStatus: null,
    value: outcome.value,
    data: null,
    tookMs: outcome.tookMs ?? null,
    prevAt,
  };
}

/** How many of the nodes that have spoken are reporting now, and how many of the rest are only restarting for an update. */
function wardensFreshOutcome(now: number): { status: CerberusResultWire['status']; value: string } {
  const states = wardenLinks.states();
  const spoken = cerberusNodesDb
    .list()
    .map((row) => resolveNodeLink(row, states.get(row.id), now, pauseWindows(row.id, now, now + 1)))
    .filter((link) => link.link !== 'never');
  if (spoken.length === 0) return { status: null, value: 'No warden has enrolled yet' };

  const reporting = spoken.filter((link) => link.link === 'reporting').length;
  const updating = spoken.filter((link) => link.link === 'paused').length;
  const value = `${reporting} of ${spoken.length} reporting${updating > 0 ? ` · ${updating} updating` : ''}`;
  return { status: reporting + updating === spoken.length ? 'ok' : 'failing', value };
}

function gatewayOutcome(gateway: CerberusGatewayState): { status: CerberusResultWire['status']; value: string } {
  if (gateway.address !== null) return { status: 'ok', value: `Listening on ${gateway.address}` };
  if (gateway.listen === null) return { status: null, value: 'CERBERUS_LISTEN is not set' };
  return { status: 'failing', value: gateway.error ?? `Not listening on ${gateway.listen}` };
}

/**
 * Takes and releases the store's write lock, and answers how long that took in whole milliseconds.
 * Throws at once when the lock is held elsewhere (see the header: no five-second wait on the event loop).
 */
function measureWriteLockMs(): number {
  const db = getCerberusConnection();
  const patientWaitMs = db.pragma('busy_timeout', { simple: true }) as number;
  db.pragma('busy_timeout = 0');
  try {
    const startedAt = performance.now();
    db.transaction(() => undefined).immediate();
    return Math.round(performance.now() - startedAt);
  } finally {
    // The connection is shared: whoever writes next gets the wait the store was opened with.
    db.pragma(`busy_timeout = ${patientWaitMs}`);
  }
}

function tick(getGateway: () => CerberusGatewayState): void {
  try {
    // The measuring comes first and `at` after it, so the three results are stamped alike and the
    // sentence on screen is about the moment they say.
    const writeLockMs = measureWriteLockMs();
    const at = Date.now();
    const prevAt = lastIngestedTick?.at ?? null;

    const results = [
      resultOf(WARDENS_FRESH_KEY, at, prevAt, wardensFreshOutcome(at)),
      resultOf(GATEWAY_LISTENING_KEY, at, prevAt, gatewayOutcome(getGateway())),
      resultOf(STORE_WRITE_KEY, at, prevAt, { status: 'ok', value: `Took the write lock in ${writeLockMs} ms`, tookMs: writeLockMs }),
    ];
    ingest.ingestResults(HUB_NODE_ID, null, results);
    lastIngestedTick = { at, results };
  } catch (error) {
    console.error(`[Cerberus] a self-check tick stored nothing: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Starts the self-checks: the first tick now, then one every 30 s. `getGateway` is read at each tick,
 * and the module arms the duties only after the gateway has tried to bind, so the first tick already
 * reads the real state. A second call while running does nothing.
 */
export function startSelfChecks(getGateway: () => CerberusGatewayState): void {
  if (tickTimer) return;
  // The first tick is the start of the chain: it leaves a row even if this process is gone in seconds.
  tick(getGateway);
  tickTimer = setInterval(() => tick(getGateway), TICK_INTERVAL_MS);
  // A convenience of a running server, never a reason for a process to stay up.
  tickTimer.unref();
}

/**
 * Stops the ticks, after leaving the last tick in the store as a keepalive (see the header). It
 * stores nothing when that tick was itself stored, and nothing when no tick has run. The chain is
 * forgotten, so a start after a stop begins a new one, as a boot does.
 */
export function stopSelfChecks(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (lastIngestedTick) {
    try {
      ingest.ingestResults(HUB_NODE_ID, null, lastIngestedTick.results, true);
    } catch (error) {
      console.error(`[Cerberus] could not leave the last self-check in the store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  lastIngestedTick = null;
}
