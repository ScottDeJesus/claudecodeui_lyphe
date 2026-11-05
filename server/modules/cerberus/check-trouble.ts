import { cerberusDiagnosesDb, cerberusResultsDb, type CerberusDiagnosisRow } from '@/modules/database/index.js';

import { wardenLinks } from './warden-links.js';

/**
 * A red check's TROUBLE, and the one bound it is read by.
 *
 * A trouble runs from the RED'S OWN START until the check is ok again: the first result row stored after the
 * check's last ok, which is by construction the first row that was not ok. Everything Cerberus says or does once
 * about a red — diagnose it on its own, tell the phone what the diagnosis found — is once per trouble, and a
 * trouble ends only in a RECOVERY. The operator's "there's no reason to check unless it's been fixed and
 * cleared" (2026-11-04) is that, and it is not a change of word: a check that goes failing → warn → failing, or
 * failing → denied, moves its `since` (the moment its status last changed) without ever clearing, and a bound on
 * `since` would read the same trouble a second time. The red's start does not move until the check is ok again:
 * the last ok stays the newest ok row, and the row after it stays the same row.
 *
 * The start is NOT the last ok itself. The last ok is the newest ok row, a keep-alive every 5 minutes, and the
 * check can stay green for up to 5 minutes after it. A Diagnose pressed in that time reads a green check; a
 * bound by the last ok would count it as inside the trouble, the trigger would drop the red as already read, and
 * the page would name a diagnosis that read a green check.
 *
 * A check that was NEVER ok has no last ok, and its trouble counts from its first row. A check that is ok now has
 * no row after its last ok and so no trouble: `troubleDiagnoses` answers `[]`.
 *
 * The bound survives the daily prune (`store-prune.service.ts`, `KEEPALIVE_RETENTION_MS`) at any age of the red.
 * The prune deletes keep-alives older than 90 days, so for a check red longer than that the ok keep-alives that
 * sat just before its red are gone and its last ok falls back to its last ok `change` row, possibly months
 * earlier; but the row after THAT is still the red's own `change` row, which the prune never deletes, so the
 * start is the same row.
 *
 * It is ONE bound for the trigger (`auto-diagnosis-plan.ts`, which asks whether the trouble already has
 * a diagnosis) and the push (`red-watch-diagnosis.ts`, which names the diagnosis the phone is told), so
 * the phone names the diagnosis the trigger counted. The Needs-you card keeps its own bound
 * (`read-model/diagnosis-views.ts`, the check's `since`), and the two differ only after such a change of
 * word: the card then shows no diagnosis for a trouble that has one.
 *
 * Two clocks meet here. A result's `at` is the WARDEN's clock; a diagnosis's `started_at` is center's.
 * `redStartAt` adds the node's clock offset (`wardenLinks.clockOffsetMs`, 0 for a node never heard) so
 * the bound is center's, as `diagnoses` is.
 *
 * Consumers: `auto-diagnosis.service.ts` (`troubleDiagnoses`, handed to the plan) and
 * `red-watch-diagnosis.ts` (`troubleDiagnoses`, for the push).
 */

/**
 * The trouble is read WHOLE, so this is "no limit" (the largest whole number SQLite's LIMIT takes as a 32-bit
 * integer) and not a count of rows. A trouble holds what a person pressed and at most three failed tries of the
 * trigger, but also one row for every restart that cut a diagnosis (`endedByRestart`), and those are unbounded:
 * the dev server restarts on every save. A window of the newest rows would let a restart storm push a `done` row
 * out of sight (the trigger starts the check again, the page goes out without its diagnosis) or a third counted
 * failure (the guard against a loop sees only two).
 */
const WHOLE_TROUBLE = 2_147_483_647;

/**
 * The moment the check's red began, on center's clock: the first row stored after its last ok (a keep-alive
 * counts as an ok), or its first row when it was never ok. `null` when no row follows the last ok — the check
 * is ok now and has no trouble.
 */
function redStartAt(node: string, key: string): number | null {
  const warden = cerberusResultsDb.redStartAt(node, key, cerberusResultsDb.lastOkAt(node, key));
  return warden === null ? null : warden + wardenLinks.clockOffsetMs(node);
}

/**
 * Every diagnosis of the check started since its red began, whoever asked and however it ended, newest
 * first. That is the check's trouble so far; empty when the trouble has not been diagnosed, and when the check
 * has no trouble because it is ok.
 */
export function troubleDiagnoses(node: string, key: string): CerberusDiagnosisRow[] {
  const since = redStartAt(node, key);
  if (since === null) return [];
  return cerberusDiagnosesDb.startedSince({ since, node, check: key }, WHOLE_TROUBLE);
}
