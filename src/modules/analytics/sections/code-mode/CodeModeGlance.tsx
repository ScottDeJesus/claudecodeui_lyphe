import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeDay, CodeModeGroup } from '@/shared/analytics-types';
import { modelMaterialOf } from '@/shared/modelLabels';
import type { Tone } from '@/shared/types';
import { Meter, MixBar, Readout, Rule } from '@/shared/ui';
import { dayList, difference, durationWords, modelLaunches, pointsDifference, ratio, shareWords, tokenWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { Difference, TrendMeasure, TrendSpan, Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * AT A GLANCE: the median launch with Code Mode against the same without, for the kind the page is showing, before
 * anything is drawn over days.
 *
 * FIVE FIGURES IN A ROW, no boxes. Launches first, with the share of all launches that ran with Code Mode, and under them
 * the models those launches ran on as one bar in the chats' colours. Then the share that ended ok as a dial, the share
 * without as its tick. Then the median launch's turns, tokens and time, each with how far it is from the same figure
 * without: in the positive ink with its ✓ when Code Mode is the better way round, in the warn ink with its ▲ when it is
 * the worse, and a line of the window's days under it, Code Mode in the full ink over without in the pale one.
 *
 * Every number is the verb's; what is worked out here is only shares and differences of them (codeModeFigures.ts).
 * A kind with no launch in the window is one sentence, never five empty figures.
 */

type CodeModeGlanceProps = {
  /** The kind the page is showing; null is every kind. */
  kind: string | null;
  /** That kind's label, or the words for every kind. */
  kindLabel: string;
  /** One row per (kind, code_mode, model): the models the launches ran on. */
  groups: CodeModeGroup[];
  /** The same across models (`model` null), per kind and across kinds (`kind` null too). */
  rollups: CodeModeGroup[];
  /** The days, for each figure's line. */
  series: CodeModeDay[];
  /** The window as the answer states it. */
  span: TrendSpan;
};

/** The dial's side: a step down from the kit's 132px, so it stands as tall as the readouts beside it. */
const DIAL_CLASS = '[--vv-dial:120px]';

/** Rendered by CodeModeSection, first. Nothing else mounts it. */
export function CodeModeGlance({ kind, kindLabel, groups, rollups, series, span }: CodeModeGlanceProps) {
  const { t } = useTranslation('common');
  const headingId = useId();

  const say = (words: Worded | null) => (words === null ? '' : t(words.key, words.values));
  const count = (figure: number) => figure.toLocaleString();
  const toneOf = (change: Difference | null): Tone | undefined => (change === null ? undefined : change.worse ? 'warn' : change.better ? 'positive' : 'neutral');

  const across = rollups.filter((row) => row.kind === kind && row.model === null);
  const withRow = across.find((row) => row.code_mode) ?? null;
  const withoutRow = across.find((row) => !row.code_mode) ?? null;
  const launchesWith = withRow?.launches ?? 0;
  const launchesWithout = withoutRow?.launches ?? 0;
  const all = launchesWith + launchesWithout;
  const title =
    kind === null ? t('analytics.codeMode.glance.title', { days: span.days }) : t('analytics.codeMode.glance.titleKind', { kind: kindLabel, days: span.days });

  if (all === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-glance>
        <Rule id={headingId}>{title}</Rule>
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.trend.quiet', { kind: kindLabel, days: span.days })}</p>
      </section>
    );
  }

  const launchesNote =
    launchesWith === 0
      ? t('analytics.codeMode.glance.launchesNone', { without: count(launchesWithout) })
      : launchesWithout === 0
        ? t('analytics.codeMode.glance.launchesEvery', { all: count(all) })
        : t('analytics.codeMode.glance.launchesNote', { share: say(shareWords(launchesWith, all)), all: count(all), without: count(launchesWithout) });

  // The models the Code Mode launches ran on, each in its chats' colour; a launch with no model named wears the ink.
  const modelName = (model: string) => (model === '' ? t('analytics.codeMode.compare.noModel') : model);
  const parts = modelLaunches(groups, kind, modelMaterialOf)
    .filter((entry) => entry.launches[0] > 0)
    .map((entry) => ({
      key: entry.model,
      label: modelName(entry.model),
      mono: entry.model !== '',
      count: entry.launches[0],
      figure: count(entry.launches[0]),
      material: entry.model === '' ? undefined : modelMaterialOf(entry.model),
    }));

  const okWith = withRow === null ? null : ratio(withRow.ok, withRow.launches);
  const okWithout = withoutRow === null ? null : ratio(withoutRow.ok, withoutRow.launches);
  const okChange = pointsDifference(okWith, okWithout);
  const okShare = (rate: number) => say(shareWords(rate, 1));

  /** A measure's days as the readout's two lines: Code Mode's, then without's. */
  const trendOf = (measure: TrendMeasure) => {
    const days = dayList(series, kind, measure, span);
    return [days.map((day) => day.figures[0]), days.map((day) => day.figures[1])];
  };

  /** One median figure of the launch with Code Mode, against the same without. */
  const figure = (key: 'turns' | 'tokens' | 'time', measure: TrendMeasure, pick: (row: CodeModeGroup) => number, wordsOf: (value: number) => string) => {
    const change = difference(withRow === null ? null : pick(withRow), withoutRow === null ? null : pick(withoutRow));
    return (
      <Readout
        label={t('analytics.codeMode.compare.headline.' + key)}
        value={withRow === null ? null : wordsOf(pick(withRow))}
        change={change === null ? undefined : { words: say(change.words), tone: toneOf(change) }}
        note={withoutRow === null ? t('analytics.codeMode.compare.noteAlone') : t('analytics.codeMode.compare.noteWithout', { without: wordsOf(pick(withoutRow)) })}
        trend={trendOf(measure)}
        unknownLabel={t('analytics.codeMode.unknown')}
      />
    );
  };

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={headingId} data-code-mode-glance>
      <Rule id={headingId}>{title}</Rule>

      <div className="grid grid-cols-2 items-start gap-x-6 gap-y-7 lg:grid-cols-5 lg:gap-x-8">
        <div className="col-span-2 flex min-w-0 flex-col gap-3 lg:col-span-1" data-code-mode-glance-launches>
          <Readout label={t('analytics.codeMode.glance.launches')} value={launchesWith} note={launchesNote} unknownLabel={t('analytics.codeMode.unknown')} />
          {parts.length > 0 && (
            <MixBar
              parts={parts}
              label={t('analytics.codeMode.glance.mix', { parts: parts.map((part) => part.label + ' ' + part.figure).join(t('analytics.codeMode.listSeparator')) })}
            />
          )}
        </div>

        <div className={DIAL_CLASS} data-tone={okChange?.worse ? 'warn' : 'positive'} data-code-mode-glance-ok>
          <Meter
            variant="dial"
            percent={okWith === null ? null : Math.round(okWith * 100)}
            tone={okChange?.worse ? 'warn' : 'accent'}
            label={t('analytics.codeMode.compare.headline.ok')}
            value={okWith === null ? t('analytics.codeMode.unknown') : t('analytics.codeMode.glance.okValue', { share: okShare(okWith) })}
            tickAt={okWithout === null ? null : okWithout * 100}
            tickLabel={okWithout === null ? undefined : t('analytics.codeMode.glance.okTick', { share: okShare(okWithout) })}
            sub={
              okWithout === null
                ? t('analytics.codeMode.compare.noteAlone')
                : okChange === null
                  ? t('analytics.codeMode.compare.noteWithout', { without: okShare(okWithout) })
                  : t('analytics.codeMode.glance.okNote', { change: say(okChange.words), without: okShare(okWithout) })
            }
          />
        </div>

        {figure('turns', 'turns', (row) => row.turns, count)}
        {figure('tokens', 'tokens', (row) => row.tokens, (value) => say(tokenWords(value)))}
        {figure('time', 'seconds', (row) => row.seconds, (value) => say(durationWords(value)))}
      </div>
    </section>
  );
}
