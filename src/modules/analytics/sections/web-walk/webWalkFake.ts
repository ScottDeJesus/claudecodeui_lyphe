import type { AnalyticsReading } from '@/modules/analytics/types';
import type { WebWalkAnalytics, WebWalkApp, WebWalkCheck, WebWalkDay, WebWalkSettled, WebWalkTotals } from '@/shared/analytics-types';

// THE SCAFFOLD'S READINGS: fake answers shaped as web-walk reading's object (the design's seam 7), one per state the
// section draws. Nothing here is measured. This file goes whole when the section reads its route: the FILL markers in
// WebWalkSection, WebWalkTrend and WebWalkApps name each place it is used.

/** Every state the section draws: the frame's two (loading, error), no history, a quiet window, the full page, the nudge refusing over a young history, and too much. */
export type FakeState = 'loading' | 'error' | 'empty' | 'quiet' | 'full' | 'refusing' | 'dense';

/** The state the section draws. Change the word to see another. */
export const FAKE_STATE: FakeState = 'full';

const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1_000;
const SECONDS_PER_DAY = 86_400;
const ISO_DAY_LENGTH = 10;
const TWO_DIGITS = 2;
const TAKEN_SECONDS_AGO = 240;
const NUDGE_WINDOW_DAYS = 7;
const REFUSING_FOR_DAYS = 3;
const YOUNG_HISTORY_DAYS = 12;
const HISTORY_BEFORE_WINDOW_DAYS = 40;
const SCRIPT_DOOR_SHARE = 0.7;
const CUSTOM_WALK_SHARE = 0.7;
const DENSE_SCREENS = 18;
const BARS = { min_launches: 30, share: 0.9, min_walks: 100, fault_share: 0.02, release_min_walks: 20, release_fault_share: 0.05 };

/** A check's name, the share of walks that ran it, and the share of those runs it answered false. */
const CHECKS: [string, number, number][] = [
  ['cutoff', 0.71, 0.15],
  ['overflow', 0.67, 0.07],
  ['tap', 0.47, 0.27],
  ['contrast', 0.43, 0.16],
  ['console', 0.6, 0.04],
  ['images', 0.35, 0],
  ['overlap', 0.26, 0.05],
];

/** An app's share of the walks, and its screens: name, share of the app's walks that opened it, times unreached. */
const APPS: { app: string; share: number; screens: [string, number, number][] }[] = [
  { app: 'cloudcli', share: 0.6, screens: [['analytics', 0.5, 0], ['settings', 0.22, 0], ['analytics-code-mode', 0.16, 1], ['home', 0.12, 0], ['inbox', 0.06, 0]] },
  { app: 'restorly', share: 0.4, screens: [['schedule', 0.55, 0], ['job', 0.4, 2], ['job-money', 0.18, 0], ['control', 0.08, 0], ['vendors', 0.05, 1]] },
];

/** What the section's two folds hold in a state: the day-by-day table, and the app open under itself. */
export function fakeOpen(state: FakeState): { days: boolean; app: string | null } {
  if (state === 'dense') return { days: true, app: 'restorly' };
  return { days: false, app: state === 'full' ? 'cloudcli' : null };
}

/** The reading a state draws, for a window of days. */
export function fakeReading(state: FakeState, days: number): AnalyticsReading<WebWalkAnalytics> {
  if (state === 'loading') return { status: 'loading' };
  if (state === 'error') return { status: 'unreachable' };
  return { status: 'ready', data: fakeAnswer(state, days), stale: false };
}

function fakeAnswer(state: Exclude<FakeState, 'loading' | 'error'>, days: number): WebWalkAnalytics {
  const now = new Date();
  const two = (part: number) => String(part).padStart(TWO_DIGITS, '0');
  const today = [now.getFullYear(), two(now.getMonth() + 1), two(now.getDate())].join('-');
  const generatedAt = Math.floor(now.getTime() / MS_PER_SECOND) - TAKEN_SECONDS_AGO;
  const head = { days, generated_at: generatedAt, today };
  const longAgo = dayBack(today, days + HISTORY_BEFORE_WINDOW_DAYS);

  if (state === 'empty' || state === 'quiet') {
    return { ...head, first_day: state === 'quiet' ? longAgo : null, settled: settledOf([], false, null), totals: totalsOf([], [], []), series: [], checks: [], doors: { execute: 0, command: 0 }, apps: [] };
  }

  const fallen = state === 'refusing';
  const covered = fallen ? Math.min(days, YOUNG_HISTORY_DAYS) : days;
  const series = fakeSeries(today, covered, fallen);
  const walks = series.reduce((sum, row) => sum + row.walks, 0);
  const checks: WebWalkCheck[] = CHECKS.map(([check, ranShare, falseShare]) => {
    const ran = Math.round(walks * ranShare);
    return { check, ran, false: Math.round(ran * falseShare) };
  });
  const apps: WebWalkApp[] = APPS.map(({ app, share, screens }) => {
    const appWalks = Math.round(walks * share);
    const named = screens.map(([screen, opened, unreached]) => ({ screen, opened: Math.max(1, Math.round(appWalks * opened)), unreached }));
    const more = state === 'dense' ? Array.from({ length: DENSE_SCREENS }, (_, at) => ({ screen: app + '-settings-notifications-and-sounds-' + (at + 1), opened: DENSE_SCREENS - at, unreached: at % 6 === 0 ? 1 : 0 })) : [];
    return { app, walks: appWalks, screens: [...named, ...more] };
  });
  const scripted = Math.round(walks * SCRIPT_DOOR_SHARE);

  return {
    ...head,
    first_day: fallen ? dayBack(today, covered - 1) : longAgo,
    settled: settledOf(series.slice(-NUDGE_WINDOW_DAYS), fallen, fallen ? generatedAt - REFUSING_FOR_DAYS * SECONDS_PER_DAY : null),
    totals: totalsOf(series, checks, apps),
    series,
    checks,
    doors: { execute: scripted, command: walks - scripted },
    apps,
  };
}

/** The days, oldest first. Unfallen, launches by hand give way to the helper across the window; fallen, they are nearly gone. A few days hold no row. */
function fakeSeries(today: string, count: number, fallen: boolean): WebWalkDay[] {
  const rows: WebWalkDay[] = [];
  for (let at = 0; at < count; at += 1) {
    if (!fallen && at % 9 === 4 && at < count - 1) continue;
    const progress = count > 1 ? at / (count - 1) : 1;
    const walking = Math.round((fallen ? 5 : 1) + progress * (fallen ? 4 : 5)) + (at % 3 === 0 ? 1 : 0);
    const byHand = fallen ? (at % 5 === 0 ? 1 : 0) : Math.max(0, Math.round(6 * (1 - progress)) + 1 - (at % 4 === 0 ? 1 : 0));
    rows.push({ day: dayBack(today, count - 1 - at), walks: walking * 3 + (at % 2), launches_walking: walking, launches_by_hand: byHand, custom_steps: at % 3 === 0 ? 2 : at % 5 === 0 ? 1 : 0, faults: at % 11 === 7 ? 1 : 0 });
  }
  return rows;
}

function totalsOf(series: WebWalkDay[], checks: WebWalkCheck[], apps: WebWalkApp[]): WebWalkTotals {
  const sum = (pick: (row: WebWalkDay) => number) => series.reduce((total, row) => total + pick(row), 0);
  const custom = sum((row) => row.custom_steps);
  return {
    walks: sum((row) => row.walks),
    launches_walking: sum((row) => row.launches_walking),
    launches_by_hand: sum((row) => row.launches_by_hand),
    custom_steps: custom,
    walks_with_custom: Math.ceil(custom * CUSTOM_WALK_SHARE),
    checks_false: checks.reduce((total, row) => total + row.false, 0),
    faults: sum((row) => row.faults),
    unreached: apps.reduce((total, app) => total + app.screens.reduce((inner, screen) => inner + screen.unreached, 0), 0),
  };
}

function settledOf(lastDays: WebWalkDay[], refusing: boolean, since: number | null): WebWalkSettled {
  const sum = (pick: (row: WebWalkDay) => number) => lastDays.reduce((total, row) => total + pick(row), 0);
  const walking = sum((row) => row.launches_walking);
  const byHand = sum((row) => row.launches_by_hand);
  return { refusing, since, window_days: NUDGE_WINDOW_DAYS, launches_walking: walking, launches_by_hand: byHand, share: walking + byHand > 0 ? walking / (walking + byHand) : null, walks: sum((row) => row.walks), faults: sum((row) => row.faults), bars: BARS };
}

function dayBack(today: string, back: number): string {
  return new Date(Date.parse(today + 'T00:00:00Z') - back * MS_PER_DAY).toISOString().slice(0, ISO_DAY_LENGTH);
}
