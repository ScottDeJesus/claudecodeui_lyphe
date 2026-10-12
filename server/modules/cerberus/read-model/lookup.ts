import { cerberusMutesDb, cerberusResultsDb, type CerberusActiveCheckRow } from '@/modules/database/index.js';
import type { CerberusLookup, CerberusReadInputs, CerberusStatus } from '@/shared/cerberus-types.js';

import { findActiveCheck } from './check-views.js';
import { statusAt } from './freshness.js';
import { nodeOverlayOf } from './node-links.js';
import { layerCurrent, pausedAt, toMuteView } from './overlays.js';
import { staleAfterSecondsOf } from './series.js';
import { shownRow } from './status-rules.js';

/**
 * "Look up a moment": what one check was at the asked moment, honestly.
 *
 * The verdict is `statusAt`'s, so a check that stored nothing at the moment because nothing changed
 * still answers `result` — it was reporting, which the store's `prev_at` and ingest's last-received
 * time prove — and a moment with no result inside `staleAfter` is `stale`, never the old status.
 * `status` is the row's word with the mute that was active THEN laid over it, `mute` names that mute
 * (a mute active then is named whatever the status), and `resultAt` is the `at` of the result the
 * answer rests on: the stored row `statusAt` read, or — for a moment at or after ingest's newest
 * received result, when that is newer than the row — that result, whose value the store keeps only
 * in a keep-alive (`memory().newest`; empty after a boot, when the stored row answers until the
 * check's next result).
 *
 * What each verdict puts in `status`: `result` the word; `stale` `unknown` (an answer exists — "no
 * result"); `too_early` and `future` null (there is nothing to say). `value` is the sentence of the
 * result `resultAt` names, for `result` only: a stale moment shows no old words, though `resultAt`
 * still says which row went stale. A moment on or after a current silence's start is `stale` too,
 * for the same reason the fleet's cells there read `unknown`: nothing from that node is being heard.
 */

/**
 * The lookup of an already-found check at `at`. One statement for the three rows around the moment
 * (the row at or before it, the first after) and one for the mute.
 *
 * Consumers: this file's `lookupAt` and `check-detail.ts`, which already holds the check's row.
 */
export function lookupOfCheck(check: CerberusActiveCheckRow, at: number, inputs: CerberusReadInputs): CerberusLookup {
  const { node, key } = check;
  const { now } = inputs;
  const answer = (fields: Partial<CerberusLookup> & Pick<CerberusLookup, 'verdict' | 'status'>): CerberusLookup => ({
    node,
    check: key,
    at,
    value: null,
    resultAt: null,
    mute: null,
    ...fields,
  });

  // The rows are never consulted for a moment that has not happened.
  if (at > now) return answer({ verdict: 'future', status: null });

  const rows = cerberusResultsDb.rowsInWindow(node, [key], at, at);
  const staleAfterMs = staleAfterSecondsOf(check) * 1000;
  const { lastReceivedAt: live, newest } = inputs.memory(node, key);
  const { verdict, row } = statusAt(rows, at, staleAfterMs, live, now);

  const muteRow = cerberusMutesDb.activeAt(node, key, at);
  const mute = muteRow ? toMuteView(muteRow) : null;

  const overlay = nodeOverlayOf(node, inputs, at);
  const silent = overlay.silentSince !== null && at >= overlay.silentSince;

  if (verdict === 'too_early') return answer({ verdict, status: null, mute });
  if (verdict === 'stale' || silent || row === null) {
    const word: CerberusStatus = pausedAt(overlay.pauses, at) ? 'paused' : 'unknown';
    return answer({ verdict: 'stale', status: word, resultAt: row?.at ?? null, mute });
  }
  const status: CerberusStatus = layerCurrent(shownRow(row), at, muteRow ? [muteRow] : [], overlay);
  // The sheet reads "From the result recorded <resultAt>", so a newer unstored result answers whole.
  const heard = newest && at >= newest.at && newest.at > row.at ? newest : row;
  return answer({ verdict, status, value: heard.value, resultAt: heard.at, mute });
}

/**
 * What the named check was at moment `at`. A 404 `AppError` for a check that is not active.
 *
 * Consumers: the lookup route (`GET /lookup?node&key&at`), through the module's services.
 */
export function lookupAt(node: string, key: string, at: number, inputs: CerberusReadInputs): CerberusLookup {
  return lookupOfCheck(findActiveCheck(node, key), at, inputs);
}
