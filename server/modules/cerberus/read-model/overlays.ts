import type { CerberusMuteRow } from '@/modules/database/index.js';
import type { CerberusMute, CerberusStatus } from '@/shared/cerberus-types.js';

import { needsAttention } from './status-rules.js';

/**
 * What is laid over a status after the rows have said their piece. Two overlays, both worked out
 * when the screen reads and neither ever stored:
 *
 *   - A MUTE: an unexpired, unlifted mute in effect at a window's end turns warn, failing and
 *     denied into `muted`. The check keeps running and recording; only the word changes.
 *   - A SILENCE: a node whose warden has not been heard for 90 s is silent, and a current silence
 *     turns every window that ends after `silentSince`, and the current status, into `unknown` —
 *     nothing is known about a node nobody is hearing, and its last words are not repeated as if
 *     they were fresh. A silence that has ended is not remembered: those windows are judged by
 *     staleness alone. The hub is never silent (it passes no `silentSince`).
 *
 * Silence wins over a mute: the mute only ever quiets a problem, and a silent node has none it can
 * vouch for.
 *
 * Consumers: `cells.ts` (every window), `check-views.ts` (the current status) and `lookup.ts` (the
 * mute that was active at an asked moment).
 */

/**
 * The mute in effect at moment `at` among `mutes` — `from_at <= at < until_at` and not lifted by
 * `at` — or `null`. When several overlap, the one that began last (then the lower id), exactly as
 * `cerberusMutesDb.activeAt` answers for one moment, so a strip of many moments can read the mutes
 * it fetched once instead of asking the store per cell.
 *
 * Consumers: `layerOverlays` below, which every strip and status goes through, and `check-views.ts`
 * (the mute covering a check now).
 */
export function muteActiveAt(mutes: CerberusMuteRow[], at: number): CerberusMuteRow | null {
  let found: CerberusMuteRow | null = null;
  for (const mute of mutes) {
    const inEffect =
      mute.from_at <= at && at < mute.until_at && (mute.lifted_at === null || mute.lifted_at > at);
    if (!inEffect) continue;
    if (found === null || mute.from_at > found.from_at || (mute.from_at === found.from_at && mute.id < found.id)) {
      found = mute;
    }
  }
  return found;
}

/**
 * Lays the two overlays over `status` for a window that ends at `windowEnd`: `unknown` when the node
 * has been silent since before the window's end, else `muted` when a mute covers the end and the
 * status is one that needs a person, else `status` unchanged.
 *
 * Consumers: `cells.ts` (`windowEnd` = the cell's end, clipped at now), `check-views.ts`
 * (`windowEnd` = now) and `lookup.ts` (`windowEnd` = the asked moment, over the mute active then).
 */
export function layerOverlays(
  status: CerberusStatus,
  windowEnd: number,
  mutes: CerberusMuteRow[],
  silentSince: number | null
): CerberusStatus {
  if (silentSince !== null && windowEnd > silentSince) return 'unknown';
  if (needsAttention(status) && muteActiveAt(mutes, windowEnd) !== null) return 'muted';
  return status;
}

/**
 * A `mutes` row as the wire carries it: camelCase, with `check_key` and the lift moment renamed.
 *
 * Consumers: `check-views.ts` (a check's current mute) and `lookup.ts` (the mute that covered an
 * asked moment).
 */
export function toMuteView(row: CerberusMuteRow): CerberusMute {
  return {
    id: row.id,
    node: row.node,
    check: row.check_key,
    from: row.from_at,
    until: row.until_at,
    reason: row.reason,
    by: row.by,
    liftedAt: row.lifted_at,
  };
}
