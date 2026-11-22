import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeDay, CodeModeKind } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayBars, FoldChevron, Rule, SegmentedControl, Select } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { dayList, measureWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { TrendDay, TrendMeasure, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * THE DAYS: with Code Mode above the rule and without hanging below it, on one scale, so a window where Code Mode
 * took over is top-heavy at a glance. One measure at a time (launches, turns, tokens, time), for every kind or one.
 *
 * FAILURES IS THE ONE MEASURE THAT IS NOT WITH AGAINST WITHOUT. It reads the Code Mode launches alone: scripts that
 * threw above the rule, actions refused or failed below it, and the upper series takes the warn ink. The line under
 * the two pickers always says what the bars are, and in what unit: tokens are drawn in thousands and time in minutes,
 * because the legend's totals are the bars' own sums.
 *
 * A BAR'S FIGURES ARE NEVER ONLY ITS TITLE (DayBars's own rule). Every day's two numbers are also a table, one press
 * away under the plot, newest first, as the Bugs dashboard draws its own. It lists the days that hold something and
 * says it left the quiet ones out. It is folded on arrival: the picture is the signal, the table the detail. Under
 * Failures its heads are the short names, so three columns never scroll sideways on a phone.
 *
 * A KIND WITH NOTHING IN THE WINDOW still draws its baseline, with the sentence that says so.
 */

type CodeModeTrendProps = {
  /** One row per (day, kind, code_mode) that held a launch, and per (day, code_mode) across kinds. */
  series: CodeModeDay[];
  /** The kinds the verb counts, in its order: the picker's rows after "All kinds". */
  kinds: CodeModeKind[];
  /** The history's first day, null while there is none. */
  firstDay: string | null;
  /** Today, as the box that answered names it. */
  today: string;
  /** The window, in days. */
  days: number;
};

const MEASURES: TrendMeasure[] = ['launches', 'turns', 'tokens', 'seconds', 'failures'];
/** The picker's value for every kind together. The wire spells that null; a `Select` holds strings. */
const ALL_KINDS = '*';

/** Rendered by CodeModeSection, last. Nothing else mounts it. */
export function CodeModeTrend({ series, kinds, firstDay, today, days }: CodeModeTrendProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const tableId = useId();
  // Which measure the plot draws, held here for the visit.
  const [measure, setMeasure] = useState<TrendMeasure>('launches');
  // Which kind the plot draws, every kind on arrival, held here for the visit.
  const [kind, setKind] = useState(ALL_KINDS);
  // Whether the day-by-day table is open. Closed on every mount: the plot is the answer.
  const [tableOpen, setTableOpen] = useState(false);

  const say = (words: Worded) => t(words.key, words.values);
  const dateOf = (day: string) => formatShortDate(day) ?? day;
  const failures = measure === 'failures';
  const above = t(failures ? 'analytics.codeMode.trend.thrown' : 'analytics.codeMode.with');
  const below = t(failures ? 'analytics.codeMode.trend.refusedOrFailed' : 'analytics.codeMode.without');
  const about = t('analytics.codeMode.trend.about.' + measure);
  const kindLabel = kind === ALL_KINDS ? t('analytics.codeMode.allKinds') : (kinds.find((entry) => entry.kind === kind)?.label ?? kind);

  const plotted = dayList(series, kind === ALL_KINDS ? null : kind, measure, { firstDay, today, days });
  const busyDays = plotted.filter((day) => day.figures[0] > 0 || day.figures[1] > 0).reverse();

  const columns: DataTableColumn<TrendDay>[] = [
    { key: 'day', label: t('analytics.codeMode.trend.columns.day'), render: (day) => <span className="whitespace-nowrap">{dateOf(day.day)}</span> },
    { key: 'above', label: failures ? t('analytics.codeMode.trend.columns.thrown') : above, align: 'end', render: (day) => <span className="tabular-nums">{say(measureWords(measure, day.figures[0]))}</span> },
    { key: 'below', label: failures ? t('analytics.codeMode.trend.columns.refusedOrFailed') : below, align: 'end', render: (day) => <span className="tabular-nums">{say(measureWords(measure, day.figures[1]))}</span> },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-trend>
      <Rule id={headingId}>{t('analytics.codeMode.trend.title')}</Rule>

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t('analytics.codeMode.trend.measure')}
          options={MEASURES.map((value) => ({ value, label: t('analytics.codeMode.trend.measures.' + value) }))}
          value={measure}
          onChange={setMeasure}
        />
        <Select
          ariaLabel={t('analytics.codeMode.trend.kind')}
          size="sm"
          options={[{ value: ALL_KINDS, label: t('analytics.codeMode.allKinds') }, ...kinds.map((entry) => ({ value: entry.kind, label: entry.label }))]}
          value={kind}
          onChange={setKind}
        />
      </div>
      <p className="text-xs text-muted-foreground">{about}</p>

      <DayBars
        label={t('analytics.codeMode.trend.plot', { about, kind: kindLabel, days })}
        series={[
          { label: above, tone: failures ? 'warn' : 'info' },
          { label: below, tone: 'neutral' },
        ]}
        days={plotted.map((day) => ({
          day: day.day,
          values: day.values,
          title: t('analytics.codeMode.trend.barTitle', {
            date: dateOf(day.day),
            above: say(measureWords(measure, day.figures[0])),
            aboveLabel: above,
            below: say(measureWords(measure, day.figures[1])),
            belowLabel: below,
          }),
        }))}
        peakLabel={(peak) => t('analytics.codeMode.trend.peak.' + measure, { peak: peak.toLocaleString() })}
      />

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.trend.quiet', { kind: kindLabel, days })}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 self-start text-muted-foreground finger:h-11"
            aria-expanded={tableOpen}
            aria-controls={tableId}
            onClick={() => setTableOpen((open) => !open)}
          >
            <FoldChevron collapsed={!tableOpen} />
            {t('analytics.codeMode.trend.byDay')}
          </Button>
          <div id={tableId}>
            {tableOpen && (
              <div className="flex flex-col gap-2">
                <DataTable
                  rows={busyDays}
                  columns={columns}
                  rowKey={(day) => day.day}
                  label={t('analytics.codeMode.trend.tableLabel', { measure: t('analytics.codeMode.trend.measures.' + measure), above, below })}
                />
                <p className="text-xs text-muted-foreground">{t('analytics.codeMode.trend.quietLeftOut')}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
