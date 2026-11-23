import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkDay, WebWalkTotals } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayChart, FoldChevron, Rule } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { launchDays, shareWords } from '@/modules/analytics/sections/web-walk/webWalkFigures';
import type { LaunchDay, WalkSpan } from '@/modules/analytics/sections/web-walk/webWalkFigures';

type WebWalkTrendProps = {
  /** One row per day that held a walk or a launch by hand. */
  series: WebWalkDay[];
  /** The window's sums: the legend's two totals. */
  totals: WebWalkTotals;
  /** The window as the answer states it. */
  span: WalkSpan;
};

/**
 * THE FALL, DAY BY DAY: each day's launches that drove a browser as one column, the ones on the helper on the baseline in
 * the full ink and the ones by hand over them in the pale. The legend says each side's count over the window, so the sums
 * are read as numbers.
 *
 * THE DAYS AS A TABLE ARE ONE PRESS AWAY, closed on arrival: the plot is one image with one spoken sentence, and the table
 * is where each day's two figures can be read exactly, by eye or by a screen reader. Days with no launch are left out of it.
 *
 * Rendered by WebWalkSection, second. Nothing else mounts it.
 */
export function WebWalkTrend({ series, totals, span }: WebWalkTrendProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const tableId = useId();
  // Closed on every mount: the plot is the answer.
  const [tableOpen, setTableOpen] = useState(false);
  const onToggleTable = () => setTableOpen((open) => !open);

  const above = t('analytics.webWalk.trend.walking');
  const below = t('analytics.webWalk.trend.byHand');
  const dateOf = (day: string) => formatShortDate(day) ?? day;

  const plotted = launchDays(series, span);
  const busyDays = plotted.filter((day) => day.walking + day.byHand > 0).reverse();

  const chartDays = plotted.map((day) => {
    const launches = day.walking + day.byHand;
    const share = shareWords(day.walking, launches);
    return {
      day: day.day,
      values: [day.walking, day.byHand],
      figures: [day.walking.toLocaleString(), day.byHand.toLocaleString()],
      note: share === null ? undefined : t('analytics.webWalk.trend.shareOfDay', { share: t(share.key, share.values), count: launches }),
    };
  });

  const columns: DataTableColumn<LaunchDay>[] = [
    { key: 'day', label: t('analytics.webWalk.trend.columns.day'), render: (day) => <span className="whitespace-nowrap">{dateOf(day.day)}</span> },
    { key: 'walking', label: above, align: 'end', render: (day) => <span className="tabular-nums">{day.walking.toLocaleString()}</span> },
    { key: 'byHand', label: below, align: 'end', render: (day) => <span className="tabular-nums">{day.byHand.toLocaleString()}</span> },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-web-walk-trend>
      <Rule id={headingId}>{t('analytics.webWalk.trend.title')}</Rule>
      <p className="text-xs text-muted-foreground">{t('analytics.webWalk.trend.about')}</p>

      <DayChart
        form="columns"
        series={[
          { label: above, total: totals.launches_walking.toLocaleString(), mark: 'ink' },
          { label: below, total: totals.launches_by_hand.toLocaleString(), mark: 'pale' },
        ]}
        days={chartDays}
        label={t('analytics.webWalk.trend.plot', { days: span.days })}
        tickWords={(value) => value.toLocaleString()}
        todayLabel={t('analytics.webWalk.trend.today')}
      />

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.webWalk.trend.quiet', { days: span.days })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="ghost" size="sm" className="-ml-3 self-start text-muted-foreground finger:h-11" aria-expanded={tableOpen} aria-controls={tableId} onClick={onToggleTable}>
            <FoldChevron collapsed={!tableOpen} />
            {t('analytics.webWalk.trend.byDay')}
          </Button>
          <div id={tableId}>
            {tableOpen && (
              <div className="flex max-w-xl flex-col gap-2">
                <DataTable rows={busyDays} columns={columns} rowKey={(day) => day.day} label={t('analytics.webWalk.trend.tableLabel', { days: span.days })} />
                <p className="text-xs text-muted-foreground">{t('analytics.webWalk.trend.quietLeftOut')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
