import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanFixTime, KanbanStats } from '@/shared/kanban-types';
import { Button, Readout } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

/**
 * THE NUMBERS: how many cards are open, how many at each priority, the oldest open high card, and how long a fix
 * takes. The dashboard's first section, because it is the answer the face is opened for.
 *
 * ONE LARGE FIGURE: the open count. Every other number here stands beside it at the smaller weight, so the eye lands
 * once. THE ONLY AMBER IS AN OPEN HIGH CARD: the High count wears the warn tone (and its glyph) while it is not zero,
 * the same fact the Dashboard tab's pill says. Everything else is ink. Under the count, one quiet line says where
 * those cards stand, lane by lane in the board's own order: an open count means one thing when the cards are being
 * worked on and another when they wait on an answer.
 *
 * THE OLDEST OPEN HIGH CARD IS A PRESS. Its age is the figure and its title, whole, is the button under it: the way to
 * the card sits beside the number that sent the reader looking. With every board in scope the press names the card's
 * board too. No open high card is said in words ("None"), never as a zero or a dash: it is a reading, and a good one.
 *
 * TIME TO FIX IS THE MEDIAN, with what it is compared to under it: nine fixes in ten were within the second figure,
 * over that many fixed cards. A priority at which nothing was fixed in the window is an em-dash, never `0 h`.
 */

type DashboardNumbersProps = {
  /** The board's own numbers for the scope and window asked. */
  stats: KanbanStats;
  /** True when every board is in scope: a card is then named with its board. */
  allBoards: boolean;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The open lanes in the board's own order, each with the key of its title. */
const OPEN_LANES = [
  { status: 'not_ready', key: 'kanban.lanes.backlog' },
  { status: 'todo', key: 'kanban.lanes.todo' },
  { status: 'questions', key: 'kanban.lanes.questions' },
  { status: 'active', key: 'kanban.lanes.active' },
] as const;

/** Below this many hours a fix time is said in hours; from it on, in days. */
const HOURS_AS_DAYS_FROM = 48;

/** A stretch of hours as the figure a person reads, and the key of its unit: `40 min`, `4.5 h`, `31 h`, `3.2 days`. */
function fixTime(hours: number): { figure: string; unitKey: string } {
  if (hours < 1) return { figure: String(Math.max(1, Math.round(hours * 60))), unitKey: 'kanban.dashboard.units.min' };
  if (hours < HOURS_AS_DAYS_FROM) return { figure: hours < 10 ? hours.toFixed(1) : String(Math.round(hours)), unitKey: 'kanban.dashboard.units.h' };
  return { figure: (hours / 24).toFixed(1), unitKey: 'kanban.dashboard.units.days' };
}

/** Rendered by BugDashboard, first. Nothing else mounts it. */
export function DashboardNumbers({ stats, allBoards, onOpenCard }: DashboardNumbersProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const fixHeadingId = useId();
  const { open, oldestOpenHigh: oldest, timeToFix, scope } = stats;
  const unknownLabel = t('kanban.dashboard.unknown');

  const fixReadout = (labelKey: string, time: KanbanFixTime) => {
    if (time === null) {
      return <Readout label={t(labelKey)} value={null} unknownLabel={unknownLabel} note={t('kanban.dashboard.fix.none', { days: scope.days })} />;
    }
    const median = fixTime(time.medianHours);
    const p90 = fixTime(time.p90Hours);
    return (
      <Readout
        label={t(labelKey)}
        value={median.figure}
        unit={t(median.unitKey)}
        unknownLabel={unknownLabel}
        note={t('kanban.dashboard.fix.note', { count: time.count, p90: `${p90.figure} ${t(p90.unitKey)}` })}
      />
    );
  };

  return (
    <section className="flex flex-col gap-7" aria-labelledby={headingId} data-dashboard-numbers>
      <h3 id={headingId} className="sr-only">{t('kanban.dashboard.numbers.title')}</h3>

      <div className="grid items-start gap-x-12 gap-y-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <Readout size="lg" label={t('kanban.dashboard.numbers.open')} value={open.total} unknownLabel={unknownLabel} />
            <Readout label={t('kanban.priority.high')} value={open.byPriority.high} tone={open.byPriority.high > 0 ? 'warn' : undefined} unknownLabel={unknownLabel} />
            <Readout label={t('kanban.priority.medium')} value={open.byPriority.medium} unknownLabel={unknownLabel} />
            <Readout label={t('kanban.priority.low')} value={open.byPriority.low} unknownLabel={unknownLabel} />
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t('kanban.dashboard.numbers.byLane')} data-dashboard-by-lane>
            {OPEN_LANES.map((lane) => (
              <div key={lane.status} className="flex items-baseline gap-1.5">
                <dt>{t(lane.key)}</dt>
                <dd className="font-mono tabular-nums text-foreground">{open.byLane[lane.status]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex min-w-0 flex-col gap-2" data-dashboard-oldest-high>
          {oldest === null ? (
            <Readout
              label={t('kanban.dashboard.numbers.oldestHigh')}
              value={t('kanban.dashboard.numbers.oldestHighNone')}
              unknownLabel={unknownLabel}
              note={t('kanban.dashboard.numbers.oldestHighNoneNote')}
            />
          ) : (
            <>
              <Readout
                label={t('kanban.dashboard.numbers.oldestHigh')}
                value={oldest.ageDays}
                unit={t('kanban.dashboard.units.day', { count: oldest.ageDays })}
                unknownLabel={unknownLabel}
                note={t('kanban.dashboard.numbers.openedOn', { date: formatShortDate(oldest.createdAt) ?? '—' })}
              />
              <Button
                variant="outline"
                className="h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-3 py-2 text-left font-normal finger:min-h-11"
                data-dashboard-card={oldest.cardId}
                onClick={() => onOpenCard(oldest.cardId, oldest.boardId)}
              >
                <span className="min-w-0 flex-1 break-words text-sm leading-snug text-foreground">{oldest.title}</span>
                {allBoards && <span className="shrink-0 text-xs text-muted-foreground">{oldest.boardName}</span>}
                <ChevronRight className="shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3" role="group" aria-labelledby={fixHeadingId} data-dashboard-fix-time>
        <div className="flex flex-col gap-0.5">
          <h4 id={fixHeadingId} className="text-sm font-semibold text-foreground">{t('kanban.dashboard.fix.title')}</h4>
          <p className="text-xs text-muted-foreground">{t('kanban.dashboard.fix.about', { days: scope.days })}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
          {fixReadout('kanban.dashboard.fix.all', timeToFix.all)}
          {fixReadout('kanban.priority.high', timeToFix.high)}
          {fixReadout('kanban.priority.medium', timeToFix.medium)}
          {fixReadout('kanban.priority.low', timeToFix.low)}
        </div>
      </div>
    </section>
  );
}
