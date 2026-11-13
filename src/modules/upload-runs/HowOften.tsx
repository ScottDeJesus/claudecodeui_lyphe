import { useTranslation } from 'react-i18next';

import type { DayBucket } from '@/modules/upload-runs/utils/uploadsModel';
import type { Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

type HowOftenProps = {
  /** One bucket per day of the window, oldest first, in the browser's local time. */
  days: DayBucket[];
  /** 24 counts: the window's presses by local hour, midnight first. */
  hours: number[];
};

/** The hours named under the strip, every sixth, so the eye places a cell without counting. */
const HOUR_MARKS = [0, 6, 12, 18];
/** The three parts of a day's column, bottom up, each with its tone and the word the legend gives it. */
const PARTS: { key: 'clean' | 'hiccup' | 'test'; tone: Tone }[] = [
  { key: 'clean', tone: 'positive' },
  { key: 'hiccup', tone: 'warn' },
  { key: 'test', tone: 'neutral' },
];

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });

/**
 * HOW OFTEN: when the Uploads page is pressed. Two small pictures, each with its answer in words above it.
 *
 * BY DAY: one column per day of the window, its height its runs against the busiest day's, the clean runs at the foot in
 * the positive tone and the hiccups stacked over them in the warn tone (test runs grey on top, when they are listed).
 * Today is the last column and is named under it. The sentence above gives the figure a comparison: the busiest day and
 * its count of UPLOADS. A test run is drawn, in grey, and counted in no sentence: the busiest day is the day with the
 * most real runs, so it agrees with the head's figures when Test runs is on. A column is `title`d with its own day and
 * counts (its tests too, when it has any), and the whole picture has one spoken sentence.
 *
 * BY HOUR: a strip of 24 cells, midnight to midnight in the reader's own clock, each darker the more presses fell in
 * that hour; an hour with none is the track's own grey. The sentence above names the busiest hour.
 *
 * COLOUR NEVER STANDS ALONE: the legend under the columns names each tone, the order (clean under hiccup) holds in grey,
 * and both sentences carry the answer for a reader who sees neither picture.
 *
 * Used by this module's `UploadsBody`, under By upload type.
 */
export function HowOften({ days, hours }: HowOftenProps) {
  const { t } = useTranslation();
  const o = 'cerberus.uploads.often';
  // A column's height counts everything it draws; the busiest day counts uploads alone, as every sentence of the view does.
  const uploads = (day: DayBucket) => day.clean + day.hiccup;
  const dayPeak = Math.max(0, ...days.map((day) => uploads(day) + day.test));
  const busiestDay = days.reduce<DayBucket | null>((best, day) => (best === null || uploads(day) > uploads(best) ? day : best), null);
  const busiestCount = busiestDay === null ? 0 : uploads(busiestDay);
  const hourPeak = Math.max(0, ...hours);
  const busiestHour = hours.indexOf(hourPeak);
  const withTests = days.some((day) => day.test > 0);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-uploads-often>
      <figure className="m-0 flex min-w-0 flex-col gap-2">
        <figcaption className="text-[13px] text-foreground">
          {busiestCount === 0 || busiestDay === null ? t(`${o}.noDay`) : t(`${o}.busiestDay`, { day: dayLabel(busiestDay.day), count: busiestCount })}
        </figcaption>
        <div className="flex h-24 min-w-0 items-end gap-px" role="img" aria-label={t(`${o}.daysLabel`, { count: days.length })}>
          {days.map((day) => (
            <span
              key={day.day}
              className={cn('flex h-full min-w-0 flex-1 flex-col-reverse gap-px rounded-sm', day.today && 'bg-muted')}
              title={t(day.test > 0 ? `${o}.dayTitleTests` : `${o}.dayTitle`, { day: dayLabel(day.day), clean: day.clean, hiccup: day.hiccup, test: day.test })}
              data-uploads-day={day.day}
              data-today={day.today || undefined}
            >
              {PARTS.map((part) => day[part.key] > 0 && (
                <span key={part.key} data-tone={part.tone} className="w-full rounded-[1px] bg-tone-dot" style={{ height: `${(day[part.key] / dayPeak) * 100}%` }} />
              ))}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{days.length > 0 ? dayLabel(days[0].day) : ''}</span>
          <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {PARTS.filter((part) => part.key !== 'test' || withTests).map((part) => (
              <span key={part.key} className="inline-flex items-center gap-1.5">
                <span data-tone={part.tone} className="h-2 w-2 rounded-[1px] bg-tone-dot" aria-hidden="true" />
                {t(`${o}.legend.${part.key}`)}
              </span>
            ))}
          </span>
          <span className="font-medium text-foreground">{t(`${o}.today`)}</span>
        </div>
      </figure>

      <figure className="m-0 flex min-w-0 flex-col gap-2">
        <figcaption className="text-[13px] text-foreground">
          {hourPeak === 0 ? t(`${o}.noHour`) : t(`${o}.busiestHour`, { hour: hourLabel(busiestHour), count: hourPeak })}
        </figcaption>
        <div className="grid min-w-0 grid-cols-[repeat(24,minmax(0,1fr))] gap-px" role="img" aria-label={t(`${o}.hoursLabel`)} data-tone="info">
          {hours.map((count, hour) => (
            <span key={hour} className="relative h-5 overflow-hidden rounded-sm bg-muted" title={t(`${o}.hourTitle`, { hour: hourLabel(hour), count })} data-uploads-hour={hour}>
              {/* The fill's strength is the hour's share of the busiest hour, never below a fifth, so one press still shows. */}
              {count > 0 && <span className="absolute inset-0 bg-tone-dot" style={{ opacity: 0.2 + 0.8 * (count / hourPeak) }} />}
            </span>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-[repeat(24,minmax(0,1fr))] gap-px text-xs text-muted-foreground" aria-hidden="true">
          {HOUR_MARKS.map((hour) => (
            <span key={hour} className="col-span-6 whitespace-nowrap">{hourLabel(hour)}</span>
          ))}
        </div>
      </figure>
    </div>
  );
}
