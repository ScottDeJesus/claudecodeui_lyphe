import type { CerberusNeed, CerberusStatus, CerberusStoredStatus } from '@/shared/cerberus-types.js';

/**
 * How bad each word is, the one ranking every worst-of in the read model uses: a window of a check, a
 * service folded from its checks, a cell folded from a service. Ported from the prototype engine's
 * `SEV` (`design/cerberus/cerberus-engine.js:8`) plus `not_enabled`, which sits BELOW `ok` at -1: a
 * feature switched off on the service's side must never outrank a real status, and a service whose
 * every check is not enabled must still read `not_enabled` rather than `ok` — so folds start from
 * `not_enabled`, not from `ok`.
 *
 * `warn`, `failing` and `denied` (3 and up) are the three that need a person; `muted` ranks with
 * `paused` because it is one of them quieted, and `unknown` ranks above `ok` so a window with a gap
 * in it is never read as passing.
 *
 * Consumers: `cells.ts` (a cell keeps the first check to reach its worst word), `freshness.ts` (a
 * window's word and the moment it rose), `overlays.ts`, `activity.ts`, `check-views.ts`,
 * `check-detail.ts`, `lookup.ts` and `overview.ts`. Auto-run reads none of them: it is handed the
 * status moves ingest announces (`ingest.onChange`).
 */
export const SEV: Record<CerberusStatus, number> = {
  not_enabled: -1,
  ok: 0,
  paused: 1,
  muted: 1,
  unknown: 2,
  warn: 3,
  failing: 4,
  denied: 5,
};

/**
 * A window's word and the first moment inside the window at which that word held — the moment a
 * lookup of the same check answers it, when the window holds one (`layerWindow` says when it does
 * not). Handed by `windowStatus` and the overlay layering over it, and carried to the wire as a cell's `at`.
 */
export type WindowWord = { status: CerberusStatus; at: number };

/**
 * The worse of two words by `SEV`. On a tie the FIRST argument wins, which is what lets a fold name
 * the check that set a cell: the first check to reach the worst status keeps it.
 *
 * Consumers: `cells.ts` (a service's cell, and the check that set it) and `overview.ts` (a service's
 * status folded from its checks).
 */
export function worst(a: CerberusStatus, b: CerberusStatus): CerberusStatus {
  return SEV[b] > SEV[a] ? b : a;
}

/**
 * The word a stored status is shown as: itself, or `not_enabled` for the stored NULL (a health
 * document's `muted` — the service has the feature switched off, which is never Cerberus's mute).
 *
 * Consumers: `shownRow` below, which every reading of a stored row goes through; exported as the
 * rule the contract names.
 */
export function shown(stored: CerberusStoredStatus | null): CerberusStatus {
  return stored ?? 'not_enabled';
}

/** The four words a result row may store; anything else in the column is a bad row. */
const STORED_STATUSES: ReadonlySet<string> = new Set<CerberusStoredStatus>(['ok', 'warn', 'failing', 'denied']);

function isStoredStatus(word: string): word is CerberusStoredStatus {
  return STORED_STATUSES.has(word);
}

/**
 * A stored result row's `status` column as the stored vocabulary: one of the four words, or null for
 * a stored NULL ("not enabled") — and null for a word outside the vocabulary too, so a bad row never
 * puts a word on the wire that the contract has no name for (`shownRow` reads such a row as
 * `unknown`, which is where it is seen). The table cannot constrain the column, and ingest refuses
 * anything outside the vocabulary before a row exists, so this only ever catches a row written
 * some other way.
 *
 * Consumers: `check-views.ts` (a view's `stored`) and `check-detail.ts` (a recent row's status).
 */
export function storedStatusOf(row: { status: string | null }): CerberusStoredStatus | null {
  return row.status !== null && isStoredStatus(row.status) ? row.status : null;
}

/**
 * `shown` for a stored result row: the row's status, `not_enabled` for its stored NULL, and
 * `unknown` for a word outside the vocabulary — a bad row is loud on the screen (a check that never
 * reads as passing and counts as unknown) instead of invisible to every count, which an unrecognised
 * word would be, since it has no rank in `SEV`.
 *
 * Consumers: `freshness.ts`, `check-views.ts`, `lookup.ts` and `activity.ts`, which each read a row's
 * word.
 */
export function shownRow(row: { status: string | null }): CerberusStatus {
  if (row.status === null) return shown(null);
  return isStoredStatus(row.status) ? shown(row.status) : 'unknown';
}

/**
 * A status word read off a column that holds one — `results.prev_status`, which is a stored word or
 * `not_enabled` — and `unknown` for anything else, for the same reason `shownRow` does it.
 *
 * Consumers: `activity.ts` (the `from` side of a transition).
 */
export function statusOf(word: string | null): CerberusStatus {
  return word !== null && Object.hasOwn(SEV, word) ? (word as CerberusStatus) : 'unknown';
}

/**
 * Whether a word is one that needs a person: `warn`, `failing` or `denied`. A muted check, an
 * unknown one and a not-enabled one never do — "Needs you" is about a problem nobody has quieted.
 *
 * Consumers: `overlays.ts` (what a mute may turn into `muted`) and `overview.ts` (the counts and
 * "Needs you").
 */
export function needsAttention(status: CerberusStatus): boolean {
  return SEV[status] >= SEV.warn;
}

/**
 * The order "Needs you" lists its checks in: worst first by `SEV` (denied, then failing, then warn),
 * so the card to act on first is the first one read. Within one word, the oldest `since` first, a
 * check whose beginning ingest does not know after the ones it does; then key, then node, so the
 * order is stable from one read to the next.
 *
 * Consumers: `overview.ts` (`needsYou`). It lives here, beside `SEV`, pure, so the browser gate
 * `.verify/cerberus-needs-you-severity.mjs` loads this very function to order the stand-in `needsYou`
 * it serves: a stand-in answer never passes through the server.
 */
export function needsYouOrder(a: CerberusNeed, b: CerberusNeed): number {
  const bySeverity = SEV[b.check.status] - SEV[a.check.status];
  if (bySeverity !== 0) return bySeverity;
  const sinceA = a.check.since ?? Number.POSITIVE_INFINITY;
  const sinceB = b.check.since ?? Number.POSITIVE_INFINITY;
  if (sinceA !== sinceB) return sinceA < sinceB ? -1 : 1;
  if (a.check.key !== b.check.key) return a.check.key < b.check.key ? -1 : 1;
  return a.check.node < b.check.node ? -1 : a.check.node > b.check.node ? 1 : 0;
}
