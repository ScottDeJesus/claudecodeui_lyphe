// The clock the Cerberus tab prints a moment on: LOCAL time, twenty-four hour, two digits each
// ("08:05"), written by hand rather than through `toLocaleTimeString` so the tab reads the same on
// every browser locale — a mute that "lifts at 08:00" must say 08:00 and not "8:00 AM". Every time
// the tab holds is epoch MILLISECONDS, and these are the only things that turn one into text or
// into an age. Used by CerberusProvider for the mute's toast, and by the tab's views for every time
// they print.
//
// Pure on purpose: no `t`, no `Date.now()`. A phrase like "12 s ago" is the screen's, built through
// `t('cerberus.time.…', { count: n })` from the parts `agoParts` answers, so the words stay in
// `en/common.json` and the age is a function of the two moments it is handed.

const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;

/** Under this many seconds an age reads "now": a result a second old is the same moment as this one. */
const NOW_BELOW_SECONDS = 2;

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** "08:05": the hour and minute of a moment, local time. */
export function hm(ms: number): string {
  const moment = new Date(ms);
  return `${twoDigits(moment.getHours())}:${twoDigits(moment.getMinutes())}`;
}

/** "08:05:09": the hour, minute and second of a moment, local time — what a lookup or a result is stamped with. */
export function hms(ms: number): string {
  return `${hm(ms)}:${twoDigits(new Date(ms).getSeconds())}`;
}

/**
 * "2026-10-05 08:05": the local date and the minute of a moment. ISO-ordered digits rather than a
 * month name, because the words of a date would need a locale and this file takes none. For a moment
 * that may not be today's — `hm` alone would read as this morning.
 */
export function dayAndTime(ms: number): string {
  const moment = new Date(ms);
  const date = `${moment.getFullYear()}-${twoDigits(moment.getMonth() + 1)}-${twoDigits(moment.getDate())}`;
  return `${date} ${hm(ms)}`;
}

/**
 * How long before `now` a moment `ms` was, as a count and the unit it is best said in — or `'now'`
 * for less than two seconds. Whole numbers, rounded DOWN: "75 s" is "1 min" and 119 minutes is
 * "1 h", so an age never reads older than it is. A moment after `now` (the server's clock a hair
 * ahead of the browser's) is `'now'`, never a negative count. The screen says it with
 * `t('cerberus.time.secondsAgo' | 'minutesAgo' | 'hoursAgo' | 'daysAgo', { count: n })`.
 */
export function agoParts(ms: number, now: number): 'now' | { n: number; unit: 's' | 'min' | 'h' | 'd' } {
  const seconds = Math.max(0, Math.floor((now - ms) / SECOND_MS));
  if (seconds < NOW_BELOW_SECONDS) return 'now';
  if (seconds < MINUTE_SECONDS) return { n: seconds, unit: 's' };
  if (seconds < HOUR_SECONDS) return { n: Math.floor(seconds / MINUTE_SECONDS), unit: 'min' };
  if (seconds < DAY_SECONDS) return { n: Math.floor(seconds / HOUR_SECONDS), unit: 'h' };
  return { n: Math.floor(seconds / DAY_SECONDS), unit: 'd' };
}
