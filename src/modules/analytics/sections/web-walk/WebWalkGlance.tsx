import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkDoors, WebWalkSettled, WebWalkTotals } from '@/shared/analytics-types';
import { Readout, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { shareWords, sinceDay } from '@/modules/analytics/sections/web-walk/webWalkFigures';

type WebWalkGlanceProps = {
  /** The window's sums. */
  totals: WebWalkTotals;
  /** The walks by the door they came through. */
  doors: WebWalkDoors;
  /** The nudge's verdict, over its own window. */
  settled: WebWalkSettled;
  /** The window, for the heading. */
  days: number;
};

/**
 * THE SECTION'S ANSWER AT A GLANCE. The share of launches on the helper is the one large number, first and widest on a
 * phone; beside it the two counts it is made of, then how much walking that was and how often a walk needed a step of its
 * own. Every figure says what it is measured against in its note, and no figure carries a line of its own: the days are
 * the plot's, right under.
 *
 * UNDER THE FIGURES, THE NUDGE: whether a browser program written by hand is only warned about or refused, and the bars
 * that decide it with where each stands. It is counted over the nudge's own days, which the line says, since they are not
 * the window's.
 *
 * Rendered by WebWalkSection, first. Nothing else mounts it.
 */
export function WebWalkGlance({ totals, doors, settled, days }: WebWalkGlanceProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const unknown = t('analytics.webWalk.unknown');
  const launches = totals.launches_walking + totals.launches_by_hand;
  const share = shareWords(totals.launches_walking, launches);

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={headingId} data-web-walk-glance>
      <Rule id={headingId}>{t('analytics.webWalk.glance.title', { days })}</Rule>

      <div className="grid grid-cols-2 items-start gap-x-6 gap-y-7 lg:grid-cols-5 lg:gap-x-8">
        <div className="col-span-2 min-w-0 lg:col-span-1" data-web-walk-glance-share>
          <Readout
            size="lg"
            label={t('analytics.webWalk.glance.share')}
            value={share === null ? null : t(share.key, share.values)}
            note={t('analytics.webWalk.glance.shareNote', { walking: totals.launches_walking.toLocaleString(), count: launches })}
            unknownLabel={unknown}
          />
        </div>
        <Readout label={t('analytics.webWalk.glance.walking')} value={totals.launches_walking} note={t('analytics.webWalk.glance.walkingNote')} unknownLabel={unknown} />
        <Readout label={t('analytics.webWalk.glance.byHand')} value={totals.launches_by_hand} note={t('analytics.webWalk.glance.byHandNote')} unknownLabel={unknown} />
        <Readout
          label={t('analytics.webWalk.glance.walks')}
          value={totals.walks}
          note={t('analytics.webWalk.glance.walksNote', { execute: doors.execute.toLocaleString(), command: doors.command.toLocaleString() })}
          unknownLabel={unknown}
        />
        <Readout
          label={t('analytics.webWalk.glance.customSteps')}
          value={totals.custom_steps}
          note={t('analytics.webWalk.glance.customStepsNote', { walks: totals.walks_with_custom.toLocaleString(), total: totals.walks.toLocaleString() })}
          unknownLabel={unknown}
        />
      </div>

      <WebWalkNudge settled={settled} />
    </section>
  );
}

/** The nudge's state in one sentence, and under it the bars it is held to with where each stands now. */
function WebWalkNudge({ settled }: { settled: WebWalkSettled }) {
  const { t } = useTranslation('common');
  const { bars } = settled;
  const launches = settled.launches_walking + settled.launches_by_hand;
  const share = (part: number, whole: number) => {
    const words = shareWords(part, whole);
    return words === null ? t('analytics.webWalk.nudge.none') : t(words.key, words.values);
  };
  const since = settled.since === null ? null : sinceDay(settled.since);
  const standing = {
    windowDays: settled.window_days,
    launches: launches.toLocaleString(),
    minLaunches: bars.min_launches.toLocaleString(),
    share: share(settled.launches_walking, launches),
    minShare: share(bars.share, 1),
    walks: settled.walks.toLocaleString(),
    minWalks: bars.min_walks.toLocaleString(),
    faults: share(settled.faults, settled.walks),
    maxFaults: share(bars.fault_share, 1),
    releaseWalks: bars.release_min_walks.toLocaleString(),
    releaseFaults: share(bars.release_fault_share, 1),
  };

  return (
    <div className="flex flex-col gap-1" data-web-walk-nudge={settled.refusing ? 'refusing' : 'warning'}>
      <p className="text-sm font-medium text-foreground">
        {settled.refusing
          ? since === null
            ? t('analytics.webWalk.nudge.refusing')
            : t('analytics.webWalk.nudge.refusingSince', { date: formatShortDate(since) ?? since })
          : t('analytics.webWalk.nudge.warning')}
      </p>
      <p className="text-xs text-muted-foreground">{settled.refusing ? t('analytics.webWalk.nudge.barsRefusing', standing) : t('analytics.webWalk.nudge.barsWarning', standing)}</p>
    </div>
  );
}
