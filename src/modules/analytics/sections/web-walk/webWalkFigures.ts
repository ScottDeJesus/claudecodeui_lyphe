import type { WebWalkApp, WebWalkCheck, WebWalkDay, WebWalkScreen } from '@/shared/analytics-types';

// The Web walks section's arithmetic: shares as words, the plotted days, the tables' rows and their order.
// No words of its own and nothing drawn: a sentence leaves here as a key and its values, for the caller's t.

/** A sentence's key and its values. */
export type Worded = { key: string; values: Record<string, string | number> };

/** The window as the answer states it: where the history begins (null before any), today, and the days asked for. */
export type WalkSpan = { firstDay: string | null; today: string; days: number };

/** One plotted day: its launches on the helper and by hand. A day the answer holds no row for is a quiet one, both zero. */
export type LaunchDay = { day: string; walking: number; byHand: number };

/** One app as its table row: its walks, how many of its screens were opened, how often a screen was not reached, and its screens. */
export type AppRow = { app: string; walks: number; opened: number; unreached: number; screens: WebWalkScreen[] };

const UNITS = 'analytics.webWalk.units.';
const PERCENT = 100;
/** Under this percent a share keeps its tenth ("4.5%"); from it on it is whole ("71%"). */
const TENTHS_BELOW_PERCENT = 10;
const TENTHS = 10;
/** The smallest share drawn as a number; a part smaller than it reads "under 0.1%". */
const SMALLEST_DRAWN_PERCENT = 0.1;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1_000;
const ISO_DAY_LENGTH = 10;
const TWO_DIGITS = 2;

/** A share's digits: its tenth when it has one ("0.8", "6.8"), none when it is whole ("2", "71"). */
const UP_TO_A_TENTH = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** A part's share of a whole as words ("71%", "4.5%", "2%", "under 0.1%"), or null when there is no whole to be a share of. */
export function shareWords(part: number, whole: number): Worded | null {
  if (whole <= 0) return null;
  const rate = part / whole;
  const tenths = Math.round(rate * PERCENT * TENTHS) / TENTHS;
  const percent = tenths < TENTHS_BELOW_PERCENT ? tenths : Math.round(rate * PERCENT);
  if (percent === 0 && part > 0) return { key: UNITS + 'shareUnder', values: { value: UP_TO_A_TENTH.format(SMALLEST_DRAWN_PERCENT) } };
  return { key: UNITS + 'share', values: { value: UP_TO_A_TENTH.format(percent) } };
}

/** How many days of the window the history covers, today and its first day both counted; null when it covers them all, or has not begun. */
export function daysCovered(span: WalkSpan): number | null {
  if (span.firstDay === null) return null;
  const covered = dayNumber(span.today) - dayNumber(span.firstDay) + 1;
  return covered < span.days ? covered : null;
}

/** The launches of every plotted day, oldest first, the last one today's. */
export function launchDays(series: WebWalkDay[], span: WalkSpan): LaunchDay[] {
  const rows = new Map(series.map((row) => [row.day, row]));
  return plotDays(span).map((day) => {
    const row = rows.get(day);
    return { day, walking: row?.launches_walking ?? 0, byHand: row?.launches_by_hand ?? 0 };
  });
}

/** The checks, the one that answered false most first; ties by how often they ran, then by name. */
export function rankedChecks(checks: WebWalkCheck[]): WebWalkCheck[] {
  return [...checks].sort((a, b) => b.false - a.false || b.ran - a.ran || a.check.localeCompare(b.check));
}

/** The apps as rows, the most walked first; each app's screens with the unreached first, then the most opened. */
export function appRows(apps: WebWalkApp[]): AppRow[] {
  return apps
    .map((app) => ({
      app: app.app,
      walks: app.walks,
      opened: app.screens.filter((screen) => screen.opened > 0).length,
      unreached: app.screens.reduce((sum, screen) => sum + screen.unreached, 0),
      screens: [...app.screens].sort((a, b) => b.unreached - a.unreached || b.opened - a.opened || a.screen.localeCompare(b.screen)),
    }))
    .sort((a, b) => b.walks - a.walks || a.app.localeCompare(b.app));
}

/** An epoch-seconds moment as its YYYY-MM-DD in the reader's own zone, for the date formatter. */
export function sinceDay(since: number): string {
  const at = new Date(since * MS_PER_SECOND);
  const two = (part: number) => String(part).padStart(TWO_DIGITS, '0');
  return [at.getFullYear(), two(at.getMonth() + 1), two(at.getDate())].join('-');
}

/** Every day the plot draws, oldest first: from the later of the window's start and the history's first day, to today. */
function plotDays(span: WalkSpan): string[] {
  const today = dayNumber(span.today);
  const windowStart = today - span.days + 1;
  const start = span.firstDay === null ? windowStart : Math.max(windowStart, dayNumber(span.firstDay));
  const days: string[] = [];
  for (let day = start; day <= today; day += 1) days.push(new Date(day * MS_PER_DAY).toISOString().slice(0, ISO_DAY_LENGTH));
  return days;
}

/** A YYYY-MM-DD as a count of calendar days, read as UTC midnight so two dates are always a whole number of days apart. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(day + 'T00:00:00Z') / MS_PER_DAY);
}
