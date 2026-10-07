import { cerberusDefinitionsDb, cerberusResultsDb } from '@/modules/database/index.js';
import type {
  CerberusCheckDetail,
  CerberusCheckIndexEntry,
  CerberusReadInputs,
  CerberusResultRow,
} from '@/shared/cerberus-types.js';

import { buildCheckCells, stripStart } from './cells.js';
import { fixesOfCheck } from './catalog-views.js';
import { buildCheckView, findActiveCheck } from './check-views.js';
import { lookupOfCheck } from './lookup.js';
import { silentSinceOf } from './node-links.js';
import { sheetRunOf } from './run-views.js';
import { loadSeries } from './series.js';
import { storedStatusOf } from './status-rules.js';

/** How many one-minute cells a check's own strip draws, ending at the minute boundary after its `end`. */
const DETAIL_CELLS = 60;

/** How far back a check's `recent` list reaches from the strip's `end`: the change rows of the three hours before it. */
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * The most change rows `recent` carries. A flapping check can store a row a second; the screen
 * lists the newest of them, and the lookup and the strip are what answer for the rest.
 */
const RECENT_LIMIT = 100;

/**
 * Everything the check's sheet opens with: the check as it reads now, its siblings in the same
 * service (the service's other active checks), a strip of 60 one-minute cells, the change rows of
 * the 3 h before the strip's end (`recent`, newest first) and the lookup at `lookupAt`. A 404
 * `AppError` when the check is not an active one.
 *
 * `end` is the moment the strip and `recent` stand at, and it defaults to now: the cells are the 60
 * one-minute windows ending at the minute boundary after `end` (the last one read over `[from, end)`),
 * and `recent` is the change rows in `[end - 3 h, end]`. A moment after now is clamped to now — nothing
 * has happened past it. `lookupAt` defaults to `end`, so a read that only moves `end` is a read of
 * ONE moment. The check and its siblings are always as they read NOW; only the strip, `recent` and
 * the lookup travel with `end`.
 *
 * The check and its siblings come from one `rowsInWindow` statement, so they are drawn from the same
 * moment's evidence; when `end` is earlier than now, the strip's own rows are one more statement,
 * loaded over the strip's own window, because the current reading does not hold them.
 *
 * Consumers: the check-detail route (`GET /checks/:node/:service/:check?lookup=<ms>&end=<ms>`),
 * through the module's services.
 */
export function checkDetail(
  node: string,
  key: string,
  { lookupAt, end }: { lookupAt?: number | null; end?: number | null },
  inputs: CerberusReadInputs
): CerberusCheckDetail {
  const { now } = inputs;
  const stripEnd = Math.min(end ?? now, now);
  const nodeChecks = cerberusDefinitionsDb.activeChecks(node);
  const check = findActiveCheck(node, key, nodeChecks);
  const siblingChecks = nodeChecks.filter(
    (candidate) => candidate.service === check.service && candidate.key !== key
  );

  // The check first, then its siblings: one statement reads the rows of all of them.
  const [ownSeries, ...siblingSeries] = loadSeries(
    node,
    [check, ...siblingChecks],
    stripStart(now, DETAIL_CELLS),
    now,
    inputs
  );
  const silentSince = silentSinceOf(node, inputs);

  // A strip that ends now reads the rows already in hand; one that ends earlier needs its own
  // window's rows.
  const stripSeries =
    stripEnd === now ? ownSeries : loadSeries(node, [check], stripStart(stripEnd, DETAIL_CELLS), stripEnd, inputs)[0];

  const recent: CerberusResultRow[] = cerberusResultsDb
    .recentChanges(node, key, stripEnd - RECENT_WINDOW_MS, RECENT_LIMIT, stripEnd)
    .map((row) => ({ at: row.at, status: storedStatusOf(row), value: row.value }));

  return {
    check: buildCheckView(ownSeries, silentSince, inputs),
    siblings: siblingSeries.map((series) => buildCheckView(series, silentSince, inputs)),
    cells: buildCheckCells(stripSeries, silentSince, stripEnd, DETAIL_CELLS),
    recent,
    lookup: lookupOfCheck(check, lookupAt ?? stripEnd, inputs),
    fixes: fixesOfCheck(node, key),
    // As of now, whatever `end` the strip stands at: the sheet shows the fix beside the reading it produced.
    run: sheetRunOf(node, key, now),
  };
}

/**
 * The index of active checks, one entry per check — just enough for a picker to name a check without
 * reading the whole fleet. Ordered by node, service, key, as the store hands them out.
 *
 * Consumers: the checks route (`GET /checks`), through the module's services.
 */
export function checkIndex(): CerberusCheckIndexEntry[] {
  return cerberusDefinitionsDb.activeChecks().map((check) => ({
    node: check.node,
    key: check.key,
    service: check.service,
    label: check.label,
    serviceLabel: check.service_label,
  }));
}
