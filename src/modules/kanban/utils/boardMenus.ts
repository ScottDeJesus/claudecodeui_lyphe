import type { TFunction } from 'i18next';

import { DONE_LANE_ID, type KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';
import type { KanbanViewSort } from '@/modules/kanban/utils/cardModel';
import type { ActionMenuItem, KanbanCardModel } from '@/shared/ui';

/**
 * WHAT EACH `…` OFFERS — the lane's overflow and the card's, composed as data the kit paints.
 *
 * A MENU IS POLICY, NOT LAYOUT, which is why it is composed here and not in the panel: which rows
 * exist, which one takes a divider and which one is danger is the same kind of decision as which
 * lanes exist, and it is the panel's job only to hand over the verbs each row calls. This is also
 * the ONLY way to move a card on a touch screen — HTML5 drag never fires on a coarse pointer — so
 * every lane a card could be dragged to is a row here, and a lane policy that grows a lane grows
 * these rows without anyone remembering to come back.
 *
 * ROWS ARE `kanban.laneMenu.*`, lane TITLES ARE `kanban.lanes.*` — a word apart, not a letter.
 *
 * A REFUSAL IS NOT HANDLED HERE. Every row raises, and the panel's mutation toasts whatever the
 * server said about it; a menu that swallowed its own failures would be a second place the board
 * decides what went wrong.
 */

export type LaneMenuActions = {
  t: TFunction;
  /** Collapse to the lane's spine — its title and its count, which is what a reader keeps. */
  onCollapse: () => void;
  /** A view sort over the cards already loaded. Paging continues in the server's own order. */
  onSort: (sort: KanbanViewSort) => void;
  /** Archive every card in the lane. Nothing is deleted; the lane simply empties. */
  onClear: () => void;
};

export type CardMenuActions = {
  t: TFunction;
  onOpen: (cardId: string) => void;
  /** Into the named lane's END, at its intake status — never at a position the reader did not pick. */
  onMoveTo: (cardId: string, laneId: string) => void;
  onArchive: (cardId: string) => void;
};

/** One lane's overflow, in the order the rows are read. */
export function laneMenuItems(spec: KanbanLaneSpec, actions: LaneMenuActions): ActionMenuItem[] {
  const { t, onCollapse, onSort, onClear } = actions;

  const items: ActionMenuItem[] = [
    { key: `${spec.id}-collapse`, label: t('kanban.laneMenu.collapse'), onSelect: onCollapse },
    { key: `${spec.id}-sort-priority`, label: t('kanban.laneMenu.sortByPriority'), onSelect: () => onSort('priority') },
    { key: `${spec.id}-sort-newest`, label: t('kanban.laneMenu.sortByNewest'), onSelect: () => onSort('newest') },
  ];

  if (spec.id === DONE_LANE_ID) {
    items.push({
      key: `${spec.id}-clear`,
      label: t('kanban.laneMenu.clearDone'),
      isDanger: true,
      showDividerBefore: true,
      onSelect: onClear,
    });
  }

  return items;
}

/**
 * One card's menu, curried so the lane can hold it: `cardMenuItems(spec)(card)` is what the kit
 * asks for, and the card is the only thing that varies per row.
 */
export function cardMenuItems(
  spec: KanbanLaneSpec,
  lanes: KanbanLaneSpec[],
  actions: CardMenuActions
): (card: KanbanCardModel) => ActionMenuItem[] {
  const { t, onOpen, onMoveTo, onArchive } = actions;

  return (card) => [
    { key: `${card.id}-open`, label: t('kanban.card.open'), onSelect: () => onOpen(card.id) },
    ...lanes
      .filter((target) => target.id !== spec.id)
      .map((target, index) => ({
        key: `${card.id}-move-${target.id}`,
        label: t('kanban.card.moveTo', { lane: t(target.titleKey) }),
        // One divider above the first: the move rows are a group, and a rule between every pair
        // would turn a four-row list into four sections.
        showDividerBefore: index === 0,
        onSelect: () => onMoveTo(card.id, target.id),
      })),
    {
      key: `${card.id}-archive`,
      label: t('kanban.card.archive'),
      isDanger: true,
      showDividerBefore: true,
      onSelect: () => onArchive(card.id),
    },
  ];
}
