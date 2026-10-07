// The clock the Cerberus tab prints a moment on: LOCAL time, twenty-four hour, two digits each
// ("08:05"), written by hand rather than through `toLocaleTimeString` so the tab reads the same on
// every browser locale — a mute that "lifts at 08:00" must say 08:00 and not "8:00 AM". Every time
// the tab holds is epoch MILLISECONDS, and these are the only things that turn one into text or
// into an age. Used by CerberusProvider for the mute's toast, and by the tab's views for every time
// they print.
//
// Pure on purpose: no `t`, no `Date.now()`. A phrase like "12 s ago" is the screen's, built through
// `t('cerberus.time.…', { count: n })` from the parts `agoParts` answers, so the words stay in
// `en/common.json` and the age is a function of the two moments it is handed. `stretchKey` hands
// back a key and a count the same way the status table hands back a word's key: a key is not a word.

const SECOND_MS = 1_000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3_600;
const DAY_SECONDS = 86_400;

/** Under this many seconds an age reads "now": a result a second old is the same moment as this one. */
const NOW_BELOW_SECONDS = 2;

/** A time input's value once it is whole, "17:52" or "17:52:10". While one is half typed it holds "". */
const WHOLE_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

/** A date input's value once it is whole, "2026-10-05". A cleared one holds "". */
const WHOLE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const twoDigits = (value: number): string => String(value).padStart(2, '0');

/** True when a time input holds a whole time. The sheet's lookup and History's both wait for one before they answer. */
export function isWholeTime(text: string): boolean {
  return WHOLE_TIME.test(text);
}

/** True when a date input holds a whole date. History waits for one before it answers. */
export function isWholeDate(text: string): boolean {
  return WHOLE_DATE.test(text);
}

/** True when two moments fall on the same local calendar day. */
export function sameLocalDay(first: number, second: number): boolean {
  const a = new Date(first);
  const b = new Date(second);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * A stretch of SECONDS in the largest unit that says it exactly: 90 is "90 s", 900 is "15 min", 3600
 * is "1 h". The screen says it with `t(key, { count })`. It is how often a check runs ("every 30 s")
 * and how old a result may get before it no longer counts ("older than 90 s").
 */
export function stretchKey(seconds: number): {
  key: 'cerberus.time.seconds' | 'cerberus.time.minutes' | 'cerberus.time.hours';
  count: number;
} {
  if (seconds >= HOUR_SECONDS && seconds % HOUR_SECONDS === 0) return { key: 'cerberus.time.hours', count: seconds / HOUR_SECONDS };
  if (seconds >= MINUTE_SECONDS && seconds % MINUTE_SECONDS === 0) return { key: 'cerberus.time.minutes', count: seconds / MINUTE_SECONDS };
  return { key: 'cerberus.time.seconds', count: seconds };
}

/** "08:05": the hour and minute of a moment, local time. */
export function hm(ms: number): string {
  const moment = new Date(ms);
  return `${twoDigits(moment.getHours())}:${twoDigits(moment.getMinutes())}`;
}

/** "08:05:09": the hour, minute and second of a moment, local time — what a lookup or a result is stamped with. */
export function hms(ms: number): string {
  return `${hm(ms)}:${twoDigits(new Date(ms).getSeconds())}`;
}

/** "2026-10-05": a moment's local date, ISO-ordered, the digits a date input holds. History's date field starts from it. */
export const dateOf = (ms: number): string => {
  const moment = new Date(ms);
  return `${moment.getFullYear()}-${twoDigits(moment.getMonth() + 1)}-${twoDigits(moment.getDate())}`;
};

/**
 * The local moment a date input and a time input name together, in epoch ms: "2026-10-05" and
 * "17:52:10" is that second of that day. `null` while either field is not whole (a cleared date, a
 * half-typed time) or the two name no real day, so a lookup that already has a moment keeps it.
 */
export function momentOf(date: string, time: string): number | null {
  if (!isWholeDate(date) || !isWholeTime(time)) return null;
  const ms = new Date(`${date}T${time}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * "2026-10-05 08:05": the local date and the minute of a moment. ISO-ordered digits rather than a
 * month name, because the words of a date would need a locale and this file takes none. For a moment
 * that may not be today's — `hm` alone would read as this morning.
 */
export function dayAndTime(ms: number): string {
  return `${dateOf(ms)} ${hm(ms)}`;
}

/**
 * A moment to the second, with its date in front when it is not on `now`'s local day: "17:52:10"
 * today, "2026-10-02 17:52:10" on any other. A time alone always means today, so an answer History
 * still shows while it reads another date can never pass for that date's.
 */
export function stampOf(ms: number, now: number): string {
  return sameLocalDay(ms, now) ? hms(ms) : `${dateOf(ms)} ${hms(ms)}`;
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
