import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ThresholdControl } from '@/modules/affected-areas/ThresholdControl';
import { capitalized, spoken } from '@/modules/affected-areas/utils/tourModel';
import { lineWords, sameLine, tooFew } from '@/modules/affected-areas/utils/provingModel';
import type { ProvingClass, SweepPoint } from '@/shared/affected-areas-types';
import type { DataTableColumn } from '@/shared/types';
import { Badge, DataTable } from '@/shared/ui';

type ProvingDetailProps = {
  kind: ProvingClass;
  /** Every kind of the table: the names of the kinds this one was renamed to. */
  kinds: ProvingClass[];
  /** Where the stepper stands; null while it stands at the line in force. */
  line: number | null;
  pressing: boolean;
  refusal: string | null;
  onStep: (direction: -1 | 1) => void;
  onSetThreshold: () => void;
};

const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * One row of the sweep: a line the engine priced (`point`), or the line in force or the stepper's line where it falls
 * between the engine's lines, before the first or after the last (`point` null: placed, never priced).
 */
type SweepRow = { t: number; point: SweepPoint | null };

/**
 * A share as the tables say it: "72%", or a dash said aloud as why, when it stands on fewer than ten judgments: `over`
 * is the count the engine divided by (`tooFew`). A share the engine could not give stands on none, and is a dash too.
 *
 * Used by the affected-areas module's `ProvingTable` (Precision and Coverage) and by this file's sweep.
 */
export function Share({ share, over }: { share: number | null; over: number }) {
  const { t } = useTranslation();
  if (share !== null && !tooFew(over)) return <>{t('affectedAreas.tables.percent', { percent: Math.round(share * 100) })}</>;
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t('affectedAreas.tables.tooFew')}</span>
    </>
  );
}

/**
 * A KIND'S ROW, OPENED: where its line sits and what moving it would give. First the line's control (`ThresholdControl`),
 * then the sweep: at each line the engine prices, 30% to 90%, the precision and coverage there, with the count of
 * judged regions at or above the line under the line itself, where a phone still shows it. A share over fewer than ten
 * is a dash, as in the row: a precision over that line's count, a coverage over the kind's confirmed. The line in force
 * is marked "In force" and the stepper's line, once moved, "If set"; either one that falls between the priced lines (or
 * outside them) takes a row of its own in its place, with no figures, because the engine priced none: the sweep always
 * shows where the operator stands. A kind never judged on the slice says so in one line in place of seven empty rows.
 * Then the kinds the operator renamed it to, by name with how often, and his latest notes on it, each left out while it
 * holds nothing.
 *
 * The opened row spans every column of the table, which on a phone is wider than its frame: the panel keeps to the
 * frame's visible width and stays in view while the table scrolls sideways. `100cqi` is the frame's, because
 * `ProvingTable` makes the table's wrapper the container, and the 34 px are the frame's two borders and the open row's
 * own padding.
 *
 * Used by the affected-areas module's `ProvingTable`, as the table's `renderExpanded`.
 */
export function ProvingDetail({ kind, kinds, line, pressing, refusal, onStep, onSetThreshold }: ProvingDetailProps) {
  const { t } = useTranslation();
  const sweepId = useId();
  const renamedId = useId();
  const notesId = useId();
  // A kind is named, never keyed (INV-76): one the codebook dropped since is spoken from its key.
  const kindName = (cls: string) => kinds.find((other) => other.class === cls)?.label ?? capitalized(spoken(cls));
  // The stepper's line is marked only once it is moved off the line in force: at it, "In force" already says it.
  const chosen = line !== null && !sameLine(line, kind.threshold) ? line : null;
  // The priced lines, and the line in force and the stepper's line placed among them where no priced line is theirs.
  const placed = [kind.threshold, chosen].filter((at): at is number => at !== null && !kind.sweep.some((point) => sameLine(point.t, at)));
  const sweepRows: SweepRow[] = [...kind.sweep.map((point) => ({ t: point.t, point })), ...placed.map((at) => ({ t: at, point: null }))]
    .sort((a, b) => a.t - b.t);

  // The line, with its count and its mark under it, then what it gives: a phone shows all three columns, and the
  // count each share stands on is never the column cut off.
  const sweepColumns: DataTableColumn<SweepRow>[] = [
    {
      key: 'line',
      label: t('affectedAreas.tables.detail.line'),
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          {lineWords(row.t, t)}
          {row.point !== null && (
            <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">{t('affectedAreas.tables.detail.atOrAbove', { count: row.point.n })}</span>
          )}
          {sameLine(row.t, kind.threshold) && <Badge as="span" tone="neutral" className="whitespace-nowrap">{t('affectedAreas.tables.detail.inForce')}</Badge>}
          {chosen !== null && sameLine(row.t, chosen) && <Badge as="span" tone="info" className="whitespace-nowrap">{t('affectedAreas.tables.detail.ifSet')}</Badge>}
        </span>
      ),
    },
    {
      key: 'precision',
      label: t('affectedAreas.tables.column.precision'),
      align: 'end',
      render: (row) => row.point && <Share share={row.point.precision} over={row.point.n} />,
    },
    {
      key: 'coverage',
      label: t('affectedAreas.tables.column.coverage'),
      align: 'end',
      render: (row) => row.point && <Share share={row.point.coverage} over={kind.randomSlice.right} />,
    },
  ];

  // From 840 px of table the opened row is two columns: the line's control, renamed to and notes in three parts of
  // eight, each as tall as it needs (the sweep beside them is taller, and its height goes under the last of them); the
  // sweep in five, its rows level with the control. Narrower, one column in reading order: the control, the sweep,
  // renamed to, notes.
  return (
    <div className="sticky left-4 grid w-[calc(100cqi-34px)] gap-5 [@container(min-width:840px)]:grid-cols-[minmax(0,3fr)_minmax(0,5fr)] [@container(min-width:840px)]:grid-rows-[auto_auto_1fr]">
      <div className="[@container(min-width:840px)]:col-start-1 [@container(min-width:840px)]:row-start-1">
        <ThresholdControl kind={kind} line={line} pressing={pressing} refusal={refusal} onStep={onStep} onSetThreshold={onSetThreshold} />
      </div>

      <section
        aria-labelledby={sweepId}
        className="flex min-w-0 flex-col gap-2.5 [@container(min-width:840px)]:col-start-2 [@container(min-width:840px)]:row-span-3 [@container(min-width:840px)]:row-start-1"
      >
        <h3 id={sweepId} className={EYEBROW}>{t('affectedAreas.tables.detail.sweep')}</h3>
        {kind.randomSlice.n === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t('affectedAreas.tables.detail.noneJudged')}</p>
        ) : (
          <DataTable
            rows={sweepRows}
            columns={sweepColumns}
            rowKey={(row) => String(Math.round(row.t * 100))}
            label={t('affectedAreas.tables.detail.sweepLabel', { kind: kind.label })}
          />
        )}
      </section>

      {kind.renamedTo.length > 0 && (
        <section aria-labelledby={renamedId} className="flex min-w-0 flex-col gap-1.5 [@container(min-width:840px)]:col-start-1">
          <h3 id={renamedId} className={EYEBROW}>{t('affectedAreas.tables.detail.renamedTo')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
            {kind.renamedTo.map((renamed) => (
              <li key={renamed.class} className="flex items-baseline gap-2">
                <span className="text-foreground">{kindName(renamed.class)}</span>
                <span className="tabular-nums text-muted-foreground">{t('affectedAreas.tables.detail.renamedTimes', { count: renamed.n })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kind.notes.length > 0 && (
        <section aria-labelledby={notesId} className="flex min-w-0 flex-col gap-1.5 [@container(min-width:840px)]:col-start-1">
          <h3 id={notesId} className={EYEBROW}>{t('affectedAreas.tables.detail.notes')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-foreground">
            {kind.notes.map((note, index) => <li key={index} className="[overflow-wrap:anywhere]">“{note}”</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
