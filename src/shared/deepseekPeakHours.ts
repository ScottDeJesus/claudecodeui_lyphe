/**
 * When DeepSeek bills at its peak rate, and when it does not.
 *
 * The vendor's rule, from its pricing page (in force since 2026-08-16): peak is 01:00–04:00 and
 * 06:00–10:00 UTC, Monday through Friday; every other hour, and all of Saturday and Sunday, is
 * off-peak and bills at HALF the peak rate, for every model and every token type. The rule is
 * stated in UTC and is kept in UTC here; it is turned into the reader's own clock only where it is
 * drawn, through `Intl`, so a daylight-saving change moves the words without anyone editing them.
 *
 * Used by the accounts panel (`DeepseekPeakHours`, under the balance) and by the composer's Flash
 * chip, which wears the same answer as its tone. One rule, so the two can never disagree.
 */

/** Peak windows as UTC hours, `[start, end)`. Weekdays only — see `isPeakWeekday`. */
const PEAK_WINDOWS_UTC: readonly (readonly [number, number])[] = [[1, 4], [6, 10]];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Monday–Friday on the UTC calendar, which is the calendar the vendor's rule is written in. */
function isPeakWeekday(utcDay: number): boolean {
  return utcDay >= 1 && utcDay <= 5;
}

/** Midnight UTC of the day `instant` falls on. */
function utcMidnight(instant: number): number {
  return instant - (instant % DAY_MS);
}

export type DeepseekPeakStatus = {
  /** True while the peak rate is being billed. */
  peak: boolean;
  /** The instant this answer stops being true: the window's end when peak, the next window's start when not. */
  changesAt: number;
};

/** Whether `now` is billed at the peak rate, and when that next changes. */
export function deepseekPeakStatus(now: number): DeepseekPeakStatus {
  // Eight days covers the longest quiet stretch there is (Friday 10:00 UTC to Monday 01:00 UTC)
  // from any starting point, so the loop always meets a window.
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const midnight = utcMidnight(now) + dayOffset * DAY_MS;
    if (!isPeakWeekday(new Date(midnight).getUTCDay())) continue;

    for (const [startHour, endHour] of PEAK_WINDOWS_UTC) {
      const start = midnight + startHour * HOUR_MS;
      const end = midnight + endHour * HOUR_MS;
      if (now < start) return { peak: false, changesAt: start };
      if (now < end) return { peak: true, changesAt: end };
    }
  }
  // Unreachable while a week holds a weekday; answered rather than thrown, because this is read in render.
  return { peak: false, changesAt: now + DAY_MS };
}

/** A clock time on the reader's own clock, with the minutes dropped from a round hour: `6 PM`, `6:30 PM`. */
function clockInWords(instant: number): string {
  const date = new Date(instant);
  return date.toLocaleTimeString([], date.getMinutes() === 0
    ? { hour: 'numeric' }
    : { hour: 'numeric', minute: '2-digit' });
}

function weekdayInWords(instant: number): string {
  return new Date(instant).toLocaleDateString([], { weekday: 'short' });
}

/**
 * The peak windows on the reader's own clock, one plain sentence each — `Sun to Thu, 6 PM to 9 PM`
 * and `Sun to Thu, 11 PM to 3 AM` in Pacific daylight time. Words rather than dashes: a line of
 * `Sun–Thu 6 PM–9 PM` is four dashes doing two different jobs, and it reads as noise.
 *
 * Read off the week of the peak window that is on now or comes NEXT — never the week `now` is in.
 * On the Sunday the clocks change, `now`'s week is the one that just ended under the old offset,
 * and hours read off it sit an hour away from the "until" line drawn directly above them. The
 * day range is named by where each window STARTS: a window that runs past local midnight is still
 * one evening to the person planning around it.
 */
export function deepseekPeakWindowsInWords(now: number): string[] {
  const { peak, changesAt } = deepseekPeakStatus(now);
  const anchor = peak ? now : changesAt;
  // The Monday and the Friday of that window's UTC week.
  const monday = utcMidnight(anchor) - ((new Date(anchor).getUTCDay() + 6) % 7) * DAY_MS;
  const friday = monday + 4 * DAY_MS;

  return PEAK_WINDOWS_UTC.map(([startHour, endHour]) => {
    const days = `${weekdayInWords(monday + startHour * HOUR_MS)} to ${weekdayInWords(friday + startHour * HOUR_MS)}`;
    return `${days}, ${clockInWords(monday + startHour * HOUR_MS)} to ${clockInWords(monday + endHour * HOUR_MS)}`;
  });
}

/** When the current rate changes, on the reader's clock, with the day named once it is not today. */
export function deepseekRateChangeInWords(now: number, changesAt: number): string {
  const sameDay = new Date(now).toDateString() === new Date(changesAt).toDateString();
  return sameDay ? clockInWords(changesAt) : `${weekdayInWords(changesAt)} ${clockInWords(changesAt)}`;
}
