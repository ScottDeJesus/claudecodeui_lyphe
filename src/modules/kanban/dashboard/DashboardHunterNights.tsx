import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { DataTableColumn, HuntSittingRow, Tone } from '@/shared/types';
import { Badge, DataTable, EmptyState } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * THE LAST TWENTY SITTINGS: each time a hunter sat down, newest first, and how it ended. Bounded at twenty, it stands
 * above the skipped units, whose list only grows.
 *
 * AN ENDING IS SAID IN THE READER'S WORDS, never the store's: "Wound down at the time limit", not `wound down`.
 * Most endings are routine and are plain ink. Two are not, and each wears its mark with its word: a sitting that
 * FAILED (amber), and one that is WAITING on a usage limit or is still out (the quiet blue of work in hand). An
 * ending this file has no words for is shown as the house wrote it, never dropped.
 *
 * A FAILURE'S CAUSE IS IN THE ROW, under its ending, in the house's own sentence: nothing here is said only on hover.
 *
 * THE ENDING STANDS THIRD, after the night and the hunter and before the project: this table is asked how the nights
 * went, and on a 390 px phone those three are the columns that stand without scrolling.
 *
 * A HUNTER AND A PROJECT ARE NAMED AS A PERSON NAMES THEM (`hunterWord`, `nameOf`).
 */

type DashboardHunterNightsProps = {
  /** The newest 20 sittings, newest first. */
  sittings: HuntSittingRow[];
  /** A hunt's kind as a word: "Security". */
  hunterWord: (hunt: string) => string;
  /** A project's folder as its name: "Restorly connector". */
  nameOf: (project: string) => string;
};

/** A sitting with its place in the answer, which is its only identity: two sittings of one night may share hunter and project. */
type NumberedSitting = HuntSittingRow & { place: number };

/** The endings that wear a mark, each with its tone. `out` is a sitting with no ending yet. */
const OUTCOME_TONES: Record<string, Tone> = { failed: 'warn', waiting: 'info', out: 'info' };

/** Rendered by DashboardHunters, under the hunters' groups and above the skips. Nothing else mounts it. */
export function DashboardHunterNights({ sittings, hunterWord, nameOf }: DashboardHunterNightsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const rows: NumberedSitting[] = sittings.map((sitting, place) => ({ ...sitting, place }));

  /** How a sitting ended: its words, marked when the ending is one to notice, with the cause under it when there is one. */
  const ending = (sitting: NumberedSitting) => {
    const outcome = sitting.outcome ?? 'out';
    const words = t(`kanban.dashboard.hunters.outcome.${outcome}`, { defaultValue: outcome });
    const tone = OUTCOME_TONES[outcome];
    return (
      <span className="flex min-w-36 max-w-xs flex-col items-start gap-1" data-hunter-outcome={outcome}>
        {tone === undefined ? <span>{words}</span> : <Badge as="span" tone={tone} className="vv-badge--compact">{words}</Badge>}
        {sitting.cause !== null && <span className="break-words text-xs text-muted-foreground">{sitting.cause}</span>}
      </span>
    );
  };

  const columns: DataTableColumn<NumberedSitting>[] = [
    { key: 'night', label: t('kanban.dashboard.hunters.nights.columns.night'), render: (sitting) => <span className="whitespace-nowrap">{formatShortDate(sitting.night) ?? sitting.night}</span> },
    { key: 'hunter', label: t('kanban.dashboard.hunters.nights.columns.hunter'), render: (sitting) => <span className="whitespace-nowrap">{hunterWord(sitting.hunt)}</span> },
    { key: 'outcome', label: t('kanban.dashboard.hunters.nights.columns.outcome'), render: ending },
    { key: 'project', label: t('kanban.dashboard.hunters.nights.columns.project'), render: (sitting) => <span className="whitespace-nowrap">{nameOf(sitting.project)}</span> },
    { key: 'minutes', label: t('kanban.dashboard.hunters.nights.columns.minutes'), align: 'end', render: (sitting) => sitting.minutes.toLocaleString() },
    { key: 'covered', label: t('kanban.dashboard.hunters.nights.columns.covered'), align: 'end', render: (sitting) => sitting.covered.toLocaleString() },
    { key: 'tickets', label: t('kanban.dashboard.hunters.nights.columns.tickets'), align: 'end', render: (sitting) => sitting.tickets.toLocaleString() },
  ];

  return (
    <div className="flex flex-col gap-3" role="group" aria-labelledby={headingId} data-hunter-nights={sittings.length}>
      <div className="flex flex-col gap-0.5">
        <h4 id={headingId} className="text-sm font-semibold text-foreground">{t('kanban.dashboard.hunters.nights.title')}</h4>
        <p className="text-xs text-muted-foreground">{t('kanban.dashboard.hunters.nights.about')}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.hunters.nights.empty')} />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(sitting) => String(sitting.place)} label={t('kanban.dashboard.hunters.nights.title')} />
      )}
    </div>
  );
}
