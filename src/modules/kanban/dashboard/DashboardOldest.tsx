import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanAgedOpenCard, KanbanStatus } from '@/shared/kanban-types';
import type { DataTableColumn } from '@/shared/types';
import { Badge, Button, DataTable, EmptyState } from '@/shared/ui';

/**
 * THE TEN OLDEST OPEN CARDS: what has waited longest, oldest first, in the order the server read them.
 *
 * THE TITLE IS THE PRESS. It is the row's name and its first column, which the table holds still while the rest
 * scrolls sideways on a phone, so the way to the card is always under the thumb. It opens the card on its board.
 * 44 px under a finger.
 *
 * HOW LONG IT HAS BEEN OPEN STANDS NEXT TO THE TITLE, before its priority and lane: the list is ordered by it, and on
 * a phone the two columns that fit without scrolling are then the two the list is about. The title holds 224 px of a
 * 390 px phone's 356, so it wraps to two or three lines and "Open for" still stands whole beside it.
 *
 * A PRIORITY AND A LANE ARE WORDS, never a colour alone. High is the one priority that wears a mark, the same amber
 * the numbers above give it; medium and low are plain ink. A lane is named as the board names it.
 *
 * WITH EVERY BOARD IN SCOPE each card is named with its board, in a column of its own. On one board that column would
 * say the same word ten times, so it is not drawn.
 */

type DashboardOldestProps = {
  /** The ten oldest open cards, oldest first. */
  cards: KanbanAgedOpenCard[];
  /** True when every board is in scope. */
  allBoards: boolean;
  /** Opens a card on its board. */
  onOpenCard: (cardId: string, boardId: string) => void;
};

/** The lane each open status is drawn in, as the board's own lane titles name it. */
const LANE_KEYS: Record<KanbanStatus, string> = {
  not_ready: 'kanban.lanes.backlog',
  todo: 'kanban.lanes.todo',
  questions: 'kanban.lanes.questions',
  active: 'kanban.lanes.active',
  done: 'kanban.lanes.done',
};

/** Rendered by BugDashboard, third. Nothing else mounts it. */
export function DashboardOldest({ cards, allBoards, onOpenCard }: DashboardOldestProps) {
  const { t } = useTranslation();
  const headingId = useId();

  const columns: DataTableColumn<KanbanAgedOpenCard>[] = [
    {
      key: 'card',
      label: t('kanban.dashboard.oldest.columns.card'),
      render: (card) => (
        <Button
          variant="ghost"
          className="-mx-2 h-auto min-h-9 min-w-56 justify-start gap-1.5 whitespace-normal px-2 py-1 text-left font-medium finger:min-h-11"
          data-dashboard-card={card.cardId}
          onClick={() => onOpenCard(card.cardId, card.boardId)}
        >
          <span className="min-w-0 flex-1 break-words leading-snug text-foreground">{card.title}</span>
          <ChevronRight className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      ),
    },
    {
      key: 'age',
      label: t('kanban.dashboard.oldest.columns.age'),
      align: 'end',
      render: (card) => <span className="whitespace-nowrap">{card.ageDays === 0 ? t('kanban.dashboard.ageToday') : t('kanban.dashboard.age', { count: card.ageDays })}</span>,
    },
    {
      key: 'priority',
      label: t('kanban.dashboard.oldest.columns.priority'),
      render: (card) =>
        card.priority === 'high'
          ? <Badge tone="warn" className="vv-badge--compact">{t('kanban.priority.high')}</Badge>
          : t(`kanban.priority.${card.priority}`),
    },
    { key: 'lane', label: t('kanban.dashboard.oldest.columns.lane'), render: (card) => <span className="whitespace-nowrap">{t(LANE_KEYS[card.status])}</span> },
    ...(allBoards ? [{ key: 'board', label: t('kanban.dashboard.oldest.columns.board'), render: (card: KanbanAgedOpenCard) => card.boardName }] : []),
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId} data-dashboard-oldest>
      <h3 id={headingId} className="text-sm font-semibold text-foreground">{t('kanban.dashboard.oldest.title')}</h3>
      {cards.length === 0 ? (
        <EmptyState size="sm" title={t('kanban.dashboard.oldest.empty')} />
      ) : (
        <DataTable rows={cards} columns={columns} rowKey={(card) => `${card.boardId}/${card.cardId}`} label={t('kanban.dashboard.oldest.title')} />
      )}
    </section>
  );
}
