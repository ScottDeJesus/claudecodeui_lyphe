import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeGroup, CodeModeKind } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { DataTable, KeyValueList, Readout, Rule } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { shareWords } from '@/modules/analytics/sections/code-mode/codeModeFigures';
import type { Worded } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * HOW THE SCRIPTS FARED, over the launches that ran with Code Mode. The readout is how many scripts were run:
 * everything beside it is a count OF those, so each row says its share of scripts after its count and no row is a
 * number against nothing. It is no larger than the comparison's readouts above it: the comparison is the answer.
 *
 * The rows go the way a script goes wrong: it threw (and how many of those timed out), it was sent again, an action
 * of it was refused or failed; then the merger: asked, merged, declined. The list's labels are one word each, as the
 * kit's list sets them, and the line under it says what the short ones count.
 *
 * BY KIND is the same counts as a table, a kind a row, in the verb's order. Those that timed out stand under the count
 * that threw, as in the list: a column of their own pushed the table past the pane on a desktop. A zero is drawn in
 * the quiet ink, so the cells that hold something are the ones the eye finds.
 *
 * No launch with Code Mode in the window is one sentence under the heading, never an empty readout.
 */

type CodeModeOutcomesProps = {
  /** The kinds the verb counts, in its order. */
  kinds: CodeModeKind[];
  /** The Code Mode rollups across models: one per kind, and the one across kinds (`kind` null). */
  rollups: CodeModeGroup[];
  /** The window, in days. */
  days: number;
};

type KindRow = { label: string; row: CodeModeGroup };

/** A count, and after it in the quiet ink what it is a count against. A zero is the quiet ink alone: nothing of nothing is not a share. */
function Outcome({ count, words }: { count: number; words: string }) {
  return (
    <span className={cn('tabular-nums', count === 0 && 'text-muted-foreground')}>
      {count.toLocaleString()}
      {count > 0 && words !== '' && <span className="ml-2 text-muted-foreground">{words}</span>}
    </span>
  );
}

/** Rendered by CodeModeSection, second. Nothing else mounts it. */
export function CodeModeOutcomes({ kinds, rollups, days }: CodeModeOutcomesProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const kindsHeadingId = useId();
  const all = rollups.find((row) => row.kind === null) ?? null;

  if (all === null || all.launches === 0) {
    return (
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-outcomes>
        <Rule id={headingId}>{t('analytics.codeMode.outcomes.title')}</Rule>
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.outcomes.none', { days })}</p>
      </section>
    );
  }

  const say = (words: Worded | null) => (words === null ? '' : t(words.key, words.values));
  const share = (count: number, scripts: number) => say(shareWords(count, scripts));
  const ofScripts = (count: number) => (share(count, all.scripts) === '' ? '' : t('analytics.codeMode.outcomes.ofScripts', { share: share(count, all.scripts) }));
  const thrownWords =
    all.timed_out > 0 && share(all.thrown, all.scripts) !== ''
      ? t('analytics.codeMode.outcomes.thrownOfScripts', { share: share(all.thrown, all.scripts), timedOut: all.timed_out.toLocaleString() })
      : ofScripts(all.thrown);

  const perKind: KindRow[] = kinds.flatMap((kind) => {
    const row = rollups.find((entry) => entry.kind === kind.kind);
    return row === undefined ? [] : [{ label: kind.label, row }];
  });

  const cell = (count: number) => <span className={cn('tabular-nums', count === 0 && 'text-muted-foreground')}>{count.toLocaleString()}</span>;
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
            <Outcome count={row.thrown} words={share(row.thrown, row.scripts)} />
            {row.timed_out > 0 && (
              <span className="text-xs text-muted-foreground">{t('analytics.codeMode.outcomes.timedOut', { timedOut: row.timed_out.toLocaleString() })}</span>
            )}
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
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-outcomes>
      <Rule id={headingId}>{t('analytics.codeMode.outcomes.title')}</Rule>

      <div className="grid items-start gap-x-12 gap-y-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Readout
          label={t('analytics.codeMode.outcomes.scripts')}
          value={all.scripts}
          note={t('analytics.codeMode.outcomes.scriptsNote', { count: all.launches })}
          unknownLabel={t('analytics.codeMode.unknown')}
        />
        <KeyValueList
          className="max-w-xl"
          items={[
            [t('analytics.codeMode.outcomes.thrown'), <Outcome key="thrown" count={all.thrown} words={thrownWords} />],
            [t('analytics.codeMode.outcomes.resent'), <Outcome key="resent" count={all.resent} words={ofScripts(all.resent)} />],
            [t('analytics.codeMode.outcomes.refused'), <Outcome key="refused" count={all.refused} words={ofScripts(all.refused)} />],
            [t('analytics.codeMode.outcomes.failed'), <Outcome key="failed" count={all.failed} words={ofScripts(all.failed)} />],
            [t('analytics.codeMode.outcomes.mergesAsked'), <Outcome key="mergesAsked" count={all.merges_asked} words={ofScripts(all.merges_asked)} />],
            [t('analytics.codeMode.outcomes.mergesMerged'), <Outcome key="mergesMerged" count={all.merges_merged} words={ofScripts(all.merges_merged)} />],
            [t('analytics.codeMode.outcomes.declined'), <Outcome key="declined" count={all.declined} words={ofScripts(all.declined)} />],
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('analytics.codeMode.outcomes.about')}</p>

      <div className="mt-2 flex min-w-0 flex-col gap-3">
        <Rule id={kindsHeadingId} level={4}>{t('analytics.codeMode.outcomes.byKind')}</Rule>
        <DataTable rows={perKind} columns={columns} rowKey={(entry) => entry.row.kind ?? ''} label={t('analytics.codeMode.outcomes.tableLabel')} />
      </div>
    </section>
  );
}
