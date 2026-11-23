import { useTranslation } from 'react-i18next';

import type { WebWalkAnalytics } from '@/shared/analytics-types';
import { Banner, EmptyState } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { WebWalkApps } from '@/modules/analytics/sections/web-walk/WebWalkApps';
import { WebWalkChecks } from '@/modules/analytics/sections/web-walk/WebWalkChecks';
import { WebWalkGlance } from '@/modules/analytics/sections/web-walk/WebWalkGlance';
import { WebWalkTrend } from '@/modules/analytics/sections/web-walk/WebWalkTrend';
// FILL: fake — this import goes with the fake reading below.
import { FAKE_STATE, fakeReading } from '@/modules/analytics/sections/web-walk/webWalkFake';
import { daysCovered } from '@/modules/analytics/sections/web-walk/webWalkFigures';
import type { AnalyticsReading } from '@/modules/analytics/types';

/**
 * THE WEB WALKS SECTION: whether the house drives its running apps through the web-walk helper or still writes browser
 * programs by hand. The registry's Body for 'web-walk'; nothing else mounts it.
 *
 * ONE ANSWER FIRST: the share of browser-driving launches that went through the helper, the section's one large number.
 * Under it, in the order a reader asks: how many launches on each side and how much walking that was (WebWalkGlance, with
 * the nudge's state and the bars it is held to), how the two sides moved day by day (WebWalkTrend), what the premade
 * checks found (WebWalkChecks), and which apps and screens were walked, with the screens that were not reached
 * (WebWalkApps).
 *
 * THE FRAME DRAWS LOADING AND UNREACHABLE; this draws the rest: no history yet, a window with nothing in it, a history
 * younger than the window, and the full page.
 */
export function WebWalkSection({ days }: { days: number }) {
  // FILL: reading — the section's one read: useAnalyticsSection<WebWalkAnalytics>('web-walk', days, narrow), with a narrow that checks the answer key by key as CodeModeSection's does. It answers reading and refresh.
  const reading: AnalyticsReading<WebWalkAnalytics> = fakeReading(FAKE_STATE, days);
  const refresh = () => {
    // FILL: refresh — the read's own refresh: Try again's press when the route did not answer, Refresh's when it did.
  };

  return (
    <AnalyticsSectionFrame reading={reading} refresh={refresh} takenAt={(answer) => answer.generated_at}>
      {(answer) => <WebWalkAnswer answer={answer} />}
    </AnalyticsSectionFrame>
  );
}

/** The section as drawn from one answer: the frame's children, spaced by the frame. Rendered by the Body above, and by nothing else. */
function WebWalkAnswer({ answer }: { answer: WebWalkAnalytics }) {
  const { t } = useTranslation('common');
  const { days, totals, settled, series, checks, doors, apps } = answer;
  const span = { firstDay: answer.first_day, today: answer.today, days };
  const covered = daysCovered(span);
  const young = covered !== null && answer.first_day !== null;
  // Nothing drove a browser in the window, on the helper or by hand.
  const quiet = totals.walks === 0 && totals.launches_by_hand === 0;

  return (
    <>
      {/* FILL: sample — this notice goes with the fake reading, and its word analytics.webWalk.sample with it. */}
      <Banner tone="info">{t('analytics.webWalk.sample')}</Banner>

      {young && (
        <Banner tone="info">
          {t('analytics.webWalk.historyStarts', { date: formatShortDate(answer.first_day) ?? answer.first_day, count: covered, days })}
        </Banner>
      )}

      {quiet ? (
        answer.first_day === null ? (
          <EmptyState title={t('analytics.webWalk.empty.noHistoryTitle')} message={t('analytics.webWalk.empty.noHistoryMessage')} />
        ) : (
          <EmptyState title={t('analytics.webWalk.empty.title', { days })} message={t('analytics.webWalk.empty.message')} />
        )
      ) : (
        <>
          <WebWalkGlance totals={totals} doors={doors} settled={settled} days={days} />
          <WebWalkTrend series={series} totals={totals} span={span} />
          {/* Side by side on a wide desk, so what the checks found and where the walks went are read together. */}
          <div className="grid min-w-0 grid-cols-1 items-start gap-9 xl:grid-cols-2 xl:gap-8">
            <WebWalkChecks checks={checks} days={days} />
            <WebWalkApps apps={apps} days={days} />
          </div>
        </>
      )}
    </>
  );
}
