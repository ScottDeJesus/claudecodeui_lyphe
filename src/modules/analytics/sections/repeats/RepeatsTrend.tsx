import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RepeatsDay } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayChart, FoldChevron, Rule, SegmentedControl } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { busyDaysOf, charsWords, chartDaysOf, seriesTotalsOf, tickWordsOf } from '@/modules/analytics/sections/repeats/repeatsFigures';

type RepeatsTrendProps = {
  /** One row per day of the window. */
  series: RepeatsDay[];
  /** The window, in days. */
  days: number;
};

/** What the plot can draw: the characters written by hand, split by whether a family holds them; the programs; the launches. */
type RepeatsMeasure = 'chars' | 'programs' | 'launches';

/** The measures, in the control's order. Characters come first: they are what a family is weighed in. */
const MEASURES: RepeatsMeasure[] = ['chars', 'programs', 'launches'];

/**
 * THE WINDOW DAY BY DAY: IS THE HAND-WRITING GOING DOWN. It opens on characters, each day one column in two parts, the
 * characters a family holds on the line and the rest on top, so the share that a cure would remove is seen against the
 * whole. Programs and launches are one press away, each a single column a day.
 *
 * The plot is one image with one spoken sentence, so every day's four figures are also a table under it, folded shut on
 * arrival and holding only the days that had anything written.
 *
 * Rendered by RepeatsSection, last. Nothing else mounts it.
 */
export function RepeatsTrend({ series, days }: RepeatsTrendProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const tableId = useId();

  const [measure, onMeasure] = useState<RepeatsMeasure>('chars');
  const [tableOpen, setTableOpen] = useState(false);
  const onToggleTable = () => setTableOpen((open) => !open);

  const chartDays = chartDaysOf(series, measure);
  const seriesTotals = seriesTotalsOf(series, measure);
  const tickWords = tickWordsOf(measure);
  const busyDays = busyDaysOf(series);

  const split = measure === 'chars';
  const about = t('analytics.repeats.trend.about.' + measure);
  const dateOf = (day: string) => formatShortDate(day) ?? day;
  const count = (figure: number) => figure.toLocaleString();

  const columns: DataTableColumn<RepeatsDay>[] = [
    { key: 'day', label: t('analytics.repeats.trend.columns.day'), render: (day) => <span className="whitespace-nowrap">{dateOf(day.day)}</span> },
    { key: 'launches', label: t('analytics.repeats.trend.columns.launches'), align: 'end', render: (day) => <span className="tabular-nums">{count(day.launches_writing)}</span> },
    { key: 'programs', label: t('analytics.repeats.trend.columns.programs'), align: 'end', render: (day) => <span className="tabular-nums">{count(day.programs)}</span> },
    { key: 'chars', label: t('analytics.repeats.trend.columns.chars'), align: 'end', render: (day) => <span className="tabular-nums">{charsWords(day.chars)}</span> },
    { key: 'inFamilies', label: t('analytics.repeats.trend.columns.inFamilies'), align: 'end', render: (day) => <span className="tabular-nums">{charsWords(day.chars_in_families)}</span> },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-repeats-trend>
      <Rule id={headingId}>{t('analytics.repeats.trend.title')}</Rule>

      <div>
        <SegmentedControl
          label={t('analytics.repeats.trend.measure')}
          options={MEASURES.map((value) => ({ value, label: t('analytics.repeats.trend.measures.' + value) }))}
          value={measure}
          onChange={onMeasure}
        />
      </div>
      <p className="text-xs text-muted-foreground">{about}</p>

      <DayChart
        key={measure}
        form="columns"
        series={
          split
            ? [
                { label: t('analytics.repeats.trend.series.inFamilies'), total: seriesTotals[0], mark: 'ink' },
                { label: t('analytics.repeats.trend.series.rest'), total: seriesTotals[1], mark: 'pale' },
              ]
            : [{ label: t('analytics.repeats.trend.series.' + measure), total: seriesTotals[0], mark: 'ink' }]
        }
        days={chartDays}
        label={t('analytics.repeats.trend.plot', { about, days })}
        tickWords={tickWords}
        todayLabel={t('analytics.repeats.trend.today')}
      />

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.repeats.trend.quiet', { days })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start text-muted-foreground finger:h-11"
            aria-expanded={tableOpen}
            aria-controls={tableId}
            onClick={onToggleTable}
          >
            <FoldChevron collapsed={!tableOpen} />
            {t('analytics.repeats.trend.byDay')}
          </Button>
          <div id={tableId}>
            {tableOpen && (
              <div className="flex flex-col gap-2">
                <DataTable rows={busyDays} columns={columns} rowKey={(day) => day.day} label={t('analytics.repeats.trend.tableLabel')} />
                <p className="text-xs text-muted-foreground">{t('analytics.repeats.trend.quietLeftOut')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
