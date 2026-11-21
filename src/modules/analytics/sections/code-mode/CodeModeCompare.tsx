import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { DataTable, Readout, Rule, SegmentedControl } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { difference, durationWords, pointsDifference, ratio, shareWords, tokenWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { Difference, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * WITH AGAINST WITHOUT: the section's answer, and the first thing on it.
 *
 * THE ANSWER IS FOUR READOUTS, over every kind together: of the median launch with Code Mode, how many ended ok, its
 * turns, its tokens and its time, each with the same figure without and the difference under it. They stand before
 * the table because a phone shows a table's first two columns and the answer is in its last four. A readout takes the
 * warn tone only when Code Mode is the worse way round.
 *
 * THE TABLE IS PAIRS: a row with Code Mode over the row without, so the two figures a reader compares are one line
 * apart. The first pair is every kind together, then each kind across its models. EACH MODEL is one press away: a
 * kind's models triple the table, and across models is the question most visits ask; asked for, a model's pair stands
 * under its kind's, its name in the mono face and broken at its hyphens when the column is narrow, and set in from a
 * tablet's width up: a phone's first column has no room for the step, and the mono face marks the pair there.
 *
 * THE DIFFERENCE STANDS UNDER THE FIGURE IT QUALIFIES, on the Code Mode row only: a signed share of the figure
 * without. Ended ok is a rate, and beside two percentages a reader subtracts: its difference is said in points
 * ("+10 pts"), never as a share of a share. Either is drawn quiet. Only the worse way round (more turns, more tokens,
 * more time, fewer ended ok) takes the warn ink and weight, so a table of good news is a calm one and the row to look
 * at is the one that stands out; the sign carries the direction where the ink cannot.
 *
 * MEDIAN OR TOTAL is one switch over the four measured columns. A total follows how many launches ran, so under Total
 * only the share that ended ok is compared, and the line beside the switches says so.
 *
 * A pair with one side only (a kind that never ran without Code Mode) draws that row and no difference.
 */

type CodeModeCompareProps = {
  /** The kinds the verb counts, in its order: the order of the pairs. */
  kinds: CodeModeKind[];
  /** One row per (kind, code_mode, model). */
  groups: CodeModeGroup[];
  /** The same across models (`model` null), and across kinds as well (`kind` null too). */
  rollups: CodeModeGroup[];
};

type Mode = 'median' | 'total';
type Models = 'together' | 'each';

type CompareRow = {
  key: string;
  /** Whose pair this is: a kind's label, or a model's name under its kind. */
  who: string;
  /** A model's pair stands set in under its kind's. */
  inset: boolean;
  /** The pair's first row names it; its second leaves the name to the eye and says it aloud only. */
  first: boolean;
  row: CodeModeGroup;
  /** The same launches without Code Mode: what a Code Mode row's figures are measured against. Null on a row without, and on a pair with no such row. */
  against: CodeModeGroup | null;
};

/** One pair as its rows: with Code Mode first, then without. */
function pairRows(who: string, inset: boolean, pair: CodeModeGroup[]): CompareRow[] {
  const withRow = pair.find((row) => row.code_mode) ?? null;
  const withoutRow = pair.find((row) => !row.code_mode) ?? null;
  const rows: CompareRow[] = [];
  if (withRow !== null) rows.push({ key: JSON.stringify([withRow.kind, withRow.model, true]), who, inset, first: true, row: withRow, against: withoutRow });
  if (withoutRow !== null) rows.push({ key: JSON.stringify([withoutRow.kind, withoutRow.model, false]), who, inset, first: withRow === null, row: withoutRow, against: null });
  return rows;
}

/** A figure, and under it how far it is from the same figure without. */
function Figure({ words, change, against }: { words: string; change: { words: string; worse: boolean } | null; against: string }) {
  return (
    <span className="inline-flex flex-col items-end whitespace-nowrap tabular-nums">
      <span>{words}</span>
      {change !== null && (
        <span className={cn('text-xs', change.worse ? 'font-medium text-[var(--warn-ink)]' : 'text-muted-foreground')}>
          {change.words}
          <span className="sr-only"> {against}</span>
        </span>
      )}
    </span>
  );
}

/** Rendered by CodeModeSection, first. Nothing else mounts it. */
export function CodeModeCompare({ kinds, groups, rollups }: CodeModeCompareProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  // FILL: onModeChange — Median or Total, held here for the visit.
  const [mode, setMode] = useState<Mode>('median');
  // FILL: onModelsChange — every model together, or each model's pair under its kind's; together on arrival, held here for the visit.
  const [models, setModels] = useState<Models>('together');
  const totals = mode === 'total';

  const say = (words: Worded | null) => (words === null ? '' : t(words.key, words.values));
  const changed = (change: Difference | null) => (change === null ? null : { words: say(change.words), worse: change.worse });
  const count = (figure: number) => figure.toLocaleString();
  const against = t('analytics.codeMode.compare.against');

  const across = (kind: string | null) => rollups.filter((row) => row.kind === kind && row.model === null);
  const withAll = across(null).find((row) => row.code_mode) ?? null;
  const withoutAll = across(null).find((row) => !row.code_mode) ?? null;

  /** One readout of the answer: the figure with Code Mode, and under it the figure without and the difference. */
  const headline = (key: string, pick: (row: CodeModeGroup) => number | null, wordsOf: (figure: number) => string, compare: (withFigure: number | null, withoutFigure: number | null) => Difference | null) => {
    if (withAll === null) return null;
    const figure = pick(withAll);
    const base = withoutAll === null ? null : pick(withoutAll);
    const change = compare(figure, base);
    const note =
      base === null
        ? t('analytics.codeMode.compare.noteAlone')
        : change === null
          ? t('analytics.codeMode.compare.noteWithout', { without: wordsOf(base) })
          : t('analytics.codeMode.compare.noteAgainst', { without: wordsOf(base), change: say(change.words) });
    return (
      <Readout
        label={t('analytics.codeMode.compare.headline.' + key)}
        value={figure === null ? null : wordsOf(figure)}
        tone={change?.worse ? 'warn' : undefined}
        note={note}
        unknownLabel={t('analytics.codeMode.unknown')}
      />
    );
  };

  const rows: CompareRow[] = [
    ...pairRows(t('analytics.codeMode.allKinds'), false, across(null)),
    ...kinds.flatMap((kind) => {
      const ofKind = groups.filter((row) => row.kind === kind.kind);
      const named = models === 'each' ? Array.from(new Set(ofKind.map((row) => row.model ?? ''))) : [];
      return [
        ...pairRows(kind.label, false, across(kind.kind)),
        ...named.flatMap((model) =>
          pairRows(model === '' ? t('analytics.codeMode.compare.noModel') : model, true, ofKind.filter((row) => (row.model ?? '') === model)),
        ),
      ];
    }),
  ];

  /** A measured column: the median launch, or the sum under Total, with the difference under a Code Mode median. */
  const measured = (key: string, median: (row: CodeModeGroup) => number, sum: (row: CodeModeGroup) => number, wordsOf: (figure: number) => string): DataTableColumn<CompareRow> => ({
    key,
    label: t('analytics.codeMode.compare.columns.' + key),
    align: 'end',
    render: (entry) => (
      <Figure
        words={wordsOf(totals ? sum(entry.row) : median(entry.row))}
        change={totals || entry.against === null ? null : changed(difference(median(entry.row), median(entry.against)))}
        against={against}
      />
    ),
  });

  const columns: DataTableColumn<CompareRow>[] = [
    {
      key: 'who',
      label: t('analytics.codeMode.compare.columns.who'),
      render: ({ who, inset, first, row }) => (
        <span className={cn('flex flex-col', inset && 'sm:pl-3')}>
          {first ? <span className={inset ? 'break-words font-mono text-xs text-foreground' : 'font-medium text-foreground'}>{who}</span> : <span className="sr-only">{who}</span>}
          <span className="whitespace-nowrap text-xs text-muted-foreground">{t(row.code_mode ? 'analytics.codeMode.compare.with' : 'analytics.codeMode.compare.without')}</span>
        </span>
      ),
    },
    {
      key: 'launches',
      label: t('analytics.codeMode.compare.columns.launches'),
      align: 'end',
      render: ({ row }) => <span className="tabular-nums">{count(row.launches)}</span>,
    },
    {
      key: 'ok',
      label: t('analytics.codeMode.compare.columns.ok'),
      align: 'end',
      render: (entry) => (
        <Figure
          words={t('analytics.codeMode.compare.ok', { ok: count(entry.row.ok), share: say(shareWords(entry.row.ok, entry.row.launches)) })}
          change={
            entry.against === null
              ? null
              : changed(pointsDifference(ratio(entry.row.ok, entry.row.launches), ratio(entry.against.ok, entry.against.launches)))
          }
          against={against}
        />
      ),
    },
    measured('turns', (row) => row.turns, (row) => row.turns_total, count),
    measured('tokensIn', (row) => row.tokens_in, (row) => row.tokens_in_total, (figure) => say(tokenWords(figure))),
    measured('tokensOut', (row) => row.tokens_out, (row) => row.tokens_out_total, (figure) => say(tokenWords(figure))),
    measured('time', (row) => row.seconds, (row) => row.seconds_total, (figure) => say(durationWords(figure))),
  ];

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-compare>
      <Rule id={headingId}>{t('analytics.codeMode.compare.title')}</Rule>

      <p className="text-sm text-muted-foreground">
        {withAll === null
          ? t('analytics.codeMode.compare.leadOnlyWithout', { without: count(withoutAll?.launches ?? 0) })
          : withoutAll === null
            ? t('analytics.codeMode.compare.leadOnlyWith', { with: count(withAll.launches) })
            : t('analytics.codeMode.compare.lead', { with: count(withAll.launches), without: count(withoutAll.launches) })}
      </p>
      {withAll !== null && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
          {headline('ok', (row) => ratio(row.ok, row.launches), (share) => say(shareWords(share, 1)), pointsDifference)}
          {headline('turns', (row) => row.turns, count, difference)}
          {headline('tokens', (row) => row.tokens, (figure) => say(tokenWords(figure)), difference)}
          {headline('time', (row) => row.seconds, (figure) => say(durationWords(figure)), difference)}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label={t('analytics.codeMode.compare.mode')}
          options={[
            { value: 'median', label: t('analytics.codeMode.compare.median') },
            { value: 'total', label: t('analytics.codeMode.compare.total') },
          ]}
          value={mode}
          onChange={setMode}
        />
        <SegmentedControl
          label={t('analytics.codeMode.compare.models')}
          options={[
            { value: 'together', label: t('analytics.codeMode.compare.modelsTogether') },
            { value: 'each', label: t('analytics.codeMode.compare.modelsEach') },
          ]}
          value={models}
          onChange={setModels}
        />
        <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
          {t(totals ? 'analytics.codeMode.compare.totalAbout' : 'analytics.codeMode.compare.medianAbout')}
        </p>
      </div>

      <DataTable rows={rows} columns={columns} rowKey={(row) => row.key} label={t('analytics.codeMode.compare.tableLabel')} />
    </section>
  );
}
