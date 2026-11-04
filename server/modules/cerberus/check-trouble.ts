import { cerberusDiagnosesDb, cerberusResultsDb, type CerberusDiagnosisRow } from '@/modules/database/index.js';

import { wardenLinks } from './warden-links.js';

/**
 * A red check's TROUBLE, and the one bound it is read by.
 *
 * A trouble runs from the check's LAST OK until it is ok again. Everything Cerberus says or does once
 * about a red — diagnose it on its own, tell the phone what the diagnosis found — is once per trouble,
 * and a trouble ends only in a RECOVERY. The operator's "there's no reason to check unless it's been
 * fixed and cleared" (2026-11-04) is that, and it is not a change of word: a check that goes failing →
 * warn → failing, or failing → denied, moves its `since` (the moment its status last changed) without
 * ever clearing, and a bound on `since` would read the same trouble a second time. The last ok does not
 * move until the check is ok.
 *
 * A check that was NEVER ok has no last ok, and its trouble counts from its first row: `since` of 0
 * reaches every diagnosis the store holds for it.
 *
 * "Last ok" is the last ok that SURVIVES THE PRUNE. A keep-alive repeats an ok and counts, and the daily
 * prune (`store-prune.service.ts`, `KEEPALIVE_RETENTION_MS`) deletes keep-alives older than 90 days, so a
 * check red for more than 90 days has lost the ok keep-alives that sat just before its red: its last ok
 * then falls back to its last ok CHANGE row, possibly months earlier, and a diagnosis started while it was
 * green reads as inside the trouble. The store began on 2026-10-06, so no red is older than that before
 * 2027-01-04.
 *
 * The bound has one gap at any age. The last ok is the newest ok row, a keep-alive every 5 minutes, and the red
 * begins at the first row after it. A Diagnose pressed on a still-green check in the up-to-5 minutes between that
 * keep-alive and the row that turns it red starts after the last ok, so it reads as inside the trouble: the
 * trigger drops the red as already read, and the page names a diagnosis that read a green check. The cure is a
 * bound by the red's own start (the first row after the last ok), which needs a statement the results repository
 * does not hold yet.
 *
 * It is ONE bound for the trigger (`auto-diagnosis-plan.ts`, which asks whether the trouble already has
 * a diagnosis) and the push (`red-watch-diagnosis.ts`, which names the diagnosis the phone is told), so
 * the phone names the diagnosis the trigger counted. The Needs-you card keeps its own bound
 * (`read-model/diagnosis-views.ts`, the check's `since`), and the two differ only after such a change of
 * word: the card then shows no diagnosis for a trouble that has one.
 *
 * Two clocks meet here. A result's `at` is the WARDEN's clock; a diagnosis's `started_at` is center's.
 * `lastOkAt` adds the node's clock offset (`wardenLinks.clockOffsetMs`, 0 for a node never heard) so
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
 * The moment the check was last ok, on center's clock — a keep-alive counts, it repeats an `ok` — or
 * `null` when it has never been ok.
 */
export function lastOkAt(node: string, key: string): number | null {
  const warden = cerberusResultsDb.lastOkAt(node, key);
  return warden === null ? null : warden + wardenLinks.clockOffsetMs(node);
}

/**
 * Every diagnosis of the check started since its last ok, whoever asked and however it ended, newest
 * first. That is the check's trouble so far; empty when the trouble has not been diagnosed.
 */
export function troubleDiagnoses(node: string, key: string): CerberusDiagnosisRow[] {
  return cerberusDiagnosesDb.startedSince({ since: lastOkAt(node, key) ?? 0, node, check: key }, WHOLE_TROUBLE);
}
