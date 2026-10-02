import { ActivityIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
  byArc,
  DispatchArcDecks,
  doneDismiss,
  HiddenPlans,
  landFocusInHome,
  LoosePlannerBadges,
  moveCard,
  PlanCard,
  PlannerLanesReadout,
  planPutAway,
  useCardRanks,
  useDispatcherPlans,
} from '@/modules/dispatcher';
import { DISPATCHER_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { LANE_WALL_GRID } from '@/shared/constants';
import { Badge, Button, EmptyState, ScrollArea } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';
import { cn } from '@/shared/utils';
import type { DispatcherLanePicture } from '@/shared/types';

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
 * THE COUNT IS OF THE CARDS DRAWN — plans paused, queued and ended included, the hidden and dismissed
 * ones not — and
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
 * the plans no arc holds are `PlanCard`s in the wall's grid below the decks.
 *
 * THE CARDS STAND WHERE THE OPERATOR PUT THEM AND NOWHERE ELSE. Decks and wall cards each keep the
 * shared order among their own kind (`byArc`'s `groups` and `rest`; the order is `cardOrder.ts`'s),
 * and each of the two lists is sortable: a free press on a card carries it, the grid lays itself out
 * around the gap, and a drop writes one rank (`moveCard`). The wall is two-dimensional, so a card
 * can be dropped into any slot of its rows; decks reorder among decks and plans among plans — a
 * deck and a plan swap places only in the widget, which draws them in one column. Every press passes the lane's own carried names, which is what the put-away store
 * (`hiddenPlans.ts`) prunes its list against: `planPutAway` is a card's corner (Dismiss on a done card,
 * Hide on an unfinished one), `doneDismiss` the header's `Dismiss done · N`, and `HiddenPlans` at the
 * foot is the way back from a Hide. A dismissed card has no way back and needs none: the dispatcher
 * still holds the plan, and the card returns by itself when the plan has news.
 *
 * The EmptyState is reachable and is not dead code: the tab is STICKY, so a person standing here when
 * the last plan ends keeps the tab and meets this instead of the tab vanishing under them. It shows
 * only when nothing is DRAWN — no plan, no arc and no loose planner outing: an arc whose plans have all
 * been put away draws no deck at all (`useDispatcherPlans` drops it). `HiddenPlans` rides under it,
 * because a lane whose every unfinished plan is hidden must still offer the way back.
 *
 * IT IS ALSO THE LANDING'S DESTINATION (`revealPlan` / `onRevealed`). A tap on a plan's prompt opens
 * the page on `?runner=<plan>` (`useRunnerLanding`), and that plan's card has to be somewhere a
 * person can see it, however far down the wall or the deck stack it sits. The pane does that and
 * NOTHING ELSE: it scrolls, it unfolds nothing, it un-hides nothing, and it retires the request the
 * moment the bus has SPOKEN — a board that has been dealt and holds nothing is an answer, and a
 * request left pending over it would move the pane long after the tap, with no `?runner=` in the URL
 * left to explain why.
 */
type RunnerPanelProps = {
  /** The plan a `?runner=` landing named, held by `useRunnerLanding` until this pane has tried to bring its card into view. `null` on every ordinary visit to the tab. */
  revealPlan?: string | null;
  /** Called once the reveal has run, whether or not a card was found, so the workspace retires the request. */
  onRevealed: () => void;
};

export function RunnerPanel({ revealPlan = null, onRevealed }: RunnerPanelProps) {
  const { t } = useTranslation();
  const { plans, hidden, arcs, loosePlanners, count, carriedNames } = useDispatcherPlans();
  // The topic's own value, for the one fact `useDispatcherPlans` folds away on purpose: `undefined` is
  // "nothing retained yet", which a board that has been dealt and drawn empty is NOT. Same topic, so
  // the two reads agree within one render. The reveal effect below is the only reader.
  const retained = useLiveTopic<DispatcherLanePicture>(DISPATCHER_ALL_TOPIC);
  const ranks = useCardRanks();
  const split = useMemo(() => byArc(plans, arcs, ranks), [plans, arcs, ranks]);
  // The two sortable lists: the decks, and the plans of no arc in the wall. A drop hands `moveCard`
  // the cards of ITS list for the neighbours' ranks, and the whole lane's names to prune against.
  const deckKeys = useMemo(() => split.groups.map((group) => group.arc.name), [split]);
  const wallKeys = useMemo(() => split.rest.map((plan) => plan.name), [split]);
  const sortDecks = useSortable({
    keys: deckKeys,
    onReorder: (carried, order) => moveCard(carried, order, split.groups.map((group) => group.arc), carriedNames),
  });
  const wallPlans = useMemo(() => new Map(split.rest.map((plan) => [plan.name, plan])), [split]);
  const { order: wallOrder, attachList: attachWall, itemProps: wallItemProps } = useSortable({
    keys: wallKeys,
    onReorder: (carried, order) => moveCard(carried, order, split.rest, carriedNames),
  });
  useLaneFoldPrune(plans, hidden, arcs);
  const done = doneDismiss(plans, carriedNames);
  // The pane's root: where `Dismiss done · N` hands the keyboard on once the button has left with its count.
  const panelRef = useRef<HTMLDivElement>(null);

  // `Dismiss done · N` takes itself away (nothing done is left to dismiss), so a keyboard reader who
  // pressed it would land on `<body>`. On the next frame, once the write has re-rendered the pane,
  // focus goes where `landFocusInHome` finds: the first corner press, else `Hidden · N`, else the pane.
  const dismissDone = (dismiss: () => void) => {
    dismiss();
    requestAnimationFrame(() => {
      if (panelRef.current !== null) landFocusInHome(panelRef.current);
    });
  };

  // THE LANDING'S OTHER HALF: bring the named plan's card into this pane's view. It waits until the
  // bus has SPOKEN — on a cold page nothing is retained when this pane mounts (the pane paints off
  // that same value), so a lookup run on the first frames would read a board the feed has not filled
  // yet and retire a request that had nothing to find. An empty lane is not that case: the
  // bus spoke, the board was dealt, and it holds no card, so the request is retired there rather than
  // left pending to move the pane whenever a plan next appears. A plan of an arc reveals its ARC'S
  // DECK rather than the card: an arc pages its plans one per view in its strip (`DeckStrip`), so the
  // deck is the thing that moves. `onRevealed` is called either way, so a plan the operator has put
  // away since the push — or a name the lane does not carry at all — retires the request instead of
  // re-scrolling on every frame.
  useEffect(() => {
    if (revealPlan === null) return;
    if (retained === undefined) return;
    const root = panelRef.current;
    if (root !== null) {
      // The arc comes off the lane's own drawn plan (`useDispatcherPlans`), never parsed out of a
      // selector: a name no drawn plan carries falls to the loose arm, finds nothing, and says so by
      // drawing nothing. `CSS.escape` because a plan name is a word from the store, and a wall is
      // not the place to find out what a `"` in it does.
      const arc = plans.find((plan) => plan.name === revealPlan)?.arc ?? null;
      const target = arc !== null
        ? `[data-dispatch-arc][data-arc-name="${CSS.escape(arc)}"]`
        : `[data-runner-loose-plans] [data-dispatcher-card][data-plan-name="${CSS.escape(revealPlan)}"]`;
      root.querySelector(target)?.scrollIntoView({ block: 'start' });
    }
    onRevealed();
  }, [revealPlan, retained, plans, onRevealed]);

  return (
    // `tabIndex={-1}`: the last place a press that emptied the board hands the keyboard (`landFocusInHome`).
    <div ref={panelRef} tabIndex={-1} className="flex h-full flex-col outline-none" data-runner-panel>
      {/* The header spans the pane, inset as the wall under it is, so the icon stands over the
          wall's left edge and `Dismiss done · N` over its right. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-3 lg:px-6">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <ActivityIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('runner.title')}</h2>
        {/* No badge at zero: the EmptyState below already says "nothing", and a "0" over it would
            say it a second time in a shape that reads like a count worth checking. */}
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
        {/* How full the planner lane is, beside the count of the cards it feeds. Not drawn when the
            frame states no dial (an older dispatcher). The header wraps so a phone-wide one drops the
            phrase to a second line whole rather than cutting it. */}
        <PlannerLanesReadout />
        {/* Every drawn plan that is done, off the board in ONE write, with nothing added to
            `Hidden`. Not drawn when none is, so the button never offers to dismiss nothing. No
            dialog: it deletes nothing, and the dispatcher keeps every plan. `-my-1` lets the 36px
            button sit in the row's 28px line, so the header keeps one height whether or not it is
            drawn. */}
        {done && (
          <Button variant="secondary" size="sm" className="-my-1 ml-auto" onClick={() => dismissDone(done.dismiss)} data-dismiss-done>
            {t('dispatcher.dismissDone', { count: done.count })}
          </Button>
        )}
      </div>

      {/* A LOOSE PLANNER COUNTS AS A ROW of this pane: it is something out on the lane with no card
          of its own, and "nothing here" over a soul at work would be the pane's one lie. */}
      {count === 0 && arcs.length === 0 && loosePlanners.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
          {/* Over hidden plans the words are "every unfinished plan is hidden", never "nothing is
              running": a hidden plan may still be walking, and the list below says which. */}
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
            <DispatchArcDecks groups={split.groups} carriedNames={carriedNames} sort={sortDecks} />
            {/* The plans of no arc, in the pane's own wall. They are the ONLY cards in this grid: an
                arc's plans are paged one per view inside their deck's strip, so a loose card is the
                width the wall gives every card that has no arc to be read under. */}
            {split.rest.length > 0 && (
              <ul ref={attachWall} className={cn('min-w-0', LANE_WALL_GRID)} data-runner-loose-plans>
                {wallOrder.flatMap((name) => wallPlans.get(name) ?? []).map((plan) => (
                  <li key={plan.name} className="min-w-0" {...wallItemProps(plan.name)}>
                    <PlanCard plan={plan} onPutAway={planPutAway(plan, carriedNames)} />
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
