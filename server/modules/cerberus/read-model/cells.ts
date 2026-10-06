import type { CerberusCell, CerberusStatus } from '@/shared/cerberus-types.js';

import { windowStatus } from './freshness.js';
import { layerOverlays } from './overlays.js';
import type { CheckSeries } from './series.js';
import { SEV, worst } from './status-rules.js';

/**
 * The strips of the fleet screen: one-minute cells, newest on the right. Ported from the engine's
 * `cells` (`cerberus-engine.js:90-94`).
 *
 * `count` cells end at the NEXT minute boundary — `(floor(now / 60000) + 1) * 60000` — so the last
 * cell is the minute `now` is inside, and its status is read over `[from, now)`, clipped at `now`
 * because nothing after it has happened. The cell still reports its whole minute as `from`..`to`.
 */
const CELL_MS = 60_000;

/** The `[from, to)` of each of `count` cells, oldest first, ending at the next minute boundary. */
function cellSlots(now: number, count: number): { from: number; to: number }[] {
  const end = (Math.floor(now / CELL_MS) + 1) * CELL_MS;
  const slots: { from: number; to: number }[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const to = end - back * CELL_MS;
    slots.push({ from: to - CELL_MS, to });
  }
  return slots;
}

/**
 * Where a strip of `count` cells begins: the `from` of its first cell. A caller loads its series from
 * here, so the rows cover every cell.
 *
 * Consumers: `overview.ts` (30 cells) and `check-detail.ts` (60 cells).
 */
export function stripStart(now: number, count: number): number {
  return (Math.floor(now / CELL_MS) + 1) * CELL_MS - count * CELL_MS;
}

/** One check's word over `[from, end)` with the mute and silence of its window's end laid over. */
function checkWindow(series: CheckSeries, from: number, end: number, silentSince: number | null): CerberusStatus {
  const raw = windowStatus(series.rows, from, end, series.staleAfterMs, series.liveLastAt);
  return layerOverlays(raw, end, series.mutes, silentSince);
}

/**
 * The strip of a SERVICE: each cell is the worst over its active checks' windows, and `worst` names
 * the check that set it — the first check to reach the cell's status — whenever that status is worse
 * than passing (nothing "set" a passing or not-enabled cell). A service whose every check is not
 * enabled draws `not_enabled`, and one with no checks draws `unknown`: folds start from
 * `not_enabled`, the one word that never outranks another.
 *
 * Consumers: `overview.ts`, one strip per service.
 */
export function buildServiceCells(
  checks: CheckSeries[],
  silentSince: number | null,
  now: number,
  count: number
): CerberusCell[] {
  return cellSlots(now, count).map(({ from, to }) => {
    if (checks.length === 0) return { from, to, status: 'unknown' as const, worst: null };

    const end = Math.min(to, now);
    let status: CerberusStatus = 'not_enabled';
    let setBy: string | null = null;
    for (const series of checks) {
      // `worst` keeps its first argument on a tie, so the first check to reach a word keeps the cell.
      const folded = worst(status, checkWindow(series, from, end, silentSince));
      if (folded !== status) {
        status = folded;
        setBy = series.check.key;
      }
    }
    return { from, to, status, worst: SEV[status] > SEV.ok ? setBy : null };
  });
}

/**
 * The strip of ONE check: its own window per cell, so `worst` is null — the check is the only thing
 * that could have set it.
 *
 * Consumers: `check-detail.ts`, a 60-cell strip standing at its `end` (now unless an earlier moment is asked).
 */
export function buildCheckCells(
  series: CheckSeries,
  silentSince: number | null,
  now: number,
  count: number
): CerberusCell[] {
  return buildServiceCells([series], silentSince, now, count).map((cell) => ({ ...cell, worst: null }));
}
