import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanLaneSpine } from '@/modules/kanban/KanbanLaneSpine';
import type { KanbanDrag, KanbanMoveResult } from '@/modules/kanban/hooks/useKanbanDrag';
import type { KanbanLanes } from '@/modules/kanban/hooks/useKanbanLanes';
import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { cardMenuItems, laneMenuItems } from '@/modules/kanban/utils/boardMenus';
import type { KanbanViewSort } from '@/modules/kanban/utils/cardModel';
import type { KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';
import { KanbanLane } from '@/shared/ui';

/**
 * THE LANE STRIP: one lane per spec, a spine for each the reader folded away, and the ←/→ walk
 * between them.
 *
 * IT TAKES THE HOOKS RATHER THAN A CARD AND A COUNT PER LANE. The alternative — the panel mapping
 * the lanes and handing down fifteen props per column — puts the same list in two files and gives
 * the panel a reason to re-render on every frame that arrives. Here the rail is the ONLY thing that
 * paints a lane, and the panel above it paints chrome and the board's four states.
 *
 * IT DECIDES NOTHING ABOUT THE BOARD. Which lanes exist, what a lane holds, where a card lands and
 * what each `…` offers all arrive from `lanePolicy`, the lanes hook, the drag hook and the
 * mutations. This file is the wiring between four things that were built to meet here.
 *
 * ONE THING IT DOES DECIDE, because no one else can: WHERE FOCUS LANDS AFTER A MOVE. A card that
 * changes lanes is unmounted here and mounted there, and the kit — which sees only its own lane —
 * says so and stops. This is the strip that holds every lane at once, so this is the file that puts
 * the reader back on their card. See `requestFocus` below.
 */

type KanbanRailProps = {
  /** The lanes `kanbanLanes(autonomy)` composed, left to right. */
  specs: KanbanLaneSpec[];
  /** The lanes hook's whole surface: the cards, counts, paging and the open card. */
  board: KanbanLanes;
  /** Where a card lands — one resolver behind the drop, the keys and the menu rows. */
  drag: KanbanDrag;
  /** The verbs the menus and the `+` call. */
  writes: Pick<KanbanMutations, 'createCard' | 'archiveCard' | 'clearLane'>;
  /** The open board, for the one write a `+` makes. */
  boardId: string | null;
  /** The view sort each lane is painted in — the panel's own state, per SCREEN. */
  sorts: Record<string, KanbanViewSort>;
  /** Which lanes are folded to their spine. */
  collapsed: Record<string, boolean>;
  onSort: (laneId: string, sort: KanbanViewSort) => void;
  /** `false` re-opens a lane; the spine does it too, and both write the same map. */
  onCollapse: (laneId: string, collapsed: boolean) => void;
};

/** Rendered by KanbanPanel in place of the rail it used to hold inline. Nothing else mounts it. */
export function KanbanRail({
  specs,
  board,
  drag,
  writes,
  boardId,
  sorts,
  collapsed,
  onSort,
  onCollapse,
}: KanbanRailProps) {
  const { t } = useTranslation();
  const railRef = useRef<HTMLDivElement | null>(null);

  /** A lane's view sort. `server` is the API's own order, which is the order paging follows. */
  const sortFor = (laneId: string): KanbanViewSort => sorts[laneId] ?? 'server';

  /**
   * WHERE FOCUS LANDS AFTER A MOVE — the board's decision, and deliberately nobody else's.
   *
   * A move ACROSS lanes takes the card out of one lane's list and mounts it in another's, and a
   * remounted node is a different node: focus falls to `<body>` with the old one, so the reader's
   * next keypress goes nowhere at all. The kit says as much at its own `handleCardMove` — "where
   * focus lands then is the board's decision … it is the only thing that can see both lanes" — and
   * this is the board taking it: the card, BY ID, in whichever lane it now sits in. By id and not
   * by index, because the move is precisely what makes every index stale.
   *
   * The request is served ONCE, after the render that painted the move, and then dropped. A request
   * that stayed armed until it found its card would eventually fire on some later render and pull
   * focus back from wherever the reader had moved on to; a card that is not on screen — moved into a
   * lane the reader has folded to its spine — is simply nowhere to put focus, and the live region
   * has already said where it went.
   *
   * The lane's own roving Tab stop is NOT moved with the card, and cannot be: that index belongs to
   * the kit and `src/shared/ui` is closed to this phase. A reader who Tabs out of the strip and back
   * in lands on the target lane's first card, which is where a lane is entered from anywhere else.
   * What the ruling needs is that a move never strands the reader mid-keystroke, and that is this.
   */
  const [focusRequest, setFocusRequest] = useState<{ cardId: string; seq: number } | null>(null);
  const focusSeq = useRef(0);

  const requestFocus = useCallback((cardId: string) => {
    // A sequence number, not the id alone: a card put back where it came from asks for focus a
    // second time with the same id, and a request that did not change would not be a request.
    focusSeq.current += 1;
    setFocusRequest({ cardId, seq: focusSeq.current });
  }, []);

  useEffect(() => {
    if (focusRequest === null) return;
    railRef.current
      ?.querySelector<HTMLElement>(`[data-card-id="${focusRequest.cardId}"]`)
      ?.focus();
    setFocusRequest(null);
  }, [focusRequest]);

  /**
   * One move, and the focus the board owes the reader after it.
   *
   * `landed` is the card the server placed, or `null` when nothing did — and a REFUSED move is a
   * card pushed back into the lane it came from, which remounts it a second time. Focus is handed
   * back to it there as well: a refusal already has a toast, and a toast is not a place on the
   * board.
   */
  const moveWithFocus = useCallback(
    (cardId: string, run: () => Promise<KanbanMoveResult>) => {
      requestFocus(cardId);
      void run().then((landed) => {
        if (!landed) requestFocus(cardId);
      });
    },
    [requestFocus]
  );

  /** A `+`: a card in this lane's FIRST status, then opened — the drawer is where a title is typed,
   *  and a card created and left closed is a card under a name nobody chose. */
  const addCard = async (spec: KanbanLaneSpec) => {
    if (!boardId) return;
    const card = await writes.createCard(boardId, {
      title: t('kanban.card.untitled'),
      status: spec.statuses[0],
    });
    if (card) board.openCard(card.id);
  };

  /** ←/→ CROSSES LANES at the same height — the lane answers ↑/↓/Home/End and lets these two
   *  bubble, because only the rail sees two lanes at once. The index is clamped rather than carried
   *  blindly, so leaving a long lane for a short one lands on its last card. */
  const crossLane = (event: KeyboardEvent<HTMLDivElement>, step: -1 | 1) => {
    const origin = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-card-id]') : null;
    if (!origin) return;

    const fromId = origin.closest<HTMLElement>('[data-lane-id]')?.dataset.laneId;
    const at = specs.findIndex((spec) => spec.id === fromId);
    const target = specs[at + step];
    if (at < 0 || !target) return;

    const ids = board.cardIds(target.id, sortFor(target.id));
    if (ids.length === 0) return;

    const here = board.cardIds(fromId ?? '', sortFor(fromId ?? '')).indexOf(origin.dataset.cardId ?? '');
    const landed = railRef.current?.querySelector<HTMLElement>(
      `[data-lane-id="${target.id}"] [data-card-id="${ids[Math.max(0, Math.min(here, ids.length - 1))]}"]`
    );
    if (!landed) return;

    event.preventDefault();
    landed.focus();
  };

  /** Every row either `…` offers, with the verb each one calls. */
  const menus = (spec: KanbanLaneSpec) => ({
    lane: laneMenuItems(spec, {
      t,
      onCollapse: () => onCollapse(spec.id, true),
      // A VIEW, NOT A FETCH: paging continues in server order and the sort is re-applied to the
      // whole loaded set on every render, which is what keeps an appended page out of the middle.
      onSort: (sort: KanbanViewSort) => onSort(spec.id, sort),
      // Archive, never delete: the cards are still on the board and still there if the lane is read
      // again tomorrow. Danger because it moves many cards at once.
      onClear: () => {
        void writes.clearLane(board.cardIds(spec.id, sortFor(spec.id)));
      },
    }),
    card: cardMenuItems(spec, specs, {
      t,
      onOpen: board.openCard,
      // The menu row a touch board moves a card with — the same move, the same focus, and the same
      // reason for it: the card it names is unmounted from this lane the moment the row is pressed.
      onMoveTo: (cardId, laneId) => moveWithFocus(cardId, () => drag.moveCardToLane(cardId, laneId)),
      onArchive: (cardId) => {
        void writes.archiveCard(cardId, board.summaryOf(cardId));
      },
    }),
  });

  // `vv-board` declares the lane width every lane inherits and narrows it under 640px, so the next
  // lane peeks — the only thing telling a phone reader there is more board than this. TWO RECORDED
  // DIVERGENCES from the plan's density note (`h-full … px-3 pb-3`), both named in this phase's
  // report, not just here: `flex-1` replaces `h-full`, which under the 48px header overflows the tab
  // by that header; `p-3` replaces `px-3 pb-3`, written before `.vv-lane` had a 1px border that
  // stacks with the header's rule into a doubled line.
  return (
    <div
      ref={railRef}
      className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') crossLane(event, -1);
        else if (event.key === 'ArrowRight') crossLane(event, 1);
      }}
    >
      {specs.map((spec) => {
        const view = board.laneView(spec, sortFor(spec.id));
        const items = menus(spec);

        if (collapsed[spec.id]) {
          return (
            <KanbanLaneSpine
              key={spec.id}
              laneId={spec.id}
              title={t(spec.titleKey)}
              count={view.count}
              onExpand={() => onCollapse(spec.id, false)}
            />
          );
        }

        return (
          <KanbanLane
            key={spec.id}
            laneId={spec.id}
            title={t(spec.titleKey)}
            count={view.count}
            cards={view.cards}
            selectedCardId={board.selectedCardId}
            muted={spec.muted}
            loading={view.loading}
            hasMore={view.hasMore}
            loadingMore={view.loadingMore}
            onLoadMore={() => { void board.loadMore(spec.id); }}
            onOpenCard={board.openCard}
            onDropCard={(cardId, laneId, index) => moveWithFocus(cardId, () => drag.dropCard(cardId, laneId, index))}
            onMoveCard={(cardId, dx, dy) => moveWithFocus(cardId, () => drag.moveCard(cardId, dx, dy))}
            onAddCard={spec.canAdd ? () => { void addCard(spec); } : undefined}
            cardMenuItems={items.card}
            menuItems={items.lane}
          />
        );
      })}
    </div>
  );
}
