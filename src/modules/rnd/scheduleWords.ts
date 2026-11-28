import type { TFunction } from 'i18next';

import type { RndSchedule, RndWeekday } from '@/shared/rnd-types';

/** A Sunday (2026-01-04): a weekday's name in the reader's language is read off it plus the day's place after Sunday. */
const A_SUNDAY_MS = Date.UTC(2026, 0, 4);
const DAY_MS = 86_400_000;
const PLACE_AFTER_SUNDAY: Record<RndWeekday, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** The weekdays in the order the settings sheet offers them. */
export const RND_WEEKDAYS: readonly RndWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Used by the settings sheet's day control (short) and by saySchedule (long): a weekday's name in the reader's language. */
export function weekdayName(day: RndWeekday, language: string, width: 'short' | 'long'): string {
  return new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' }).format(A_SUNDAY_MS + PLACE_AFTER_SUNDAY[day] * DAY_MS);
}

/**
 * Used by the panel's scout line: the schedule said as words ("Mondays at 06:30"), on the box's own clock, which is the clock
 * cron reads. It is said from the setting itself, never parsed back out of the crontab expression.
 */
export function saySchedule(schedule: RndSchedule, t: TFunction, language: string): string {
  switch (schedule.frequency) {
    case 'off':
      return t('rnd.scout.noSchedule');
    case 'daily':
      return t('rnd.dailyAt', { time: schedule.time });
    case 'weekly':
      return t('rnd.weeklyOn', { day: weekdayName(schedule.day, language, 'long'), time: schedule.time });
    case 'monthly':
      return t('rnd.monthlyOn', { day: schedule.day, time: schedule.time });
    default: {
      const unknown: never = schedule;
      return String(unknown);
    }
  }
}
