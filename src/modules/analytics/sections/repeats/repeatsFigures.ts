import type { RepeatsAnalytics, RepeatsDay, RepeatsFamily } from '@/shared/analytics-types';

/**
 * THE REPEATS SECTION'S ARITHMETIC: every figure the section draws that is not printed by `heal-repeats reading` as is.
 * The verb counts; these functions only word, slice and lay its counts out for the Astrolabe parts. Nothing here fetches.
 */

/** What the plot can draw, as RepeatsTrend's control names it. */
export type RepeatsMeasure = 'chars' | 'programs' | 'launches';

/** One day as DayChart takes it: the drawn values, and the words each value is read in. */
export type RepeatsChartDay = { day: string; values: (number | null)[]; figures: (string | null)[] };

/** A family's course, as trendMark takes it. */
export type RepeatsCourse = 'up' | 'down' | 'flat';

const SECONDS_PER_DAY = 86_400;
const CHARS_PER_THOUSAND = 1_000;
const CHARS_PER_MILLION = 1_000_000;
/** A family's course compares its last week of launches against the week before, so it needs two weeks of history. */
const TREND_WEEK_DAYS = 7;

/** The answer as the route carried it, checked key by key at the top; anything else is no answer. It never throws. */
export function narrowRepeats(data: unknown): RepeatsAnalytics | null {
  if (!isRecord(data)) return null;
  const { days, generated_at, today, first_day, window_days, thresholds, totals, steps, series, families } = data;
  if (typeof days !== 'number' || typeof generated_at !== 'number' || typeof today !== 'string' || typeof window_days !== 'number') return null;
  if (first_day !== null && typeof first_day !== 'string') return null;
  if (!isNumbers(thresholds, ['launches', 'chars'])) return null;
  if (!isNumbers(totals, ['launches', 'launches_writing', 'programs', 'chars', 'chars_in_families'])) return null;
  if (!isNumbers(steps, ['uses', 'worked', 'launches']) || !Array.isArray(steps.by_helper)) return null;
  if (!Array.isArray(series) || !Array.isArray(families)) return null;
  // The rows are carried as the verb printed them: the server's reader narrowed the same keys, and the verb is the one writer of their shape.
  return { days, generated_at, today, first_day, window_days, thresholds, totals, steps, series, families } as RepeatsAnalytics;
}

/** How many of the families are raised: waiting in the heal tab. */
export function raisedCountOf(families: RepeatsFamily[]): number {
  return families.filter((family) => family.raised).length;
}

/** A count of characters in short words: "412k", "1.48M". */
export function charsWords(chars: number): string {
  if (chars >= CHARS_PER_MILLION) return (chars / CHARS_PER_MILLION).toFixed(2) + 'M';
  if (chars >= CHARS_PER_THOUSAND) return Math.round(chars / CHARS_PER_THOUSAND).toLocaleString() + 'k';
  return chars.toLocaleString();
}

/** The families' share of every character written by hand ("38%"); null when nothing was written. */
export function shareWordsOf(totals: RepeatsAnalytics['totals']): string | null {
  return totals.chars === 0 ? null : likenessWords(totals.chars_in_families / totals.chars);
}

/** One figure of the days, oldest first, as a Readout's line. */
export function dayLine(series: RepeatsDay[], field: 'launches_writing' | 'chars_in_families'): number[][] {
  return [series.map((day) => day[field])];
}

/** Each day's share of its hand-written characters a family holds; null on a day with nothing written. */
export function shareLineOf(series: RepeatsDay[]): (number | null)[][] {
  return [series.map((day) => (day.chars === 0 ? null : day.chars_in_families / day.chars))];
}

/** The window's days for the plot, oldest first: characters split into a family's and the rest (in thousands), or one count. */
export function chartDaysOf(series: RepeatsDay[], measure: RepeatsMeasure): RepeatsChartDay[] {
  return series.map((day) => {
    if (measure === 'chars') {
      const rest = day.chars - day.chars_in_families;
      return { day: day.day, values: [day.chars_in_families / CHARS_PER_THOUSAND, rest / CHARS_PER_THOUSAND], figures: [charsWords(day.chars_in_families), charsWords(rest)] };
    }
    const figure = measureOf(day, measure);
    return { day: day.day, values: [figure], figures: [figure.toLocaleString()] };
  });
}

/** The window's sum of each series the plot draws, in words, for its legend. */
export function seriesTotalsOf(series: RepeatsDay[], measure: RepeatsMeasure): string[] {
  const sum = (pick: (day: RepeatsDay) => number) => series.reduce((total, day) => total + pick(day), 0);
  if (measure === 'chars') return [charsWords(sum((day) => day.chars_in_families)), charsWords(sum((day) => day.chars - day.chars_in_families))];
  return [sum((day) => measureOf(day, measure)).toLocaleString()];
}

/** A tick of the plot's scale: thousands of characters, or a plain count. */
export function tickWordsOf(measure: RepeatsMeasure): (value: number) => string {
  return (value) => (value === 0 ? '0' : measure === 'chars' ? value.toLocaleString() + 'k' : value.toLocaleString());
}

/** The days that had anything written by hand, newest first, for the day table. */
export function busyDaysOf(series: RepeatsDay[]): RepeatsDay[] {
  return series.filter((day) => day.programs > 0).reverse();
}

/** What repeats, cut from the family's sentence: what stands between "(repeat <id>): " and the closing " — ". */
export function familyWords(family: RepeatsFamily): string {
  const from = family.sentence.indexOf('): ');
  const to = family.sentence.lastIndexOf(' — ');
  return from < 0 || to < from ? family.sentence : family.sentence.slice(from + 3, to);
}

/**
 * The family's launches over its last seven days against the seven before, counted to today; null for a family seen
 * for less than two weeks, which has no course yet, and null under a window shorter than two weeks, whose series the
 * verb cut before the week before began.
 */
export function familyTrend(family: RepeatsFamily, days: number): RepeatsCourse | null {
  const today = localDay(Date.now());
  if (days < 2 * TREND_WEEK_DAYS) return null;
  if (family.first_seen > secondsAt(today) - 2 * TREND_WEEK_DAYS * SECONDS_PER_DAY) return null;
  const lastWeekFrom = shiftDay(today, -(TREND_WEEK_DAYS - 1));
  const weekBeforeFrom = shiftDay(today, -(2 * TREND_WEEK_DAYS - 1));
  const sum = (from: string, to: string) => family.series.filter((day) => day.day >= from && day.day <= to).reduce((total, day) => total + day.launches, 0);
  const last = sum(lastWeekFrom, today);
  const before = sum(weekBeforeFrom, shiftDay(lastWeekFrom, -1));
  return last > before ? 'up' : last < before ? 'down' : 'flat';
}

/** A moment's day in short words: "Nov 14". */
export function dateWords(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** A likeness or a share (0 to 1) as a percent: "63%". */
export function likenessWords(likeness: number): string {
  return Math.round(likeness * 100) + '%';
}

/**
 * The family's days for its plot, oldest first: the launches that wrote it each day. The verb prints only the days it
 * was written on, so the quiet days between are laid in as 0, from its first sighting (or the window's start) to today.
 */
export function familyDaysOf(family: RepeatsFamily, days: number): RepeatsChartDay[] {
  const launchesOn = new Map(family.series.map((day) => [day.day, day.launches]));
  return familyWindow(family, days).map((day) => {
    const launches = launchesOn.get(day) ?? 0;
    return { day, values: [launches], figures: [launches.toLocaleString()] };
  });
}

/** Those launches summed over the window, in words, for the plot's legend. */
export function familyDaysTotalOf(family: RepeatsFamily, days: number): string {
  const shown = new Set(familyWindow(family, days));
  return family.series.filter((day) => shown.has(day.day)).reduce((total, day) => total + day.launches, 0).toLocaleString();
}

function familyWindow(family: RepeatsFamily, days: number): string[] {
  const today = localDay(Date.now());
  const windowStart = shiftDay(today, -(days - 1));
  const seen = localDay(family.first_seen * 1000);
  const start = seen > windowStart ? seen : windowStart;
  const window: string[] = [];
  for (let day = start; day <= today; day = shiftDay(day, 1)) window.push(day);
  return window;
}

function measureOf(day: RepeatsDay, measure: Exclude<RepeatsMeasure, 'chars'>): number {
  return measure === 'programs' ? day.programs : day.launches_writing;
}

/** A moment's box-local date, YYYY-MM-DD, spelled as the verb spells a day. */
function localDay(milliseconds: number): string {
  const date = new Date(milliseconds);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function shiftDay(day: string, by: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return localDay(new Date(year, month - 1, date + by).getTime());
}

function secondsAt(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).getTime() / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumbers(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && keys.every((key) => typeof value[key] === 'number');
}
