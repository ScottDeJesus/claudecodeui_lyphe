import { useTranslation } from 'react-i18next';

import type { RepeatsAnalytics } from '@/shared/analytics-types';
import { EmptyState } from '@/shared/ui';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { useAnalyticsSection } from '@/modules/analytics/hooks/useAnalyticsSection';
import { narrowRepeats } from '@/modules/analytics/sections/repeats/repeatsFigures';
import { RepeatsFamilies } from '@/modules/analytics/sections/repeats/RepeatsFamilies';
import { RepeatsGlance } from '@/modules/analytics/sections/repeats/RepeatsGlance';
import { RepeatsTrend } from '@/modules/analytics/sections/repeats/RepeatsTrend';

/**
 * THE REPEATS SECTION OF THE ANALYTICS AREA: the work launches keep writing by hand, read as families. Its one read is
 * `GET /api/analytics/repeats?days=N`, the answer of `heal-repeats reading`, and the frame draws the read's states around
 * it: reading, not answering, answered, and a newer answer on its way.
 *
 * AN ANSWER IS DRAWN IN THE ORDER IT IS ACTED ON. First the glance: how many families are raised and how much of the
 * hand-written work they hold. Then the families themselves, the largest first, each opening on what it is and what
 * already does it, because a raised family is the thing to cure. Last the days, for whether it is getting better.
 *
 * A window with no launch read says so and draws nothing else. A window with launches and no family keeps the glance and
 * the days, which are true without one, and the families' place says that none has formed yet.
 */
export function RepeatsSection({ days }: { days: number }) {
  const { reading, refresh } = useAnalyticsSection<RepeatsAnalytics>('repeats', days, narrowRepeats);

  return (
    <AnalyticsSectionFrame reading={reading} refresh={refresh} takenAt={(answer) => answer.generated_at}>
      {(answer) => <RepeatsAnswer answer={answer} />}
    </AnalyticsSectionFrame>
  );
}

/** The section as drawn from one answer: the frame's children, spaced by the frame. Rendered by the Body above, and by nothing else. */
function RepeatsAnswer({ answer }: { answer: RepeatsAnalytics }) {
  const { t } = useTranslation('common');
  const { days, families, totals, steps, series, thresholds } = answer;

  if (totals.launches === 0) {
    return <EmptyState title={t('analytics.repeats.empty.title', { days })} message={t('analytics.repeats.empty.message')} />;
  }

  return (
    <>
      <RepeatsGlance families={families} totals={totals} steps={steps} series={series} days={days} />
      <RepeatsFamilies families={families} thresholds={thresholds} windowDays={answer.window_days} days={days} />
      <RepeatsTrend series={series} days={days} />
    </>
  );
}
