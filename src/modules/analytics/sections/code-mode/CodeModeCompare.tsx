import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';
import { modelMaterialOf } from '@/shared/modelLabels';
import type { DataTableColumn, Tone } from '@/shared/types';
import { Button, CardFoldBody, Collapsible, DataTable, Dumbbell, FoldChevron, Rule, SegmentedControl } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { difference, durationWords, modelLaunches, pointsDifference, ratio, shareWords, tokenWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { Difference, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * WITH AGAINST WITHOUT, ONE THING A ROW: by kind and by model, side by side, each on the kit's Dumbbell — the full dot with
 * Code Mode, the hollow ring without, and the bar between them the change.
 *
 * BY KIND is the median launch (turns, tokens, time) or the share that ended ok, every kind together first and then each
 * kind, the one the page is showing in the strong weight. BY MODEL is what adds up across kinds: the share that ended ok,
 * the launches each way, and the share of Code Mode's scripts that went wrong; each model in its chats' colour, for the
 * kind the page is showing. A model's median launch is never worked out here (the verb's are per kind); the table below
 * holds them.
 *
 * THE CHANGE STANDS AT A ROW'S END: a signed share of the figure without, or for a rate percentage points ("+10 pts"),
 * in the positive ink with its ✓ when Code Mode is the better way round and the warn ink with its ▲ when it is the worse.
 *
 * THE TABLE IS ONE PRESS AWAY: pairs, a row with Code Mode over the row without, every kind together and then each kind
 * across its models, each model's pair a second press away under the kind's; Median or Total over its four measured
 * columns. A total follows how many launches ran, so under Total only the share that ended ok is compared. It is drawn
 * folded, and kept, so the press opens it at once.
 *
 * A pair with one side only (a kind that never ran without Code Mode) draws that side and no change.
 */

type CodeModeCompareProps = {
  /** The kinds the verb counts, in its order: the order of the rows. */
  kinds: CodeModeKind[];
  /** One row per (kind, code_mode, model). */
  groups: CodeModeGroup[];
  /** The same across models (`model` null), and across kinds as well (`kind` null too). */
  rollups: CodeModeGroup[];
  /** The kind the page is showing; null (or none given) is every kind. */
  kind?: string | null;
};

type KindMeasure = 'turns' | 'tokens' | 'time' | 'ok';
type ModelMeasure = 'ok' | 'launches' | 'failures';
type Mode = 'median' | 'total';
type Models = 'together' | 'each';

const KIND_MEASURES: KindMeasure[] = ['turns', 'tokens', 'time', 'ok'];
const MODEL_MEASURES: ModelMeasure[] = ['ok', 'launches', 'failures'];
/** A share's scale ends at the whole. */
const WHOLE_SHARE = 1;
const SECONDS_PER_MINUTE = 60;

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

/** Rendered by CodeModeSection, third. Nothing else mounts it. */
export function CodeModeCompare({ kinds, groups, rollups, kind = null }: CodeModeCompareProps) {
  const { t } = useTranslation('common');
  const kindsHeadingId = useId();
  const modelsHeadingId = useId();
  const tableId = useId();
  // What the kinds are compared by, the median launch's turns on arrival; held here for the visit.
  const [kindMeasure, setKindMeasure] = useState<KindMeasure>('turns');
  // What the models are compared by, the share that ended ok on arrival; held here for the visit.
  const [modelMeasure, setModelMeasure] = useState<ModelMeasure>('ok');
  // Whether the table of pairs is open. Folded on every mount: the two charts are the answer.
  const [tableOpen, setTableOpen] = useState(false);
  // Median or Total in the table, held here for the visit.
  const [mode, setMode] = useState<Mode>('median');
  // Every model together, or each model's pair under its kind's; together on arrival, held here for the visit.
  const [models, setModels] = useState<Models>('together');
  const totals = mode === 'total';

  const say = (words: Worded | null) => (words === null ? '' : t(words.key, words.values));
  const changed = (change: Difference | null) => (change === null ? null : { words: say(change.words), worse: change.worse });
  const toneOf = (change: Difference | null): Tone | undefined => (change === null ? undefined : change.worse ? 'warn' : change.better ? 'positive' : 'neutral');
  const toChange = (change: Difference | null) => (change === null ? undefined : { words: say(change.words), tone: toneOf(change) });
  const count = (figure: number) => figure.toLocaleString();
  const share = (rate: number) => say(shareWords(rate, WHOLE_SHARE));
  const against = t('analytics.codeMode.compare.against');
  const legend: [string, string] = [t('analytics.codeMode.compare.with'), t('analytics.codeMode.compare.without')];

  const across = (of: string | null) => rollups.filter((row) => row.kind === of && row.model === null);

  // ---- By kind: every kind together, then each kind, on the measure asked for.
  const kindRows = [{ key: '*', label: t('analytics.codeMode.allKinds'), of: null as string | null }, ...kinds.map((entry) => ({ key: entry.kind, label: entry.label, of: entry.kind as string | null }))].map(
    ({ key, label, of }) => {
      const withRow = across(of).find((row) => row.code_mode) ?? null;
      const withoutRow = across(of).find((row) => !row.code_mode) ?? null;
      const pick = (row: CodeModeGroup | null): number | null => {
        if (row === null) return null;
        if (kindMeasure === 'ok') return ratio(row.ok, row.launches);
        if (kindMeasure === 'tokens') return row.tokens;
        if (kindMeasure === 'time') return row.seconds;
        return row.turns;
      };
      const wordsOf = (value: number) => (kindMeasure === 'ok' ? share(value) : kindMeasure === 'tokens' ? say(tokenWords(value)) : kindMeasure === 'time' ? say(durationWords(value)) : count(value));
      const [value, base] = [pick(withRow), pick(withoutRow)];
      const change = kindMeasure === 'ok' ? pointsDifference(value, base) : difference(value, base);
      const onScale = (figure: number | null) => (figure === null ? null : kindMeasure === 'time' ? figure / SECONDS_PER_MINUTE : figure);
      return {
        key,
        label,
        strong: of === kind,
        value: onScale(value),
        against: onScale(base),
        figure: value === null ? '' : wordsOf(value),
        againstFigure: base === null ? undefined : wordsOf(base),
        change: toChange(change),
      };
    },
  );
  const kindTicks = (value: number) => {
    if (value === 0) return '0';
    if (kindMeasure === 'ok') return share(value);
    if (kindMeasure === 'tokens') return say(tokenWords(value));
    if (kindMeasure === 'time') return t('analytics.codeMode.units.minutesShort', { value: value.toLocaleString() });
    return count(value);
  };

  // ---- By model: what adds up across kinds, for the kind the page is showing.
  const modelName = (model: string) => (model === '' ? t('analytics.codeMode.compare.noModel') : model);
  const modelRows = modelLaunches(groups, kind, modelMaterialOf).map((entry) => {
    const common = { key: entry.model, label: modelName(entry.model), mono: entry.model !== '', material: entry.model === '' ? undefined : modelMaterialOf(entry.model) };
    if (modelMeasure === 'launches') {
      const all = entry.launches[0] + entry.launches[1];
      const withShare = shareWords(entry.launches[0], all);
      return {
        ...common,
        value: entry.launches[0],
        against: entry.launches[1],
        figure: count(entry.launches[0]),
        againstFigure: count(entry.launches[1]),
        change: withShare === null ? undefined : { words: t('analytics.codeMode.compare.shareWith', { share: say(withShare) }) },
      };
    }
    if (modelMeasure === 'failures') {
      const rate = ratio(entry.failures, entry.scripts);
      return {
        ...common,
        value: rate,
        against: null,
        figure: rate === null ? '' : share(rate),
        change: entry.scripts === 0 ? undefined : { words: t('analytics.codeMode.compare.failuresOf', { failures: count(entry.failures), scripts: count(entry.scripts) }) },
      };
    }
    const [value, base] = [ratio(entry.ok[0], entry.launches[0]), ratio(entry.ok[1], entry.launches[1])];
    return {
      ...common,
      value,
      against: base,
      figure: value === null ? '' : share(value),
      againstFigure: base === null ? undefined : share(base),
      change: toChange(pointsDifference(value, base)),
    };
  });
  const modelTicks = (value: number) => (value === 0 ? '0' : modelMeasure === 'launches' ? count(value) : share(value));

  // ---- The table of pairs, one press away.
  const rows: CompareRow[] = [
    ...pairRows(t('analytics.codeMode.allKinds'), false, across(null)),
    ...kinds.flatMap((entry) => {
      const ofKind = groups.filter((row) => row.kind === entry.kind);
      const named = models === 'each' ? Array.from(new Set(ofKind.map((row) => row.model ?? ''))) : [];
      return [
        ...pairRows(entry.label, false, across(entry.kind)),
        ...named.flatMap((model) => pairRows(modelName(model), true, ofKind.filter((row) => (row.model ?? '') === model))),
      ];
    }),
  ];

  /** A measured column: the median launch, or the sum under Total, with the difference under a Code Mode median. */
  const measured = (key: string, middle: (row: CodeModeGroup) => number, sum: (row: CodeModeGroup) => number, wordsOf: (figure: number) => string): DataTableColumn<CompareRow> => ({
    key,
    label: t('analytics.codeMode.compare.columns.' + key),
    align: 'end',
    render: (entry) => (
      <Figure
        words={wordsOf(totals ? sum(entry.row) : middle(entry.row))}
        change={totals || entry.against === null ? null : changed(difference(middle(entry.row), middle(entry.against)))}
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
          change={entry.against === null ? null : changed(pointsDifference(ratio(entry.row.ok, entry.row.launches), ratio(entry.against.ok, entry.against.launches)))}
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
    <section className="flex min-w-0 flex-col gap-4" data-code-mode-compare>
      <div className="grid min-w-0 gap-x-10 gap-y-9 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3" role="region" aria-labelledby={kindsHeadingId} data-code-mode-by-kind>
          <Rule id={kindsHeadingId}>{t('analytics.codeMode.compare.byKind')}</Rule>
          <div>
            <SegmentedControl
              label={t('analytics.codeMode.compare.kindMeasure')}
              options={KIND_MEASURES.map((value) => ({ value, label: t('analytics.codeMode.compare.measures.' + value) }))}
              value={kindMeasure}
              onChange={setKindMeasure}
            />
          </div>
          <Dumbbell
            key={kindMeasure}
            rows={kindRows}
            tickWords={kindTicks}
            from={kindMeasure === 'ok' ? 'fit' : 'zero'}
            ceiling={kindMeasure === 'ok' ? WHOLE_SHARE : undefined}
            legend={legend}
            label={t('analytics.codeMode.compare.kindChart', { measure: t('analytics.codeMode.compare.measures.' + kindMeasure) })}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3" role="region" aria-labelledby={modelsHeadingId} data-code-mode-by-model>
          <Rule id={modelsHeadingId}>{t('analytics.codeMode.compare.byModel')}</Rule>
          <div>
            <SegmentedControl
              label={t('analytics.codeMode.compare.modelMeasure')}
              options={MODEL_MEASURES.map((value) => ({ value, label: t('analytics.codeMode.compare.measures.' + value) }))}
              value={modelMeasure}
              onChange={setModelMeasure}
            />
          </div>
          {modelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('analytics.codeMode.compare.noModels')}</p>
          ) : (
            <Dumbbell
              key={modelMeasure + '|' + (kind ?? '')}
              rows={modelRows}
              tickWords={modelTicks}
              from={modelMeasure === 'ok' ? 'fit' : 'zero'}
              ceiling={modelMeasure === 'ok' ? WHOLE_SHARE : undefined}
              legend={legend}
              label={t('analytics.codeMode.compare.modelChart', { measure: t('analytics.codeMode.compare.measures.' + modelMeasure) })}
            />
          )}
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
          {t('analytics.codeMode.compare.byTable')}
        </Button>
        <CardFoldBody>
          <div id={tableId} className="flex min-w-0 flex-col gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}
