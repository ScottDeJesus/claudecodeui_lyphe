import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeDay, CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';
import type { DataTableColumn, Tone } from '@/shared/types';
import { Button, CardFoldBody, Collapsible, DataTable, DayChart, FoldChevron, Rule, ShareBar } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { dayList, shareWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { TrendSpan, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * HOW THE SCRIPTS FARED, AND WHEN THEY WENT WRONG, over the launches that ran with Code Mode, for the kind the page is
 * showing. Two charts side by side.
 *
 * THE SCRIPTS: how many were run stands at the rule's end, and under it the ways a script goes wrong as bars against the
 * commonest of them, in the warn gold — it threw (and how many of those timed out), it was sent again, an action of it was
 * refused or failed — each with its count and its share of the scripts; then what the merger did with the edits handed to
 * it, as shares of those edits: merged in the finished green, declined in the ink. The line under them says what the
 * short ones count.
 *
 * THE FAILURES EACH DAY: the scripts that threw and the actions refused or failed, one gold column a day on the kit's
 * DayChart, their total at the rule's end in the warn ink; a pointed day splits them.
 *
 * BY KIND is the same counts as a table, a kind a row, in the verb's order, one press away. Those that timed out stand
 * under the count that threw. A zero is drawn in the quiet ink, so the cells that hold something are the ones the eye
 * finds.
 *
 * No launch with Code Mode in the window is one sentence under the heading, never an empty chart.
 */

type CodeModeOutcomesProps = {
  /** The kinds the verb counts, in its order. */
  kinds: CodeModeKind[];
  /** The Code Mode rollups across models: one per kind, and the one across kinds (`kind` null). */
  rollups: CodeModeGroup[];
  /** The days, for the failures each day. */
  series: CodeModeDay[];
  /** The kind the page is showing; null (or none given) is every kind. */
  kind?: string | null;
  /** That kind's label, or the words for every kind. */
  kindLabel?: string;
  /** The window as the answer states it. */
  span: TrendSpan;
};

type KindRow = { label: string; row: CodeModeGroup };

/** One bar of the list: its name (and a line under it), its length, and its figure with what it is a share of. */
type OutcomeBar = { key: string; name: string; under?: string; count: number; share: number; tone: Tone; figure: string; of: string };

/** Rendered by CodeModeSection, fourth. Nothing else mounts it. */
export function CodeModeOutcomes({ kinds, rollups, series, kind = null, kindLabel, span }: CodeModeOutcomesProps) {
  const { t } = useTranslation('common');
  const scriptsHeadingId = useId();
  const failuresHeadingId = useId();
  const tableId = useId();
  // Whether the table of kinds is open. Folded on every mount: the bars are the answer.
  const [tableOpen, setTableOpen] = useState(false);
  const all = rollups.find((row) => row.kind === kind) ?? null;
  const shownKind = kindLabel ?? t('analytics.codeMode.allKinds');

  if (all === null || all.launches === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={scriptsHeadingId} data-code-mode-outcomes>
        <Rule id={scriptsHeadingId}>{t('analytics.codeMode.outcomes.title')}</Rule>
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.outcomes.none', { days: span.days })}</p>
      </section>
    );
  }

  const say = (words: Worded | null) => (words === null ? '' : t(words.key, words.values));
  const count = (figure: number) => figure.toLocaleString();
  const share = (part: number, whole: number) => say(shareWords(part, whole));

  // The ways a script goes wrong, each against the commonest of them; then the merger's edits, each a share of those handed to it.
  const faults = [
    { key: 'thrown', count: all.thrown, under: all.timed_out > 0 ? t('analytics.codeMode.outcomes.timedOut', { timedOut: count(all.timed_out) }) : undefined },
    { key: 'resent', count: all.resent },
    { key: 'refused', count: all.refused },
    { key: 'failed', count: all.failed },
  ];
  const commonest = Math.max(1, ...faults.map((fault) => fault.count));
  const bars: OutcomeBar[] = [
    ...faults.map((fault) => ({
      key: fault.key,
      name: t('analytics.codeMode.outcomes.' + fault.key),
      under: fault.under,
      count: fault.count,
      share: fault.count / commonest,
      tone: 'warn' as Tone,
      figure: count(fault.count),
      of: share(fault.count, all.scripts),
    })),
    ...[
      { key: 'mergesMerged', count: all.merges_merged, tone: 'positive' as Tone },
      { key: 'declined', count: all.declined, tone: 'neutral' as Tone },
    ].map((edit) => ({
      key: edit.key,
      name: t('analytics.codeMode.outcomes.' + edit.key),
      count: edit.count,
      share: all.merges_asked > 0 ? edit.count / all.merges_asked : 0,
      tone: edit.tone,
      figure: count(edit.count),
      of: all.merges_asked > 0 ? t('analytics.codeMode.outcomes.ofMerger', { whole: count(all.merges_asked) }) : '',
    })),
  ];

  // The failures each day: scripts that threw, and actions refused or failed.
  const failureDays = dayList(series, kind, 'failures', span).map((day) => {
    const [thrown, refusedOrFailed] = [day.figures[0] ?? 0, day.figures[1] ?? 0];
    return {
      day: day.day,
      values: [thrown + refusedOrFailed],
      figures: [count(thrown + refusedOrFailed)],
      note: t('analytics.codeMode.trend.failuresNote', { thrown: count(thrown), refusedOrFailed: count(refusedOrFailed) }),
    };
  });
  const failuresInAll = failureDays.reduce((sum, day) => sum + (day.values[0] ?? 0), 0);

  const perKind: KindRow[] = kinds.flatMap((entry) => {
    const row = rollups.find((each) => each.kind === entry.kind);
    return row === undefined ? [] : [{ label: entry.label, row }];
  });
  const cell = (figure: number) => <span className={cn('tabular-nums', figure === 0 && 'text-muted-foreground')}>{count(figure)}</span>;
  const counted = (key: string, pick: (row: CodeModeGroup) => number): DataTableColumn<KindRow> => ({
    key,
    label: t('analytics.codeMode.outcomes.columns.' + key),
    align: 'end',
    render: ({ row }) => cell(pick(row)),
  });
  const columns: DataTableColumn<KindRow>[] = [
    { key: 'kind', label: t('analytics.codeMode.outcomes.columns.kind'), render: ({ label }) => <span className="font-medium text-foreground">{label}</span> },
    counted('scripts', (row) => row.scripts),
    {
      key: 'thrown',
      label: t('analytics.codeMode.outcomes.columns.thrown'),
      align: 'end',
      render: ({ row }) =>
        row.thrown === 0 ? (
          cell(0)
        ) : (
          <span className="inline-flex flex-col items-end whitespace-nowrap">
            <span className="tabular-nums">
              {count(row.thrown)}
              <span className="ml-2 text-muted-foreground">{share(row.thrown, row.scripts)}</span>
            </span>
            {row.timed_out > 0 && <span className="text-xs text-muted-foreground">{t('analytics.codeMode.outcomes.timedOut', { timedOut: count(row.timed_out) })}</span>}
          </span>
        ),
    },
    counted('resent', (row) => row.resent),
    counted('refused', (row) => row.refused),
    counted('failed', (row) => row.failed),
    counted('mergesAsked', (row) => row.merges_asked),
    counted('mergesMerged', (row) => row.merges_merged),
    counted('declined', (row) => row.declined),
  ];

  return (
    <section className="flex min-w-0 flex-col gap-4" data-code-mode-outcomes>
      <div className="grid min-w-0 gap-x-10 gap-y-9 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3" role="region" aria-labelledby={scriptsHeadingId} data-code-mode-scripts>
          <Rule id={scriptsHeadingId} end={t('analytics.codeMode.outcomes.run', { scripts: count(all.scripts) })}>
            {t('analytics.codeMode.outcomes.title')}
          </Rule>
          <ul className="grid min-w-0 grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3">
            {bars.map((bar, index) => (
              <li key={bar.key} className={cn('col-span-3 grid grid-cols-subgrid items-center', index === faults.length && 'mt-3')}>
                <span className="flex min-w-0 flex-col text-sm text-foreground">
                  {bar.name}
                  {bar.under !== undefined && <span className="text-xs text-muted-foreground">{bar.under}</span>}
                </span>
                <ShareBar share={bar.share} tone={bar.tone} />
                <span className={cn('whitespace-nowrap text-right text-sm tabular-nums', bar.count === 0 ? 'text-muted-foreground' : 'text-foreground')}>
                  {bar.figure}
                  {bar.count > 0 && bar.of !== '' && <span className="ml-2 text-xs text-muted-foreground">{bar.of}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('analytics.codeMode.outcomes.about')}</p>
        </div>

        <div className="flex min-w-0 flex-col gap-3" role="region" aria-labelledby={failuresHeadingId} data-code-mode-failures>
          <Rule id={failuresHeadingId} end={failuresInAll > 0 ? count(failuresInAll) : undefined} endTone="warn">
            {t('analytics.codeMode.outcomes.failuresTitle')}
          </Rule>
          <DayChart
            key={kind ?? ''}
            form="columns"
            series={[{ label: t('analytics.codeMode.trend.measures.failures'), total: count(failuresInAll), mark: 'warn' }]}
            days={failureDays}
            label={t('analytics.codeMode.outcomes.failuresPlot', { kind: shownKind, days: span.days })}
            tickWords={(value) => value.toLocaleString()}
            todayLabel={t('analytics.codeMode.trend.today')}
          />
        </div>
      </div>

      <Collapsible open={tableOpen} onOpenChange={setTableOpen} className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 self-start text-muted-foreground finger:h-11"
          aria-expanded={tableOpen}
          aria-controls={tableId}
          onClick={() => setTableOpen((open) => !open)}
        >
          <FoldChevron collapsed={!tableOpen} />
          {t('analytics.codeMode.outcomes.byKindTable')}
        </Button>
        <CardFoldBody>
          <div id={tableId} className="pt-1">
            <DataTable rows={perKind} columns={columns} rowKey={(entry) => entry.row.kind ?? ''} label={t('analytics.codeMode.outcomes.tableLabel')} />
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}
