import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSnapStrip } from '@/modules/dispatcher/hooks/useSnapStrip';
import { SnapStrip } from '@/modules/dispatcher/SnapStrip';
import { StatusFlow } from '@/modules/dispatcher/StatusFlow';
import type { LaneFlow } from '@/shared/types';

/**
 * An arc deck's plans as ONE horizontal strip, one card per view — AN ARC'S LAYOUT IN BOTH HOMES, the
 * Roadmap tab's In flight face as much as the chat gutter's widget, so a reader who has paged one has
 * paged the other (operator, 2026-09-26: the swipable plan cards came back under an arc). The face has
 * the width for a wall, and an arc's plans do not use it: they are a set of things that walk in order, and one whole
 * card at a time is how a reader reads one. Top to bottom: the arc's flow of plans, the nav row, and
 * the strip — the last two are `SnapStrip`, the one strip shape a round's questions are paged by too,
 * whose own rules are there.
 *
 * THE FLOW IS THE STRIP'S MAP. Every plan of the arc is a node on it, and the node of the card in
 * view is the selected one; pressing any node pages the strip straight to that card (`goTo`), a
 * smooth centring scroll, however far along the arc it is. An arc of more plans than the row holds
 * scrolls its flow sideways (`StatusFlow`): it opens on the node of the card the strip opens on
 * (`focusIndex`) and follows the card in view as the strip is paged.
 *
 * THE FOCUSED CARD is centred on mount and again whenever `focusIndex` changes — the arc's first plan
 * that still has a walk in front of it (`deckFocusIndex`). The nav row reads `Card N of M`.
 *
 * `data-arc-strip`, `data-arc-viewing`, `data-arc-prev` and `data-arc-next` are the browser harness's
 * handles.
 *
 * Used by `DeckFrame`, as the body of every arc deck: the In flight face's and the chat gutter widget's.
 */
export function DeckStrip({
  flow,
  stripLabel,
  focusIndex,
  cardCount,
  children,
}: {
  /** The arc's plans as a track: the map the strip is paged by. */
  flow: LaneFlow;
  /** What a screen reader hears for the strip. */
  stripLabel: string;
  /** The card the strip opens on, and returns to when the arc moves. */
  focusIndex: number;
  /** How many cards the strip holds — the arrows' own count. */
  cardCount: number;
  /** The strip's items — one `SnapStripItem` per card, in the arc's own order, which is the flow's order too. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const strip = useSnapStrip(Math.max(focusIndex, 0), cardCount);
  const { view, goTo } = strip;

  return (
    <>
      <StatusFlow
        nodes={flow.nodes}
        doneCount={flow.doneCount}
        selected={flow.nodes[view.index]?.key ?? null}
        current={flow.nodes[Math.max(focusIndex, 0)]?.key ?? null}
        onSelect={(key) => goTo(flow.nodes.findIndex((node) => node.key === key))}
        ariaLabel={flow.ariaLabel}
      />
      <SnapStrip
        strip={strip}
        handle="arc"
        stripLabel={stripLabel}
        itemCount={cardCount}
        previousLabel={t('dispatcher.pager.previousPlan')}
        nextLabel={t('dispatcher.pager.nextPlan')}
        viewingLabel={t('dispatcher.pager.plan', { n: view.index + 1, total: cardCount })}
      >
        {children}
      </SnapStrip>
    </>
  );
}
