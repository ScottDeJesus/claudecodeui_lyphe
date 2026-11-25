import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { RndReadingsAnalytics } from '@/shared/analytics-types';
import { EmptyState, Rule } from '@/shared/ui';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { useAnalyticsSection } from '@/modules/analytics/hooks/useAnalyticsSection';
import { narrowRndReadings, worseCountOf } from '@/modules/analytics/sections/rnd/rndReadingFigures';
import { RndFeatureRow } from '@/modules/analytics/sections/rnd/RndFeatureRow';

type RndReadingsSectionProps = {
  /** The panel's window. This section offers none: its numbers are read as they stand now. */
  days: number;
  /** The panel's own way to open another section, for a feature that has a tab of its own. */
  openSection: (id: string) => void;
};

/**
 * THE R&D SECTION OF THE ANALYTICS AREA: every feature adopted from R&D, and whether it is doing what its spike promised.
 * Its one read is GET /api/analytics/rnd, the answer of dispatcher rnd readings, and the frame draws the read's states
 * around it: reading, not answering, answered, and a newer answer on its way. A reading is taken when the section is
 * opened or refreshed, so the frame's line says how old the numbers are.
 *
 * AN ANSWER IS ONE LIST, the newest adoption first, as the dispatcher orders it, so a row is where it was last time.
 * The heading's end is the section's one figure: how many of the features read worse than their baseline, in the warn
 * gold, and only the count of features when none does, so a quiet section reads quiet.
 *
 * Nothing adopted yet says so and draws nothing else.
 */
export function RndReadingsSection({ days, openSection }: RndReadingsSectionProps) {
  const { reading, refresh } = useAnalyticsSection<RndReadingsAnalytics>('rnd', days, narrowRndReadings);

  return (
    <AnalyticsSectionFrame reading={reading} refresh={refresh} takenAt={(answer) => Date.parse(answer.generated_at) / 1000}>
      {(answer) => <RndReadingsAnswer answer={answer} openSection={openSection} />}
    </AnalyticsSectionFrame>
  );
}

/** The section as drawn from one answer: the frame's children. Rendered by the Body above, and by nothing else. */
function RndReadingsAnswer({ answer, openSection }: { answer: RndReadingsAnalytics; openSection: (id: string) => void }) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const { features } = answer;

  if (features.length === 0) {
    return <EmptyState title={t('analytics.rnd.empty.title')} message={t('analytics.rnd.empty.message')} />;
  }

  const total = features.length;
  const worse = worseCountOf(features);

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={headingId} data-rnd-readings>
      <Rule
        id={headingId}
        end={worse > 0 ? t('analytics.rnd.worse', { count: worse, total }) : t('analytics.rnd.count', { total })}
        endTone={worse > 0 ? 'warn' : undefined}
      >
        {t('analytics.rnd.title')}
      </Rule>
      <ul className="flex min-w-0 flex-col divide-y divide-border">
        {features.map((feature) => (
          <RndFeatureRow key={feature.candidate} feature={feature} onOpenSection={openSection} />
        ))}
      </ul>
    </section>
  );
}
