import { ActivityIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  byArc,
  DispatchArcDecks,
  endedHide,
  HiddenPlans,
  LoosePlannerBadges,
  PlanCard,
  planHide,
  useDispatcherPlans,
} from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { LANE_WALL_GRID } from '@/shared/constants';
import { Badge, Button, EmptyState, ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The Runner tab's pane: every plan the dispatcher is carrying, each as a whole card.
 *
 * IT READS THE BUS AND NOTHING ELSE. `useDispatcherPlans` hands it the retained `dispatcher:all`
 * value, so this pane paints on its FIRST render with whatever the bus was already holding rather
 * than blank until the dispatcher next moves — which is what makes selecting the tab feel instant. It
 * fetches nothing on mount and owns no state of its own; the seed and the socket are `DispatcherFeed`'s
 * job, one level up and one module-internal file away.
 *
 * THE CARD ITSELF FOLDS, ONE BUTTON PER HEADER, AND THIS PANE PRUNES THE MEMORY. The fold is the
 * house's own (`CardFoldToggle` over `useCardFold`, the chevron the chat's shape cards wear), and
 * `useLaneFoldPrune` hands the fold store the cards this lane still carries, drawn and hidden alike,
 * through the same hook the gutter widget calls, so the two homes cannot disagree about which folds are
 * worth keeping.
 *
 * THE COUNT IS OF THE CARDS DRAWN — plans paused, queued and ended included, the hidden ones not — and
 * it agrees with the tab's badge because both read the same `count` off the same hook: the badge from
 * `useWorkspaceTabGates`, this header from here, one value with two readers. A badge of 3 over a panel
 * of 2 cards would make a liar of one of them.
 *
 * `data-runner-panel` is the browser harness's handle, on the ROOT: a probe scopes every reading to
 * THIS pane, so a card the operator's own lane puts on screen at the same moment is never mistaken
 * for the one under test.
 *
 * THE PANE IS A WALL, AND AN ARC IS NOT A ROW OF IT. The plans NO arc holds are drawn whole in an
 * auto-fill grid across the pane's full width (`LANE_WALL_GRID`), because the glance face makes those
 * cards short and alike — a head, a track of nodes, a caption and at most a few lines of what is
 * moving — and short, alike cards read best side by side, where a measured column stacked them into
 * one long scroll and left most of a desktop workspace empty. On a phone the same grid is one card a
 * row. A PLAN OF AN ARC IS NOT ONE OF THOSE: it is paged in its arc's strip, one card per view
 * (`DeckStrip`; operator, 2026-09-26: "please bring back the swipable plan cards if it's under an
 * arc"), so the wall here is one layout for the loose plans and the strip is another for the arcs.
 *
 * THE PLANS ARE NESTED BY ARC. The lane is split by ONE rule (`byArc`, so this pane and the chat
 * gutter's widget cannot group differently): every arc of it is one DECK holding the plans of that
 * arc in the ARC's own walk order — one strip inside the deck, with the arc's flow over it — and
 * the plans no arc holds are `PlanCard`s in their own urgency order, in the wall's grid below the
 * decks. Every hide passes the lane's own carried names, which is what the hide store
 * (`hiddenPlans.ts`) prunes its list against: `planHide` is a card's, `endedHide` the header's
 * `Hide ended · N`, and `HiddenPlans` at the foot is the way back.
 *
 * The EmptyState is reachable and is not dead code: the tab is STICKY, so a person standing here when
 * the last plan ends keeps the tab and meets this instead of the tab vanishing under them. It shows
 * only when nothing is DRAWN — no plan, no arc and no loose planner outing: an arc whose plans have all
 * been hidden draws no deck at all (`useDispatcherPlans` drops it). `HiddenPlans` rides under it,
 * because a lane whose every plan is hidden must still offer the way back.
 */
export function RunnerPanel() {
  const { t } = useTranslation();
  const { plans, hidden, arcs, loosePlanners, count, carriedNames } = useDispatcherPlans();
  const split = useMemo(() => byArc(plans, arcs), [plans, arcs]);
  useLaneFoldPrune(plans, hidden, arcs);
  const ended = endedHide(plans, carriedNames);
  // The pane's root: where `Hide ended · N` hands the keyboard on once the button has left with its count.
  const panelRef = useRef<HTMLDivElement>(null);

  // `Hide ended · N` takes itself away (nothing ended is left to hide), so a keyboard reader who
  // pressed it would land on `<body>`. On the next frame, once the hide has re-rendered the pane,
  // focus goes to the first Hide a reader can reach, else the `Hidden · N` trigger the press drew.
  const hideEnded = (hide: () => void) => {
    hide();
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel === null) return;
      const heir = [...panel.querySelectorAll<HTMLElement>('[data-dispatcher-hide]')]
        .find((element) => element.getClientRects().length > 0 && element.closest('[inert]') === null)
        ?? panel.querySelector<HTMLElement>('[data-hidden-plans] button');
      heir?.focus();
    });
  };

  return (
    <div ref={panelRef} className="flex h-full flex-col" data-runner-panel>
      {/* The header spans the pane, inset as the wall under it is, so the icon stands over the
          wall's left edge and `Hide ended · N` over its right. */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 lg:px-6">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <ActivityIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('runner.title')}</h2>
        {/* No badge at zero: the EmptyState below already says "nothing", and a "0" over it would
            say it a second time in a shape that reads like a count worth checking. */}
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
        {/* Every drawn plan that has finished, put away in ONE write. Not drawn when none has, so
            the button never offers to hide nothing. No dialog: `Show all` undoes it. `-my-1` lets
            the 36px button sit in the row's 28px line, so the header keeps one height whether or not
            it is drawn. */}
        {ended && (
          <Button variant="secondary" size="sm" className="-my-1 ml-auto" onClick={() => hideEnded(ended.hide)} data-hide-ended>
            {t('dispatcher.hideEnded', { count: ended.count })}
          </Button>
        )}
      </div>

      {/* A LOOSE PLANNER COUNTS AS A ROW of this pane: it is something out on the lane with no card
          of its own, and "nothing here" over a soul at work would be the pane's one lie. */}
      {count === 0 && arcs.length === 0 && loosePlanners.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
          {/* Over hidden plans the words are "every plan is hidden", never "nothing is running": a
              hidden plan may still be walking, and the list below says which. */}
          <EmptyState icon={ActivityIcon} title={t(hidden.length > 0 ? 'dispatcher.hidden.allHidden' : 'runner.empty')} />
          <div className="w-full max-w-md">
            <HiddenPlans hidden={hidden} carriedNames={carriedNames} />
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {/* THE PANE: the full width, one inset for everything in it, top to bottom — the outings no
              deck can carry (`LoosePlannerBadges`, nothing on an ordinary lane), the arc decks one
              under another (each paging its own plans in its own strip), the plans of no arc in the
              wall's grid, and the way back from a Hide. */}
          <div className="flex min-w-0 flex-col gap-6 px-4 py-5 lg:px-6">
            <LoosePlannerBadges planners={loosePlanners} />
            {/* THE ARCS SIT ABOVE THE PLANS NO ARC HOLDS, each deck holding the plans of its own arc:
                an arc's word and verbs reach every plan of it, so its plans are that arc's own strip
                rather than cards beside it (`DispatchArcDecks`). */}
            <DispatchArcDecks groups={split.groups} carriedNames={carriedNames} />
            {/* The plans of no arc, in the pane's own wall. They are the ONLY cards in this grid: an
                arc's plans are paged one per view inside their deck's strip, so a loose card is the
                width the wall gives every card that has no arc to be read under. */}
            {split.rest.length > 0 && (
              <ul className={cn('min-w-0', LANE_WALL_GRID)} data-runner-loose-plans>
                {split.rest.map((plan) => (
                  <li key={plan.name} className="min-w-0">
                    <PlanCard plan={plan} onHide={planHide(plan, carriedNames)} />
                  </li>
                ))}
              </ul>
            )}
            {/* The hidden list keeps a measure of its own: its rows put a name and its `Show` at
                either end of one line, and across a desktop-wide wall the two would be a screen apart.
                Drawn only when something is hidden, so an empty wrapper adds no gap at the foot. */}
            {hidden.length > 0 && (
              <div className="min-w-0 max-w-2xl">
                <HiddenPlans hidden={hidden} carriedNames={carriedNames} />
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
