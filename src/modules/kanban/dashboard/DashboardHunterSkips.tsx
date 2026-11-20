import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { DataTableColumn, HuntSkippedUnit } from '@/shared/types';
import { Button, DataTable, EmptyState, Rule } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * WHAT THE HUNTERS SKIPPED, EACH WITH ITS REASON: the files and tables a hunter was handed and could not hunt. A
 * skip never counts as covered, so this is the list of what nobody has looked at and why.
 *
 * THE UNIT IS THE ROW'S NAME AND HOLDS ITS PRESS. The file or table stands in the first column, which the table
 * holds still while the rest scrolls sideways on a phone, and `Hunt it again` sits directly under it: the way to
 * put a skipped unit back is always under the thumb, 44 px tall there, never a column scrolled out of sight.
 *
 * THE REASON STANDS NEXT TO THE UNIT, before who skipped it and where, and the two are floored narrow enough (128 and
 * 160 px) that both stand whole on a 390 px phone: what was skipped, why, and the press, with nothing to scroll for.
 *
 * A HUNTER AND A PROJECT ARE NAMED AS A PERSON NAMES THEM (`hunterWord`, `nameOf`), never by kind or folder.
 *
 * THE LIST ONLY GROWS, SO IT IS DRAWN SHORT. A skip is lasting (a unit skipped once comes into each later pass
 * already skipped) and the house keeps the newest 200. The heading says how many there are, the newest six are
 * drawn, and the rest stand behind one press under the table that says the whole count ("Show all 200"); the same
 * press folds them away again. Six rows are about one desktop screen, so what stands under this table stays in reach.
 * While the whole list is shown the way back is drawn twice, at the table's head as well as its foot: the foot is then
 * tens of screens down, and what stands under the table is out of reach until the list is folded.
 *
 * A REFUSAL IS SAID AT ITS ROW, in the unit's own cell under the press that was refused, in the dispatcher's own
 * sentence: the reader's eye is on that press, wherever in the list it is. The sentence takes the cell's width and
 * never sets it, so a refusal does not push the reason beside it out of a phone's view.
 *
 * A PATH BREAKS AT ITS SLASHES, and inside a name only when one name is wider than the cell.
 */

type DashboardHunterSkipsProps = {
  /** The skipped units, newest first: the newest 200 the house keeps. */
  skipped: HuntSkippedUnit[];
  /** A hunt's kind as a word: "Security". */
  hunterWord: (hunt: string) => string;
  /** A project's folder as its name: "Restorly connector". */
  nameOf: (project: string) => string;
  /** The unit whose `Hunt it again` is out, and the dispatcher's sentence for the one it refused. */
  reopen: { busy: HuntSkippedUnit | null; refusal: { unit: HuntSkippedUnit; sentence: string } | null };
  onHuntAgain: (unit: HuntSkippedUnit) => void;
};

/** How many skipped units are drawn before the rest are asked for. */
const NEWEST = 6;

/** A skipped unit's identity: a unit's name is only unique inside its hunt and project. */
const unitKey = (unit: HuntSkippedUnit) => `${unit.hunt}\n${unit.project}\n${unit.unit}`;

/** A unit's path with a place to break after each slash, so a wrapped path keeps its names and its extension whole. */
const pathWords = (unit: string) =>
  unit.split('/').map((name, index, names) => (index < names.length - 1 ? <Fragment key={index}>{name}/<wbr /></Fragment> : name));

/** Rendered by DashboardHunters, last. Nothing else mounts it. */
export function DashboardHunterSkips({ skipped, hunterWord, nameOf, reopen, onHuntAgain }: DashboardHunterSkipsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const unitId = useId();
  const tableId = useId();
  // Whether the whole list is drawn. The reader's own choice for this visit: every arrival starts on the newest few.
  const [showAll, setShowAll] = useState(false);
  const busyKey = reopen.busy === null ? null : unitKey(reopen.busy);
  const refusedKey = reopen.refusal === null ? null : unitKey(reopen.refusal.unit);
  const shown = showAll ? skipped : skipped.slice(0, NEWEST);

  const columns: DataTableColumn<HuntSkippedUnit>[] = [
    {
      key: 'unit',
      label: t('kanban.dashboard.hunters.skips.columns.unit'),
      render: (unit) => {
        const nameId = `${unitId}-${skipped.indexOf(unit)}`;
        return (
          <span className="flex min-w-32 max-w-xs flex-col items-start gap-1.5">
            <span id={nameId} className="font-mono text-xs text-foreground [overflow-wrap:anywhere]">{pathWords(unit.unit)}</span>
            <Button
              variant="outline"
              size="sm"
              className="finger:h-11"
              aria-describedby={nameId}
              busy={busyKey === unitKey(unit)}
              data-hunter-again={unit.unit}
              onClick={() => onHuntAgain(unit)}
            >
              {t('kanban.dashboard.hunters.skips.again')}
            </Button>
            {reopen.refusal !== null && refusedKey === unitKey(unit) && (
              <span role="alert" data-tone="warn" className="flex w-0 min-w-full items-start gap-1.5 text-xs text-tone-ink" data-hunter-again-refused>
                <span aria-hidden="true" className="mt-1 size-2 flex-none rounded-full bg-tone-dot" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{t('kanban.dashboard.hunters.skips.refused', { sentence: reopen.refusal.sentence })}</span>
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'reason', label: t('kanban.dashboard.hunters.skips.columns.reason'), render: (unit) => <span className="block min-w-40 max-w-md break-words">{unit.reason}</span> },
    { key: 'hunter', label: t('kanban.dashboard.hunters.skips.columns.hunter'), render: (unit) => <span className="whitespace-nowrap">{hunterWord(unit.hunt)}</span> },
    { key: 'project', label: t('kanban.dashboard.hunters.skips.columns.project'), render: (unit) => <span className="whitespace-nowrap">{nameOf(unit.project)}</span> },
    { key: 'when', label: t('kanban.dashboard.hunters.skips.columns.when'), render: (unit) => <span className="whitespace-nowrap">{formatRelativeTime(unit.marked_at)}</span> },
  ];

  return (
    <div className="flex flex-col gap-3" role="group" aria-labelledby={headingId} data-hunter-skips={skipped.length}>
      <div className="flex flex-col gap-0.5">
        <Rule id={headingId} level={4} end={skipped.length > 0 && <span data-hunter-skips-count="">{skipped.length.toLocaleString()}</span>}>
          {t('kanban.dashboard.hunters.skips.title')}
        </Rule>
        <p className="text-xs text-muted-foreground">{t('kanban.dashboard.hunters.skips.about')}</p>
      </div>
      {showAll && skipped.length > NEWEST && (
        <Button
          variant="outline"
          size="sm"
          className="self-start finger:h-11 finger:w-full"
          aria-expanded
          aria-controls={tableId}
          onClick={() => setShowAll(false)}
          data-hunter-skips-fold
        >
          {t('kanban.dashboard.hunters.skips.showNewest', { count: NEWEST })}
        </Button>
      )}
      {skipped.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.hunters.skips.empty')} />
      ) : (
        <div id={tableId}>
          <DataTable rows={shown} columns={columns} rowKey={unitKey} label={t('kanban.dashboard.hunters.skips.title')} />
        </div>
      )}
      {skipped.length > NEWEST && (
        <Button
          variant="outline"
          size="sm"
          className="self-start finger:h-11 finger:w-full"
          aria-expanded={showAll}
          aria-controls={tableId}
          onClick={() => setShowAll((all) => !all)}
          data-hunter-skips-all
        >
          {showAll ? t('kanban.dashboard.hunters.skips.showNewest', { count: NEWEST }) : t('kanban.dashboard.hunters.skips.showAll', { count: skipped.length })}
        </Button>
      )}
    </div>
  );
}
