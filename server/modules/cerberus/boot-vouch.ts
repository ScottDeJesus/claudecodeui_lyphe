import { cerberusDefinitionsDb, cerberusNodesDb, type CerberusLatestResultRow } from '@/modules/database/index.js';

import { staleAfterSecondsOf } from './read-model/series.js';

/**
 * THE BOOT VOUCH — what a restarted center may say about a check before that check reports again.
 *
 * The freshness rule (`read-model/freshness.ts`) vouches for a quiet check up to center's memory of
 * the last result it RECEIVED, plus `staleAfter`. That memory is per process: a handover (every save
 * under `server/` is one) or a restart starts it empty, the rule falls back to the check's last
 * STORED row, and a quiet check stores one row per five minutes — so on most checks that row is older
 * than `staleAfter` and the whole board read `unknown` for up to a minute after every handover,
 * though nothing had stopped reporting (measured 2026-10-06: 67 of 81 checks, 24–40 s).
 *
 * The cure gives each check that WAS reporting a vouching moment — the boot itself — which lapses
 * `staleAfter` later, exactly as a result received at the boot would. The first real result after the
 * boot replaces it. Two pieces of stored evidence decide who gets one, so a check that had already
 * gone quiet is never revived:
 *   1. its node was heard within `HEARD_BEFORE_BOOT_MS` before the boot (`nodes.last_heartbeat_at`) —
 *      a center that was down for an hour has no business vouching for anything; and
 *   2. its newest stored row is no older, at that last heard time, than a reporting check could leave:
 *      ingest stores a keep-alive once five quiet minutes have passed, so a reporting check's newest
 *      row is at most `keepaliveAfterMs` plus one cadence behind (`staleAfter` is more than that).
 *
 * The bound that remains: a probe that died in the five minutes before a handover reads fresh for at
 * most its own `staleAfter` after it — then `stale`, as it would have. Nothing is vouched forever.
 *
 * Consumers: `ingest.service.ts` (`seedMemory`, once per boot).
 */

/**
 * How long before a boot a node may last have been heard and still count as "reporting right up to
 * the restart". The store writes `last_heartbeat_at` at most once a minute (a heartbeat comes every
 * 15 s), so a node heard to the last second still reads up to about 75 s old; the rest is the restart.
 */
const HEARD_BEFORE_BOOT_MS = 120_000;

/** One check center vouches for at boot: `at` is the moment it was last (virtually) received. */
type BootVouch = { node: string; key: string; at: number };

/**
 * The checks to vouch for at `now`, among the stored `latest` rows (one per check).
 * `keepaliveAfterMs` is ingest's keep-alive interval, passed in because ingest owns it.
 *
 * Consumers: `ingest.service.ts` (`seedMemory`), which writes each answer into its last-received memory.
 */
export function checksReportingAtBoot(latest: CerberusLatestResultRow[], now: number, keepaliveAfterMs: number): BootVouch[] {
  const vouches: BootVouch[] = [];
  for (const node of cerberusNodesDb.list()) {
    const heardAt = node.last_heartbeat_at;
    if (heardAt === null || now - heardAt > HEARD_BEFORE_BOOT_MS) continue;

    // Only checks still defined are read, so only they need a vouch (a retired check's rows are history).
    const staleAfterMs = new Map(cerberusDefinitionsDb.activeChecks(node.id).map((check) => [check.key, staleAfterSecondsOf(check) * 1000]));
    for (const row of latest) {
      if (row.node !== node.id) continue;
      const staleAfter = staleAfterMs.get(row.check_key);
      if (staleAfter === undefined) continue;
      if (heardAt - row.at > keepaliveAfterMs + staleAfter) continue; // it had stopped reporting before the restart
      vouches.push({ node: node.id, key: row.check_key, at: Math.max(now, row.at) });
    }
  }
  return vouches;
}
