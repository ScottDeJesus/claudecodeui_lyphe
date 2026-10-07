import type { CerberusStoredResultRow } from '@/modules/database/index.js';
import type { CerberusLookup, CerberusStatus } from '@/shared/cerberus-types.js';

import { SEV, shownRow, type WindowWord } from './status-rules.js';

/**
 * THE HONEST RULE — when a stored row still speaks for a moment — written once, over rows alone.
 *
 * The store keeps a CHANGE and, every five minutes, a KEEP-ALIVE; a check that reports every 30 s
 * with nothing new stores almost nothing. So a row's own age says nothing about whether the check
 * was still reporting. What does is CONTINUITY, which the store's two columns make readable:
 *
 *   - between two stored rows, `r` and the next `n`, the check was reporting until `n.prev_at` (the
 *     reporter's own previous `at`, which it stamps on every result, stored or not), so a moment `x`
 *     is fresh while `x <= (n.prev_at ?? r.at) + staleAfter`. A null `prev_at` means the reporter
 *     had no previous result — a lapse ended at `n` — so only `r.at` itself vouches for the stretch;
 *   - past the last stored row there is no `n`, and the vouching moment is center's own memory of
 *     the latest result it RECEIVED (`liveLastAt`, ingest's in-memory last-received time): `x` is
 *     fresh while `x <= (liveLastAt ?? r.at) + staleAfter`. A boot empties that memory, so ingest
 *     seeds it with the boot's own moment for each check that was reporting just before it
 *     (`boot-vouch.ts`); a check it did not seed has `liveLastAt` null until a result of it arrives.
 *
 * A moment that is not fresh is "no result", never the old status: a stale moment is never passing.
 *
 * Every function here takes the rows of ONE check, oldest first — what `rowsInWindow` returns for a
 * key, which includes the last row before the asked range and the first after it. `staleAfterMs` is
 * milliseconds (`stale_after_s` × 1000). The rows must hold the neighbours of every moment asked
 * about: a row missing from the middle would make a healthy stretch read as a lapse.
 *
 * Consumers: `cells.ts` (a window per cell), `check-views.ts` (a check's current status) and
 * `lookup.ts` (the verdict of "look up a moment"). The `fixes` plan's auto-run reads the same rule
 * through the overview, not by calling this.
 */

/** What `statusAt` answers: the verdict, and the stored row it read (null when it read none). */
type StatusAtAnswer = { verdict: CerberusLookup['verdict']; row: CerberusStoredResultRow | null };

/** Index of the last row with `at <= x`, or -1 when every row is later (or there are none). */
function lastIndexAtOrBefore(rows: CerberusStoredResultRow[], x: number): number {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].at <= x) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The last moment row `index` still vouches for: up to the next row's `prev_at` (or the row's own
 * `at` when the next row has none), and past the last row up to center's last-received time — all
 * plus `staleAfterMs`. A moment later than this and before the next row is a lapse.
 */
function freshUntil(
  rows: CerberusStoredResultRow[],
  index: number,
  staleAfterMs: number,
  liveLastAt: number | null
): number {
  const next = rows[index + 1];
  const lastHeard = next ? (next.prev_at ?? rows[index].at) : (liveLastAt ?? rows[index].at);
  return lastHeard + staleAfterMs;
}

/** `statusAt` without the clock: `result`, `stale` or `too_early`, and the row it stood on. */
function locate(
  rows: CerberusStoredResultRow[],
  x: number,
  staleAfterMs: number,
  liveLastAt: number | null
): StatusAtAnswer {
  const index = lastIndexAtOrBefore(rows, x);
  if (index < 0) return { verdict: 'too_early', row: null };
  const verdict = x <= freshUntil(rows, index, staleAfterMs, liveLastAt) ? 'result' : 'stale';
  return { verdict, row: rows[index] };
}

/** The word a check showed at moment `x`: its row's status while fresh, `unknown` otherwise. */
function wordAt(
  rows: CerberusStoredResultRow[],
  x: number,
  staleAfterMs: number,
  liveLastAt: number | null
): CerberusStatus {
  const { verdict, row } = locate(rows, x, staleAfterMs, liveLastAt);
  return verdict === 'result' && row ? shownRow(row) : 'unknown';
}

/**
 * What a check was at moment `x`, and the stored row that answer rests on.
 *
 * `r` is the last row at or before `x`, `n` the first after it. The verdicts: `future` when `x` is
 * after `now` (nothing has happened yet, the rows are not consulted); `too_early` when no row is at
 * or before `x`; `stale` when `x` is past what `r` and its neighbour vouch for (see the header); `result`
 * otherwise — and a `result` verdict needs no row stored AT `x`, which is the whole point. `row` is
 * `r` for `result` and `stale`, null for the other two. `now` is a parameter, not a call to the clock,
 * so the same function answers "now" and "a minute ago" from one set of inputs.
 *
 * Consumers: `check-views.ts` (now) and `lookup.ts` (an asked moment).
 */
export function statusAt(
  rows: CerberusStoredResultRow[],
  x: number,
  staleAfterMs: number,
  liveLastAt: number | null,
  now: number
): StatusAtAnswer {
  if (x > now) return { verdict: 'future', row: null };
  return locate(rows, x, staleAfterMs, liveLastAt);
}

/**
 * The first moment of the moments `a..last` that falls in a lapse, or null when none does. A lapse is
 * the stretch of moments after a row's vouching ends and before the next row: `(freshUntil, next.at)`,
 * and after the last row, `(freshUntil, now)` — which a window ending at or before `now` reaches the
 * end of by construction, so the open end is simply unbounded here. A lookup of the returned moment
 * answers `stale`.
 */
function firstLapseMoment(
  rows: CerberusStoredResultRow[],
  a: number,
  last: number,
  staleAfterMs: number,
  liveLastAt: number | null
): number | null {
  for (let index = 0; index < rows.length; index += 1) {
    const lapseFirst = freshUntil(rows, index, staleAfterMs, liveLastAt) + 1;
    const next = rows[index + 1];
    const lapseLast = next ? next.at - 1 : Number.POSITIVE_INFINITY;
    const first = Math.max(a, lapseFirst);
    if (first <= Math.min(last, lapseLast)) return first;
  }
  return null;
}

/**
 * The worst word a check showed over the window `[a, b)`, and the first moment it showed it. The
 * word is the worst of
 *   1. its status at `a` (`unknown` when `a` is not fresh, or before the first row),
 *   2. every stored row strictly inside `(a, b)`,
 *   3. `unknown`, when any lapse overlaps the window, and
 *   4. its status at `b - 1`, the window's last moment.
 * Ported from the engine's `windowStatus` (`cerberus-engine.js:84`), with its edge cases kept: a
 * window that opens before the check's first row is `unknown`, and `not_enabled` never outranks a
 * real status (it is `SEV` -1). Mute and silence are NOT laid here; `overlays.ts` does that, since
 * they belong to the window's end and to the node and not to the rows.
 *
 * `at` is where the word was raised, as that part of the list names it: `a` for 1 and 4, a row's own
 * `at` for 2, the first moment of the first lapse for 3. When several parts say the same word the
 * earliest moment keeps it, so `at` is the first moment the word held and never the last second of a
 * window whose word came and went. Each such moment is one a lookup answers with that word.
 *
 * The window must end at or before `now` — a caller clips its last cell at `now`, as the engine's
 * `cells` does. A window of no width (`b <= a`, which the clipped last cell is when `now` is exactly
 * a minute boundary) reads as the single moment `a`.
 *
 * Consumers: `cells.ts`, once per check per cell.
 */
export function windowStatus(
  rows: CerberusStoredResultRow[],
  a: number,
  b: number,
  staleAfterMs: number,
  liveLastAt: number | null
): WindowWord {
  const last = Math.max(b - 1, a);

  let word: WindowWord = { status: wordAt(rows, a, staleAfterMs, liveLastAt), at: a };
  const reach = (status: WindowWord['status'], at: number) => {
    const rise = SEV[status] - SEV[word.status];
    if (rise > 0 || (rise === 0 && at < word.at)) word = { status, at };
  };
  for (const row of rows) {
    if (row.at > a && row.at < b) reach(shownRow(row), row.at);
  }
  const lapse = firstLapseMoment(rows, a, last, staleAfterMs, liveLastAt);
  if (lapse !== null) reach('unknown', lapse);
  reach(wordAt(rows, last, staleAfterMs, liveLastAt), last);
  return word;
}
