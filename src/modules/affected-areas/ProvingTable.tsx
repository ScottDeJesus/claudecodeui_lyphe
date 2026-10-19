import { useTranslation } from 'react-i18next';

import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { ProvingDetail, Share } from '@/modules/affected-areas/ProvingDetail';
import { thresholdWords, tooFew } from '@/modules/affected-areas/utils/provingModel';
import type { Proving, ProvingClass, UnderstandingTally } from '@/shared/affected-areas-types';
import type { AffectedAreasRead, DataTableColumn } from '@/shared/types';
import { Banner, DataTable } from '@/shared/ui';

type ProvingTableProps = {
  /** `GET /proving`'s read: `value` is the table, null while it is read or when it failed; `trouble` is why none came. */
  proving: AffectedAreasRead<Proving>;
  /** The column the table is sorted by and which way, held by `TablesScreen`. */
  sort: { column: string; direction: 'asc' | 'desc' };
  onSort: (column: string) => void;
  /** The open kind's key, or null. */
  expanded: string | null;
  onExpand: (key: string | null) => void;
  /**
   * The rows as they stood when the open row opened, or when a head was last pressed while it was open, held by
   * `TablesScreen` until the row closes; null when none is held. While they are, the table sorts by these figures, so an
   * answer redraws its row where it stands.
   */
  heldFrom: ProvingClass[] | null;
  /** Where the open kind's stepper stands; null while it stands at the line in force. */
  line: number | null;
  /** Set threshold's press is out. */
  pressing: boolean;
  /** Why the last Set threshold set no line; null when none stands. */
  refusal: string | null;
  onStep: (direction: -1 | 1) => void;
  onSetThreshold: () => void;
};

/** The row a kind is sorted by: the one held while a row is open (`heldFrom`), else the kind as it now stands. */
type SortedBy = (kind: ProvingClass) => ProvingClass;

/** One count column: the figure the engine sent, flush right, sorting by it. */
function countColumn(key: string, label: string, count: (kind: ProvingClass) => number, sortedBy: SortedBy): DataTableColumn<ProvingClass> {
  return { key, label, align: 'end', sortValue: (kind) => count(sortedBy(kind)), render: count };
}

/**
 * One share column, at the kind's line: the engine's share, or a dash when it stands on fewer than ten judgments, `over`
 * being the count it was divided by. A dash sorts as nothing at all, so it sinks below every share in both directions,
 * never to the top of an ascending sort. A kind with no line set shows the share previewed at the engine's default,
 * and says "at 0.50" under it.
 */
function shareColumn(
  key: string, label: string, share: (kind: ProvingClass) => number | null, over: (kind: ProvingClass) => number, sortedBy: SortedBy,
): DataTableColumn<ProvingClass> {
  return {
    key, label, align: 'end',
    sortValue: (kind) => (tooFew(over(sortedBy(kind))) ? null : share(sortedBy(kind))),
    render: (kind) => <Share share={share(kind)} over={over(kind)} previewedAt={kind.isDefault ? kind.threshold : undefined} />,
  };
}

/** "What the reader understands: 18 of 22 judged right", in counts: the screen divides nothing. */
function UnderstandingLine({ tally }: { tally: UnderstandingTally }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
      <span className="text-muted-foreground">{t('affectedAreas.tables.understanding')}</span>
      <span className="font-medium tabular-nums text-foreground">
        {tally.n === 0 ? t('affectedAreas.tables.understandingNone') : t('affectedAreas.tables.understandingTally', { right: tally.right, count: tally.n })}
      </span>
    </p>
  );
}

/** What each column means, under the table: the one place a first-time reader learns which marks count for which number. */
function Legend() {
  const { t } = useTranslation();
  const terms: { term: string; spoken?: string; meaning: string }[] = [
    { term: t('affectedAreas.tables.column.precision'), meaning: t('affectedAreas.tables.legend.precision') },
    { term: t('affectedAreas.tables.column.coverage'), meaning: t('affectedAreas.tables.legend.coverage') },
    { term: t('affectedAreas.tables.column.missed'), meaning: t('affectedAreas.tables.legend.missed') },
    { term: t('affectedAreas.tables.column.judged'), meaning: t('affectedAreas.tables.legend.judged') },
    { term: t('affectedAreas.tables.column.nearLine'), meaning: t('affectedAreas.tables.legend.nearLine') },
    { term: '—', spoken: t('affectedAreas.tables.legend.dash'), meaning: t('affectedAreas.tables.legend.dashMeaning') },
  ];
  return (
    <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground [@container(min-width:720px)]:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
      {terms.map(({ term, spoken, meaning }) => (
        <div key={term} className="contents">
          <dt className="font-medium text-foreground">
            <span aria-hidden={spoken === undefined ? undefined : 'true'}>{term}</span>
            {spoken !== undefined && <span className="sr-only">{spoken}</span>}
          </dt>
          <dd className="m-0">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * THE PROVING TABLE, DRAWN: what `TablesScreen` holds, as the operator reads it.
 *
 * Top to bottom: the head, How right the reader is, naming the model and contract it measures ("gemini-3.8-flash ·
 * aa.v2"); the understanding's line, in counts; then the kinds, one row each, as the library's sortable `DataTable`:
 * the kind with its line ("Threshold 65% · set Oct 15", or "No threshold set: its areas stand only when you mark them");
 * then the decision, Precision and Coverage at that line (previewed "at 0.50" where none is set) and Missed, what the
 * reader missed that no line can catch; then Judged on the random slice
 * and what the judgments were (Right, Wrong kind, Not a change); then Near the line, effort that never enters a share.
 * Nine columns need about 1,200 px and the Cerberus panel gives the table some 890 at 1280 wide (a phone, 356), so the
 * table scrolls sideways in its frame, the kind's column standing still at its edge, and the order is what shows
 * first. Under the table, what each column means.
 *
 * A share standing on fewer than ten judgments is a dash: a precision over the judged regions at or above the kind's
 * line, a coverage over the kind's confirmed. So a kind judged fewer than ten times shows its counts and a dash for each
 * percentage, and so does a judged kind's precision when its line sits so high that few stand above it. Every figure is
 * the engine's: the screen sorts, opens a row (`ProvingDetail`) and says words, and computes nothing. While a row is
 * open the table keeps the order it had when the row opened, or when a head was last pressed (`heldFrom`), so Set
 * threshold's answer redraws the row in place and nothing moves under the operator's finger.
 *
 * States: the read out (the real heads over shimmering rows); the lane's fault (its banner with Try again, the table
 * kept under it when a re-read failed); nothing judged on the random slice yet (one line of where judging happens,
 * above a table that still offers every line, since a line can be set on judgment alone); the kinds.
 *
 * Used by the affected-areas module's `TablesScreen`.
 */
export function ProvingTable({
  proving, sort, onSort, expanded, onExpand, heldFrom, line, pressing, refusal, onStep, onSetThreshold,
}: ProvingTableProps) {
  const { t } = useTranslation();
  const table = proving.value;
  const sortedBy: SortedBy = (kind) => heldFrom?.find((held) => held.class === kind.class) ?? kind;

  const columns: DataTableColumn<ProvingClass>[] = [
    {
      key: 'kind',
      label: t('affectedAreas.tables.column.kind'),
      sortValue: (kind) => kind.label,
      render: (kind) => (
        <span className="flex flex-col gap-0.5">
          {kind.label}
          {/* Words, not a figure column: proportional figures, not the cell's tabular ones. */}
          <span className="w-44 text-xs font-normal normal-nums text-muted-foreground">{thresholdWords(kind, t)}</span>
        </span>
      ),
    },
    shareColumn('precision', t('affectedAreas.tables.column.precision'), (kind) => kind.randomSlice.precisionAt, (kind) => kind.randomSlice.nAt, sortedBy),
    shareColumn('coverage', t('affectedAreas.tables.column.coverage'), (kind) => kind.randomSlice.coverageAt, (kind) => kind.randomSlice.right, sortedBy),
    countColumn('missed', t('affectedAreas.tables.column.missed'), (kind) => kind.missed, sortedBy),
    countColumn('judged', t('affectedAreas.tables.column.judged'), (kind) => kind.randomSlice.n, sortedBy),
    countColumn('right', t('affectedAreas.tables.column.right'), (kind) => kind.randomSlice.right, sortedBy),
    countColumn('wrongKind', t('affectedAreas.tables.column.wrongKind'), (kind) => kind.randomSlice.wrongClass, sortedBy),
    countColumn('notAChange', t('affectedAreas.tables.column.notAChange'), (kind) => kind.randomSlice.wrong, sortedBy),
    countColumn('nearLine', t('affectedAreas.tables.column.nearLine'), (kind) => kind.nearLine, sortedBy),
  ];

  // The read out: the real heads, so the table's shape is there at once, over six rows of Verve's waiting surface.
  const waiting: DataTableColumn<number>[] = columns.map(({ key, label, align }) => ({
    key, label, align,
    render: () => <div className={key === 'kind' ? 'vv-skeleton h-8 w-32' : 'vv-skeleton ml-auto h-3.5 w-9'} />,
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex min-w-0 flex-col gap-1">
        <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">{t('affectedAreas.tables.title')}</h2>
        {table !== null ? (
          <p className="text-[13px] text-muted-foreground">{t('affectedAreas.tables.measures', { model: table.model, contract: table.contractVersion })}</p>
        ) : (
          proving.trouble === null && <div aria-hidden="true" className="vv-skeleton mt-1 h-3.5 w-44" />
        )}
      </header>

      {proving.trouble !== null && <LaneTrouble trouble={proving.trouble} subject="tables" onRetry={proving.retry} />}

      {table !== null && (
        <>
          <UnderstandingLine tally={table.understanding} />
          {table.classes.every((kind) => kind.randomSlice.n === 0) && (
            <Banner tone="info">
              <p className="text-sm font-medium">{t('affectedAreas.tables.sliceEmpty')}</p>
              <p className="mt-0.5 text-xs">{t('affectedAreas.tables.sliceEmptyDetail')}</p>
            </Banner>
          )}
          {/* The container `ProvingDetail` measures its panel against: the table's frame, whatever the table's own width. */}
          <div className="[container-type:inline-size]">
            <DataTable
              rows={table.classes}
              columns={columns}
              rowKey={(kind) => kind.class}
              label={t('affectedAreas.tables.label')}
              sort={sort}
              onSort={onSort}
              expanded={expanded}
              onExpand={onExpand}
              renderExpanded={(kind) => (
                <ProvingDetail
                  kind={kind}
                  kinds={table.classes}
                  line={line}
                  pressing={pressing}
                  refusal={refusal}
                  onStep={onStep}
                  onSetThreshold={onSetThreshold}
                />
              )}
            />
          </div>
          <Legend />
        </>
      )}

      {table === null && proving.trouble === null && (
        <div aria-busy="true">
          <p role="status" className="sr-only">{t('affectedAreas.tables.reading')}</p>
          <div aria-hidden="true">
            <DataTable rows={[0, 1, 2, 3, 4, 5]} columns={waiting} rowKey={String} label={t('affectedAreas.tables.label')} />
          </div>
        </div>
      )}
    </div>
  );
}
