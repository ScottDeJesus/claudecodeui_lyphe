import {
  cerberusMutesDb,
  cerberusResultsDb,
  type CerberusActiveCheckRow,
  type CerberusMuteRow,
  type CerberusStoredResultRow,
} from '@/modules/database/index.js';
import type { CerberusReadInputs } from '@/shared/cerberus-types.js';

/**
 * What a check with no staleness of its own and no probe to derive one from is given: five minutes,
 * the keep-alive interval, so a check nobody can say how often reports is judged by the longest a
 * quiet one is ever left unwritten. It only ever applies to a check whose probe row is gone; a probe
 * or a stored `stale_after` always wins (`STALE_AFTER_SQL` in the definitions repository is the one
 * home of the rule).
 */
const FALLBACK_STALE_AFTER_S = 300;

/**
 * One check's evidence over a stretch of time: its stored rows (oldest first, with the last row
 * before the stretch and the first after it), the mutes that were in effect somewhere in it, how long
 * a result stays fresh, and the latest result ingest has received. Everything `windowStatus` and the
 * overlays need, loaded once so a strip of thirty or sixty cells reads the store once.
 */
export type CheckSeries = {
  check: CerberusActiveCheckRow;
  staleAfterMs: number;
  liveLastAt: number | null;
  rows: CerberusStoredResultRow[];
  mutes: CerberusMuteRow[];
};

/**
 * A check's staleness in seconds — the resolved `stale_after_s` of the active-checks index — or the
 * fallback when neither an override nor a probe gives one.
 *
 * Consumers: `check-views.ts` (the view's `staleAfter`, in seconds), `lookup.ts` (the same rule
 * in milliseconds, for a check whose series it does not load) and `../boot-vouch.ts` (how long a
 * check may have been quiet before a boot and still be vouched for).
 */
export function staleAfterSecondsOf(check: CerberusActiveCheckRow): number {
  return check.stale_after_s ?? FALLBACK_STALE_AFTER_S;
}

/**
 * Loads the series of `checks` (all of ONE node) over `[from, to]`, in the order given: one
 * `rowsInWindow` statement for the node's keys, and one `overlapping` per check for the mutes (the
 * moments read are up to and including `to`, so the mute window runs to `to + 1`). A check with no
 * rows gets an empty series, which every reader answers as "no result".
 *
 * Consumers: `overview.ts` (a strip of 30 per node) and `check-detail.ts` (a strip of 60 for a
 * check and its siblings).
 */
export function loadSeries(
  node: string,
  checks: CerberusActiveCheckRow[],
  from: number,
  to: number,
  inputs: CerberusReadInputs
): CheckSeries[] {
  const rowsByKey = new Map<string, CerberusStoredResultRow[]>();
  for (const row of cerberusResultsDb.rowsInWindow(node, checks.map((check) => check.key), from, to)) {
    const rows = rowsByKey.get(row.check_key);
    if (rows) rows.push(row);
    else rowsByKey.set(row.check_key, [row]);
  }

  return checks.map((check) => ({
    check,
    staleAfterMs: staleAfterSecondsOf(check) * 1000,
    liveLastAt: inputs.memory(node, check.key).lastReceivedAt,
    rows: rowsByKey.get(check.key) ?? [],
    mutes: cerberusMutesDb.overlapping(node, check.key, from, to + 1),
  }));
}
