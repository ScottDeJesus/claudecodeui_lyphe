import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatsAnalytics } from '@/shared/analytics-types';
import { Readout, Rule } from '@/shared/ui';
import { charsWords, dayLine, raisedCountOf, shareLineOf, shareWordsOf } from '@/modules/analytics/sections/repeats/repeatsFigures';

type RepeatsGlanceProps = {
  /** Every family found, raised or not. */
  families: RepeatsAnalytics['families'];
  /** The window's sums. */
  totals: RepeatsAnalytics['totals'];
  /** The custom steps the shared helpers sent. */
  steps: RepeatsAnalytics['steps'];
  /** The days, for each figure's line. */
  series: RepeatsAnalytics['series'];
  /** The window, in days. */
  days: number;
};

/**
 * THE SECTION'S FIRST ANSWER: IS THERE REPEATED WORK TO CURE, AND HOW MUCH. The large figure is the families raised, the
 * ones waiting in the heal tab; it wears the warn gold only while there is one, so a quiet window reads quiet. Beside it
 * stand the figures it is measured against: the launches that wrote by hand, the characters a family already names, their
 * share of everything written by hand, and the custom steps the shared helpers kept.
 *
 * Every figure says what it is counted against in its note, and the three that have days draw them as a line.
 *
 * Rendered by RepeatsSection, first. Nothing else mounts it.
 */
export function RepeatsGlance({ families, totals, steps, series, days }: RepeatsGlanceProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const count = (figure: number) => figure.toLocaleString();
  const unknownLabel = t('analytics.repeats.unknown');
  const found = families.length;

  const raisedCount = raisedCountOf(families);
  const charsInFamilies = charsWords(totals.chars_in_families);
  const charsByHand = charsWords(totals.chars);
  const share = shareWordsOf(totals);
  const launchesLine = dayLine(series, 'launches_writing');
  const charsLine = dayLine(series, 'chars_in_families');
  const shareLine = shareLineOf(series);

  const raisedNote =
    raisedCount > 0
      ? t('analytics.repeats.glance.raisedNote', { found: count(found) })
      : found > 0
        ? t('analytics.repeats.glance.raisedNone', { found: count(found) })
        : t('analytics.repeats.glance.raisedNoFamily');

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={headingId} data-repeats-glance>
      <Rule id={headingId}>{t('analytics.repeats.glance.title', { days })}</Rule>

      <div className="grid grid-cols-2 items-start gap-x-6 gap-y-7 lg:grid-cols-5 lg:gap-x-8">
        <div className="col-span-2 min-w-0 lg:col-span-1" data-repeats-glance-raised>
          <Readout
            size="lg"
            label={t('analytics.repeats.glance.raised')}
            value={raisedCount}
            tone={raisedCount > 0 ? 'warn' : undefined}
            note={raisedNote}
            unknownLabel={unknownLabel}
          />
        </div>

        <Readout
          label={t('analytics.repeats.glance.launches')}
          value={totals.launches_writing}
          note={t('analytics.repeats.glance.launchesNote', { count: totals.programs, all: count(totals.launches), programs: count(totals.programs) })}
          trend={launchesLine}
          unknownLabel={unknownLabel}
        />
        <Readout
          label={t('analytics.repeats.glance.chars')}
          value={charsInFamilies}
          note={t('analytics.repeats.glance.charsNote')}
          trend={charsLine}
          unknownLabel={unknownLabel}
        />
        <Readout
          label={t('analytics.repeats.glance.share')}
          value={share}
          note={t('analytics.repeats.glance.shareNote', { all: charsByHand })}
          trend={shareLine}
          unknownLabel={unknownLabel}
        />
        <Readout
          label={t('analytics.repeats.glance.steps')}
          value={steps.uses}
          note={
            steps.uses > 0
              ? t('analytics.repeats.glance.stepsNote', { count: steps.launches, worked: count(steps.worked), launches: count(steps.launches) })
              : t('analytics.repeats.glance.stepsNone')
          }
          unknownLabel={unknownLabel}
        />
      </div>
    </section>
  );
}
