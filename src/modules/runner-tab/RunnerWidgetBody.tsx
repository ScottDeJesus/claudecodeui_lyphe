import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { byArc, HiddenPlans, LoosePlannerBadges, useDispatcherPlans } from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { WidgetPager } from '@/modules/runner-tab/WidgetPager';
import { EmptyState } from '@/shared/ui';

/**
 * The dispatcher's lane as the desktop chat gutter draws it: a PAGER over the lane's top-level items,
 * ONE at a time, the open chat's first (`WidgetPager`).
 *
 * THE SECOND HOME, BESIDE THE TRANSCRIPT AND NEVER OVER IT. The Runner tab is the card's other home,
 * and it draws the whole lane at once; here the lane is company for a conversation that is still
 * the point, so the column is the gutter's own flush width, one card wide, and it shows one page: an
 * arc's deck, which pages its own plans in its own strip (`DispatchArcDecks`' `home="gutter"`), or one
 * plan of no arc as its card. The row over the page reads `‹ n of total ›` and carries the lane's
 * `Hide ended · N`; `Hidden · N` sits under the card as the way back from any hide.
 *
 * THE PAGES ARE THE TAB'S SPLIT, LIFTED FOR THIS CHAT. The lane is split by the one rule both homes
 * read (`byArc`): the arcs in the lane's order, then the plans of no arc by urgency. The pager lifts
 * the pages holding a plan this chat opened to the front, and holds the page the reader is on by KEY,
 * so a poll never turns it. It is keyed by the chat below, so opening another chat starts again on
 * THAT chat's first page.
 *
 * THE FOLDS ARE THE TAB'S FOLDS, AND THIS BODY PRUNES THE SAME MEMORY. `useLaneFoldPrune` hands the
 * fold store what this widget draws AND what it has hidden, so a card folded here is folded on the tab,
 * a card shown again keeps its fold, and the folds of cards that have left the lane go with them — one
 * memory, two homes. Nothing here folds a card for space: the pager shows one page, whole.
 *
 * `data-runner-widget` is the root's handle — this home's boundary, which a card's Hide looks inside for
 * the next place to put the keyboard (`LaneCardHead`), exactly as it looks inside `data-runner-panel`.
 *
 * IT READS THE BUS AND DRAWS NO FRAME. `useDispatcherPlans` hands it the retained picture, so it
 * paints on its first render; the page it is on is the pager's one piece of state, and the chrome, the
 * slots and the scrolling belong to `src/modules/chat-gutters`.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), as the Runner widget's body.
 */
export function RunnerWidgetBody({ sessionId }: { sessionId: string | null }) {
  const { t } = useTranslation();
  const { plans, hidden, arcs, loosePlanners, carriedNames } = useDispatcherPlans();
  // The lane split once, by the one rule both homes read; the pager turns it into pages.
  const split = useMemo(() => byArc(plans, arcs), [plans, arcs]);
  useLaneFoldPrune(plans, hidden, arcs);

  // The empty state speaks of the LANE: a planner outing with no card at all is on this lane too — a
  // soul out on an arc the store has no row for yet — even though nothing here can draw it a page. The
  // hidden list rides under it, because a lane whose every plan is hidden must still offer the way
  // back, and the words then say "hidden", never "nothing is running": a hidden plan may still walk.
  if (plans.length === 0 && arcs.length === 0 && loosePlanners.length === 0) {
    return (
      <div data-runner-widget className="flex min-w-0 flex-col gap-4">
        <EmptyState icon={ActivityIcon} title={t(hidden.length > 0 ? 'dispatcher.hidden.allHidden' : 'runner.empty')} />
        <HiddenPlans hidden={hidden} carriedNames={carriedNames} />
      </div>
    );
  }

  return (
    <div data-runner-widget className="flex min-w-0 flex-col gap-4">
      {/* The outings with no deck to be drawn in, above the pages — the tab's own arrangement
          (`LoosePlannerBadges`). It draws nothing when there are none. */}
      <LoosePlannerBadges planners={loosePlanners} />
      <WidgetPager
        key={sessionId ?? ''}
        split={split}
        plans={plans}
        hidden={hidden}
        carriedNames={carriedNames}
        sessionId={sessionId}
      />
    </div>
  );
}
