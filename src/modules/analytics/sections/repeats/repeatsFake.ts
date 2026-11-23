import type { RepeatsAnalytics, RepeatsDay, RepeatsFamily, RepeatsFamilyDay } from '@/shared/analytics-types';
import type { AnalyticsReading } from '@/modules/analytics/types';

/**
 * THE SCAFFOLD'S STAND-IN: a made-up Repeats answer in the shape `heal-repeats reading` prints, and a rough version of
 * every figure the section draws. Each use of it stands under a `FILL:` marker. The fill puts the real read and
 * `repeatsFigures.ts` behind the markers and deletes this file whole.
 *
 * The address picks what is drawn, so every state can be looked at: `?repeats=` loading, unreachable, stale, none (no
 * launch read), empty (no family yet) or data; `?open=` a family's id; `?measure=` chars, programs or launches;
 * `?table=1` the day table open.
 */

type Measure = 'chars' | 'programs' | 'launches';
type ChartDay = { day: string; values: (number | null)[]; figures: (string | null)[] };
type Course = 'up' | 'down' | 'flat';

const DAY_SECONDS = 86_400;
const asked = () => new URLSearchParams(window.location.search);
const now = () => Math.floor(Date.now() / 1000);

function dayBack(back: number): string {
  const date = new Date();
  date.setDate(date.getDate() - back);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

const daysOf = (count: number) => Array.from({ length: count }, (_, index) => dayBack(count - 1 - index));

function seriesOf(count: number, share: number): RepeatsDay[] {
  return daysOf(count).map((day, index) => {
    const quiet = index % 11 === 4;
    const launches_writing = quiet ? 0 : 5 + ((index * 7) % 9);
    const programs = quiet ? 0 : launches_writing * 2 + ((index * 5) % 7);
    const chars = quiet ? 0 : programs * 640 + ((index * 37) % 11) * 900;
    return { day, launches_writing, programs, chars, chars_in_families: Math.round(chars * share * (0.7 + ((index * 3) % 5) * 0.15)) };
  });
}

function familyDaysOf(count: number, peak: number, course: Course): RepeatsFamilyDay[] {
  return daysOf(count).map((day, index) => {
    const along = (index + 1) / count;
    const weight = course === 'up' ? 0.3 + along : course === 'down' ? 1.3 - along * 1.3 : 0.8;
    const launches = index % 6 === 3 ? 0 : Math.max(0, Math.round(peak * weight * (0.6 + ((index * 5) % 4) * 0.13)));
    return { day, launches, programs: launches * 2, chars: launches * 2 * 3100 };
  });
}

const programSentence = (id: string, features: string[]) =>
  'hand-written again in many launches (repeat ' + id + '): ' + features.slice(0, 8).join(', ') + ' — a shared script, or the existing tool taught, replaces it';

function familiesOf(count: number): RepeatsFamily[] {
  const browser = ['.screenshot(', '.goto(', '.locator(', 'mod:playwright', '.newPage(', '.launch(', '.waitForSelector(', '.setViewportSize(', '.evaluate(', 'route:/api/analytics/0'];
  const ledger = ['mod:better-sqlite3', '.prepare(', '.all(', 'route:/api/heal/kinds', '.pragma(', 'cmd:docstore get'];
  const health = ['route:/api/health', 'fetch(', 'mod:node-fetch', '.json(', 'cmd:curl'];
  const runs = ['seq:git status>git diff>git log', 'seq:git diff>git log>git show', 'seq:docstore govern>docstore get>docstore get', 'seq:ls>cat>grep'];
  const plans = ['mod:@iarna/toml', '.parse(', 'phaseRows(', 'cmd:plan-runner show'];
  const step = ['place:eis-web/job-detail', 'same:9f2c1a7b3d4e', '.click(', '.fill(', '.waitForResponse(', '.getByRole('];
  return [
    {
      id: 'r-3f9a12c4', sentence: programSentence('r-3f9a12c4', browser), tool: 'program', features: browser, first_seen: now() - 19 * DAY_SECONDS,
      cured_at: null, raised: true, launches: 61, programs: 130, chars: 412_380, uses: null, worked: null, since_cure: null,
      names: [{ name: 'shot.mjs', count: 38 }, { name: 'probe.mjs', count: 27 }, { name: 'verify.mjs', count: 19 }, { name: 'look.mjs', count: 11 }, { name: 'check-ui.mjs', count: 8 }],
      examples: [
        { owner: 'heal-kind-rows--build-20261120-141233-9c1e', path: '/tmp/iris-7f3a/shot.mjs', chars: 6_412 },
        { owner: 'analytics-code-mode--fix-20261119-093417-41aa', path: '/home/lyphe/.claude/state/dispatch-souls/dispatch-hephaestus-20261119-093417-41aa/code_mode/verify.mjs', chars: 5_930 },
        { owner: 'uploads-view--review-20261118-221004-77b0', path: '/tmp/athena-probe-2c91/look.mjs', chars: 4_876 },
        { owner: 'session-5aac19e0', path: '/tmp/check-ui.mjs', chars: 3_204 },
        { owner: 'kanban-dashboard--build-20261117-160245-0d3f', path: '/tmp/probe.mjs', chars: 2_981 },
      ],
      existing: [{ tool: 'browser.*', likeness: 1, used_by: 9 }, { path: 'claudecodeui_lyphe/.verify/lib/page.mjs', likeness: 0.63, used_by: 14 }],
      series: familyDaysOf(count, 4, 'up'),
    },
    {
      id: 'r-81c0d7e2', sentence: programSentence('r-81c0d7e2', ledger), tool: 'program', features: ledger, first_seen: now() - 41 * DAY_SECONDS,
      cured_at: now() - 14 * DAY_SECONDS, raised: true, launches: 23, programs: 41, chars: 128_900, uses: null, worked: null,
      since_cure: { launches: 19, programs: 33, chars: 101_200 },
      names: [{ name: 'rows.py', count: 17 }, { name: 'ledger.mjs', count: 9 }],
      examples: [
        { owner: 'heal-ledger-kinds--build-20261121-101544-b2c7', path: '/tmp/rows.py', chars: 3_870 },
        { owner: 'session-0c44d1f2', path: '/tmp/heal-look/ledger.mjs', chars: 3_102 },
      ],
      existing: [{ path: 'scripts/docstore', likeness: 0.71, used_by: 6 }],
      series: familyDaysOf(count, 2, 'flat'),
    },
    {
      id: 'r-0d6b77aa', sentence: programSentence('r-0d6b77aa', health), tool: 'program', features: health, first_seen: now() - 33 * DAY_SECONDS,
      cured_at: now() - 8 * DAY_SECONDS, raised: false, launches: 12, programs: 19, chars: 73_400, uses: null, worked: null,
      since_cure: { launches: 2, programs: 2, chars: 6_300 },
      names: [{ name: 'health.sh', count: 11 }, { name: 'ping.mjs', count: 5 }],
      examples: [{ owner: 'connector-health--build-20261109-084410-3e19', path: '/tmp/health.sh', chars: 1_940 }],
      existing: [{ path: 'scripts/rcurl.sh', likeness: 0.8, used_by: 10 }],
      series: familyDaysOf(count, 2, 'down'),
    },
    {
      id: 'r-5be2a019', sentence: programSentence('r-5be2a019', runs), tool: 'commands', features: runs, first_seen: now() - 12 * DAY_SECONDS,
      cured_at: null, raised: true, launches: 17, programs: 17, chars: 61_240, uses: null, worked: null, since_cure: null,
      names: [],
      examples: [{ owner: 'docs-atlas--docs-20261121-190233-6a08', path: 'git status > git diff > git log', chars: 4_410 }],
      existing: [],
      series: familyDaysOf(count, 2, 'up'),
    },
    {
      id: 'r-a2e94f31', sentence: programSentence('r-a2e94f31', plans), tool: 'program', features: plans, first_seen: now() - 5 * DAY_SECONDS,
      cured_at: null, raised: false, launches: 5, programs: 6, chars: 21_050, uses: null, worked: null, since_cure: null,
      names: [{ name: 'phases.py', count: 4 }],
      examples: [{ owner: 'plan-census--build-20261120-072915-55d2', path: '/tmp/phases.py', chars: 3_655 }],
      existing: [],
      series: familyDaysOf(count, 1, 'flat'),
    },
    {
      id: 'r-c47e5a90',
      sentence: 'custom step written again in many launches (repeat r-c47e5a90): eis-web at job-detail, ' + step.slice(2).join(', ') + ' — add it to the helper’s premade set or its dictionary',
      tool: 'step', features: step, first_seen: now() - 9 * DAY_SECONDS,
      cured_at: null, raised: true, launches: 8, programs: 0, chars: 9_870, uses: 34, worked: 29, since_cure: null,
      names: [],
      examples: [{ owner: 'job-detail-moisture--build-20261121-113820-e4b1', path: 'eis-web at job-detail: open the moisture log', chars: 312 }],
      existing: [{ path: '/opt/eis-app/cases/lib/steps.mjs', likeness: 0.5, used_by: 0 }],
      series: familyDaysOf(count, 1, 'flat'),
    },
  ];
}

function answerOf(days: number, state: string): RepeatsAnalytics {
  const none = state === 'none';
  const families = state === 'none' || state === 'empty' ? [] : familiesOf(days);
  const series = none
    ? daysOf(days).map((day) => ({ day, launches_writing: 0, programs: 0, chars: 0, chars_in_families: 0 }))
    : seriesOf(days, families.length > 0 ? 0.38 : 0);
  const sum = (pick: (day: RepeatsDay) => number) => series.reduce((total, day) => total + pick(day), 0);
  const writing = sum((day) => day.launches_writing);
  const steps = none
    ? { uses: 0, worked: 0, launches: 0, by_helper: [] }
    : families.length > 0
      ? { uses: 47, worked: 39, launches: 11, by_helper: [{ helper: 'eis-web', uses: 34, worked: 29, launches: 8 }, { helper: 'docstore-db', uses: 13, worked: 10, launches: 4 }] }
      : { uses: 6, worked: 5, launches: 3, by_helper: [{ helper: 'eis-web', uses: 6, worked: 5, launches: 3 }] };
  return {
    days,
    generated_at: now() - 240,
    today: dayBack(0),
    first_day: none ? null : dayBack(days + 12),
    window_days: 7,
    thresholds: { launches: 5, chars: 50_000 },
    totals: {
      launches: Math.round(writing * 1.6),
      launches_writing: writing,
      programs: sum((day) => day.programs),
      chars: sum((day) => day.chars),
      chars_in_families: sum((day) => day.chars_in_families),
    },
    steps,
    series,
    families,
  };
}

/** The section's read, made up: what `useAnalyticsSection` will answer. */
export function fakeRepeatsSection(days: number): { reading: AnalyticsReading<RepeatsAnalytics>; refresh: () => void } {
  const state = asked().get('repeats') ?? 'data';
  const refresh = () => {};
  if (state === 'loading') return { reading: { status: 'loading' }, refresh };
  if (state === 'unreachable') return { reading: { status: 'unreachable' }, refresh };
  return { reading: { status: 'ready', data: answerOf(days, state), stale: state === 'stale' }, refresh };
}

/** What the reader would have pressed: the plot's measure, the day table, the open family. */
export function fakeChoice(): { measure: Measure; tableOpen: boolean; openFamily: string | null } {
  const measure = asked().get('measure');
  return { measure: measure === 'programs' || measure === 'launches' ? measure : 'chars', tableOpen: asked().get('table') === '1', openFamily: asked().get('open') };
}

export const fakeRaisedCount = (families: RepeatsFamily[]) => families.filter((family) => family.raised).length;

export function fakeCharsWords(chars: number): string {
  if (chars >= 1_000_000) return (chars / 1_000_000).toFixed(2) + 'M';
  if (chars >= 1_000) return Math.round(chars / 1_000).toLocaleString() + 'k';
  return chars.toLocaleString();
}

export const fakeShareWords = (totals: RepeatsAnalytics['totals']) => (totals.chars === 0 ? null : Math.round((100 * totals.chars_in_families) / totals.chars) + '%');

export const fakeDayLine = (series: RepeatsDay[], field: 'launches_writing' | 'chars_in_families') => [series.map((day) => day[field])];

export const fakeShareLine = (series: RepeatsDay[]) => [series.map((day) => (day.chars === 0 ? null : day.chars_in_families / day.chars))];

export function fakeChartDays(series: RepeatsDay[], measure: Measure): ChartDay[] {
  return series.map((day) => {
    if (measure === 'chars') {
      const rest = day.chars - day.chars_in_families;
      return { day: day.day, values: [day.chars_in_families / 1_000, rest / 1_000], figures: [fakeCharsWords(day.chars_in_families), fakeCharsWords(rest)] };
    }
    const figure = measure === 'programs' ? day.programs : day.launches_writing;
    return { day: day.day, values: [figure], figures: [figure.toLocaleString()] };
  });
}

export function fakeSeriesTotals(series: RepeatsDay[], measure: Measure): string[] {
  const sum = (pick: (day: RepeatsDay) => number) => series.reduce((total, day) => total + pick(day), 0);
  if (measure === 'chars') return [fakeCharsWords(sum((day) => day.chars_in_families)), fakeCharsWords(sum((day) => day.chars - day.chars_in_families))];
  return [sum((day) => (measure === 'programs' ? day.programs : day.launches_writing)).toLocaleString()];
}

export const fakeTickWords = (measure: Measure) => (value: number) => (value === 0 ? '0' : measure === 'chars' ? value.toLocaleString() + 'k' : value.toLocaleString());

export const fakeBusyDays = (series: RepeatsDay[]) => series.filter((day) => day.programs > 0).reverse();

export function fakeFamilyWords(family: RepeatsFamily): string {
  const from = family.sentence.indexOf('): ');
  const to = family.sentence.lastIndexOf(' — ');
  return from < 0 || to < from ? family.sentence : family.sentence.slice(from + 3, to);
}

export function fakeFamilyTrend(family: RepeatsFamily): Course | null {
  if (family.series.length < 14) return null;
  const sum = (days: RepeatsFamilyDay[]) => days.reduce((total, day) => total + day.launches, 0);
  const last = sum(family.series.slice(-7));
  const before = sum(family.series.slice(-14, -7));
  return last > before ? 'up' : last < before ? 'down' : 'flat';
}

export const fakeDateWords = (seconds: number) => new Date(seconds * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const fakeLikenessWords = (likeness: number) => Math.round(likeness * 100) + '%';

export const fakeFamilyDays = (family: RepeatsFamily): ChartDay[] => family.series.map((day) => ({ day: day.day, values: [day.launches], figures: [day.launches.toLocaleString()] }));

export const fakeFamilyDaysTotal = (family: RepeatsFamily) => family.series.reduce((total, day) => total + day.launches, 0).toLocaleString();
