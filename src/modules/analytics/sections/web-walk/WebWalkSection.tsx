import { useTranslation } from 'react-i18next';

import type { WebWalkAnalytics, WebWalkApp,
  WebWalkAutocorrect, WebWalkCheck, WebWalkDay, WebWalkDoors, WebWalkSettled, WebWalkTotals } from '@/shared/analytics-types';
import { Banner, EmptyState } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { AnalyticsSectionFrame } from '@/modules/analytics/AnalyticsSectionFrame';
import { useAnalyticsSection } from '@/modules/analytics/hooks/useAnalyticsSection';
import { WebWalkApps } from '@/modules/analytics/sections/web-walk/WebWalkApps';
import { WebWalkChecks } from '@/modules/analytics/sections/web-walk/WebWalkChecks';
import { WebWalkGlance } from '@/modules/analytics/sections/web-walk/WebWalkGlance';
import { WebWalkTrend } from '@/modules/analytics/sections/web-walk/WebWalkTrend';
import { daysCovered } from '@/modules/analytics/sections/web-walk/webWalkFigures';

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
  const { reading, refresh } = useAnalyticsSection<WebWalkAnalytics>('web-walk', days, narrow);

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

/**
 * The answer as the route carried it, checked key by key at the top: a key missing or of another type is no answer.
 * The rows are carried as the command printed them: the server's reader narrowed the same keys, and the command is the
 * one writer of their shape.
 */
function narrow(data: unknown): WebWalkAnalytics | null {
  if (!isRecord(data)) return null;
  const { days, generated_at, today, first_day, settled, totals, series, checks, doors, apps, autocorrect } = data;
  if (typeof days !== 'number' || typeof generated_at !== 'number' || typeof today !== 'string') return null;
  const firstDay = typeof first_day === 'string' ? first_day : null;
  if (first_day !== null && firstDay === null) return null;
  if (!isSettled(settled) || !isFigures<WebWalkTotals>(totals) || !isFigures<WebWalkDoors>(doors)) return null;
  if (!isList<WebWalkDay>(series) || !isList<WebWalkCheck>(checks) || !isList<WebWalkApp>(apps)) return null;
  if (!isAutocorrect(autocorrect)) return null;
  return { days, generated_at, today, first_day: firstDay, settled, totals, series, checks, doors, apps, autocorrect };
}

/** Autocorrect's two lists, their rows taken as the command printed them (see `narrow`). */
function isAutocorrect(value: unknown): value is WebWalkAutocorrect {
  return isRecord(value) && isList(value.corrected) && isList(value.refused);
}

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A list, its rows taken as the command printed them (see `narrow`). */
function isList<Row>(value: unknown): value is Row[] {
  return Array.isArray(value);
}

/** An object of counts: every value a number. */
function isFigures<Figures>(value: unknown): value is Figures {
  return isRecord(value) && Object.values(value).every((figure) => typeof figure === 'number');
}

function isSettled(value: unknown): value is WebWalkSettled {
  return isRecord(value) && typeof value.refusing === 'boolean' && isFigures<WebWalkSettled['bars']>(value.bars);
}
