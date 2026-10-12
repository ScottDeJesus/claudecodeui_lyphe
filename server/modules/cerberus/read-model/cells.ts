import type { CerberusCell, CerberusStatus } from '@/shared/cerberus-types.js';

import { windowStatus } from './freshness.js';
import { layerWindow, type NodeOverlay } from './overlays.js';
import type { CheckSeries } from './series.js';
import { SEV, worst, type WindowWord } from './status-rules.js';

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

/** One check's word over `[from, end)`, and the moment it held, with the mute and silence of its window's end, and any pause it overlaps, laid over. */
function checkWindow(series: CheckSeries, from: number, end: number, overlay: NodeOverlay): WindowWord {
  const raw = windowStatus(series.rows, from, end, series.staleAfterMs, series.liveLastAt);
  return layerWindow(raw, { from, to: end }, series.mutes, overlay);
}

/**
 * The strip of a SERVICE: each cell is the worst over its active checks' windows, and `worst` names
 * the check that set it — the first check to reach the cell's status — whenever that status is worse
 * than passing (nothing "set" a passing or not-enabled cell). A cell whose minute overlaps a restart
 * reads `paused` for every check that was below warn in it (`layerWindow`). A service whose every
 * check is not enabled draws `not_enabled`, and one with no checks draws `unknown`: folds start from
 * `not_enabled`, the one word that never outranks another.
 *
 * `at` is the moment the cell's word held, taken from the same check as `worst` — the first to reach
 * the word, passing words included, which `worst` leaves null. A cell no check raised (every check
 * not enabled, or none at all) reads at its first moment.
 *
 * Consumers: `overview.ts`, one strip per service.
 */
export function buildServiceCells(
  checks: CheckSeries[],
  overlay: NodeOverlay,
  now: number,
  count: number
): CerberusCell[] {
  return cellSlots(now, count).map(({ from, to }) => {
    if (checks.length === 0) return { from, to, status: 'unknown' as const, worst: null, at: from };

    const end = Math.min(to, now);
    let status: CerberusStatus = 'not_enabled';
    let setBy: string | null = null;
    let at = from;
    for (const series of checks) {
      // `worst` keeps its first argument on a tie, so the first check to reach a word keeps the cell.
      const word = checkWindow(series, from, end, overlay);
      const folded = worst(status, word.status);
      if (folded !== status) {
        status = folded;
        setBy = series.check.key;
        at = word.at;
      }
    }
    return { from, to, status, worst: SEV[status] > SEV.ok ? setBy : null, at };
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
  overlay: NodeOverlay,
  now: number,
  count: number
): CerberusCell[] {
  return buildServiceCells([series], overlay, now, count).map((cell) => ({ ...cell, worst: null }));
}
