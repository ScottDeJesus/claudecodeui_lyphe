import type { TFunction } from 'i18next';

/** The two shapes rnd schedule installs: a minute, an hour and one weekday; or a minute and an hour every day. */
const WEEKLY = /^(\d{1,2}) (\d{1,2}) \* \* ([0-7])$/;
const DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;

/** A Sunday (2026-01-04), the day cron's 0 and 7 both name: the weekday's own name is read off it plus the day's number. */
const A_SUNDAY_MS = Date.UTC(2026, 0, 4);
const DAY_MS = 86_400_000;
const HOURS = 24;
const MINUTES = 60;

/**
 * A cron expression said as a day and a time ("Mondays at 06:30"), in the box's own clock, which is the clock cron reads. Any
 * other expression is said as it stands: a time the place cannot say plainly is still the truth.
 */
export function sayWeekly(expression: string, t: TFunction, language: string): string {
  const daily = DAILY.exec(expression);
  if (daily !== null) {
    const time = clockOf(daily[2], daily[1]);
    return time === null ? expression : t('rnd.dailyAt', { time });
  }
  const weekly = WEEKLY.exec(expression);
  if (weekly === null) return expression;
  const time = clockOf(weekly[2], weekly[1]);
  if (time === null) return expression;
  const weekday = Number(weekly[3]) % 7;
  const day = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(A_SUNDAY_MS + weekday * DAY_MS);
  return t('rnd.weeklyOn', { day, time });
}

function clockOf(hour: string, minute: string): string | null {
  if (Number(hour) >= HOURS || Number(minute) >= MINUTES) return null;
  return hour.padStart(2, '0') + ':' + minute.padStart(2, '0');
}
