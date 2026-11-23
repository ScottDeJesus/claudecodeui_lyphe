import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeDay } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, DayChart, FoldChevron, Rule, SegmentedControl } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';
import { dayList, measureWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { TrendDay, TrendMeasure, TrendSpan, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * THE DAYS, for the kind the page is showing: one measure at a time, with against without, on a scale with its steps named.
 *
 * LAUNCHES ARE COLUMNS, Code Mode's standing on the zero in the full ink and without's on top of them in the pale one, so
 * a window where Code Mode took over is dark at the foot and a column's height is the day's every launch. THE OTHER
 * MEASURES ARE THE DAY'S OWN — the share that ended ok, and the median launch's turns, tokens and time — as two lines,
 * Code Mode's full and without's pale and dashed, each broken on a day its side had no launch. The line under the picker
 * says what the marks are. (The failures, which are not with against without, have a chart of their own beside how the
 * scripts fared.)
 *
 * A POINTED DAY SAYS ITS FIGURES on the chart's own card (a finger's tap, in its line), and a day's launches add the share
 * of them that ran with Code Mode.
 *
 * A MARK'S FIGURES ARE NEVER ONLY ITS PAINT (DayBars's rule, kept by DayChart). Every day's two numbers are also a table,
 * one press away under the plot, newest first. It lists the days that hold something and says it left the quiet ones out.
 * It is folded on arrival: the picture is the signal, the table the detail.
 *
 * A KIND WITH NOTHING IN THE WINDOW still draws its baseline, with the sentence that says so.
 */

type CodeModeTrendProps = {
  /** One row per (day, kind, code_mode) that held a launch, and per (day, code_mode) across kinds. */
  series: CodeModeDay[];
  /** The kind the page is showing; null is every kind. */
  kind: string | null;
  /** That kind's label, or the words for every kind. */
  kindLabel: string;
  /** The window as the answer states it. */
  span: TrendSpan;
};

/** The measures the picker offers: every one that is with against without. */
type DayMeasure = Exclude<TrendMeasure, 'failures'>;

const MEASURES: DayMeasure[] = ['launches', 'ok', 'turns', 'tokens', 'seconds'];
/** How many of a measure's own unit one step of the scale stands for: tokens are drawn in thousands, time in minutes. */
const PLOT_UNIT: Record<DayMeasure, number> = { launches: 1, ok: 1, turns: 1, tokens: 1000, seconds: 60 };
/** The share's scale ends at the whole. */
const WHOLE_SHARE = 1;

/** Rendered by CodeModeSection, second. Nothing else mounts it. */
export function CodeModeTrend({ series, kind, kindLabel, span }: CodeModeTrendProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const tableId = useId();
  // Which measure the plot draws, held here for the visit.
  const [measure, setMeasure] = useState<DayMeasure>('launches');
  // Whether the day-by-day table is open. Closed on every mount: the plot is the answer.
  const [tableOpen, setTableOpen] = useState(false);

  const say = (words: Worded) => t(words.key, words.values);
  const figureWords = (figure: number | null) => (figure === null ? null : say(measureWords(measure, figure)));
  const dateOf = (day: string) => formatShortDate(day) ?? day;
  const counted = measure === 'launches';
  const above = t('analytics.codeMode.with');
  const below = t('analytics.codeMode.without');
  const about = t('analytics.codeMode.trend.about.' + measure);

  const plotted = dayList(series, kind, measure, span);
  const busyDays = plotted.filter((day) => (counted ? (day.figures[0] ?? 0) + (day.figures[1] ?? 0) > 0 : day.figures[0] !== null || day.figures[1] !== null)).reverse();
  const total = (side: 0 | 1) => plotted.reduce((sum, day) => sum + (day.figures[side] ?? 0), 0);

  /** A tick of the scale in the measure's words: thousands of tokens, minutes, a share, or a count. */
  const tickWords = (value: number) => {
    if (value === 0) return '0';
    if (measure === 'tokens') return t('analytics.codeMode.units.thousand', { value: value.toLocaleString() });
    if (measure === 'seconds') return t('analytics.codeMode.units.minutesShort', { value: value.toLocaleString() });
    if (measure === 'ok') return t('analytics.codeMode.units.share', { value: Math.round(value * 100).toLocaleString() });
    return value.toLocaleString();
  };

  const chartDays = plotted.map((day) => {
    const [withFigure, withoutFigure] = day.figures;
    const launches = (withFigure ?? 0) + (withoutFigure ?? 0);
    return {
      day: day.day,
      values: day.figures.map((figure) => (figure === null ? null : figure / PLOT_UNIT[measure])),
      figures: [figureWords(withFigure), figureWords(withoutFigure)],
      note: counted && launches > 0 ? t('analytics.codeMode.trend.shareOfDay', { share: say(measureWords('ok', (withFigure ?? 0) / launches)), count: launches }) : undefined,
    };
  });

  const columns: DataTableColumn<TrendDay>[] = [
    { key: 'day', label: t('analytics.codeMode.trend.columns.day'), render: (day) => <span className="whitespace-nowrap">{dateOf(day.day)}</span> },
    { key: 'above', label: above, align: 'end', render: (day) => <span className="tabular-nums">{figureWords(day.figures[0]) ?? '—'}</span> },
    { key: 'below', label: below, align: 'end', render: (day) => <span className="tabular-nums">{figureWords(day.figures[1]) ?? '—'}</span> },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-trend>
      <Rule id={headingId}>{t('analytics.codeMode.trend.title')}</Rule>

      <div>
        <SegmentedControl
          label={t('analytics.codeMode.trend.measure')}
          options={MEASURES.map((value) => ({ value, label: t('analytics.codeMode.trend.measures.' + value) }))}
          value={measure}
          onChange={setMeasure}
        />
      </div>
      <p className="text-xs text-muted-foreground">{about}</p>

      <DayChart
        key={measure + '|' + (kind ?? '')}
        form={counted ? 'columns' : 'lines'}
        series={[
          { label: above, total: counted ? total(0).toLocaleString() : undefined, mark: 'ink' },
          { label: below, total: counted ? total(1).toLocaleString() : undefined, mark: 'pale' },
        ]}
        days={chartDays}
        label={t('analytics.codeMode.trend.plot', { about, kind: kindLabel, days: span.days })}
        tickWords={tickWords}
        ceiling={measure === 'ok' ? WHOLE_SHARE : undefined}
        todayLabel={t('analytics.codeMode.trend.today')}
      />

      {busyDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.trend.quiet', { kind: kindLabel, days: span.days })}</p>
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
