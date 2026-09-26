import { ActivityIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { byArc, DispatchArcDecks, LoosePlannerBadges, planDismissal, PlanCard, useDispatcherPlans } from '@/modules/dispatcher';
import { useLaneFoldPrune } from '@/modules/runner-tab/hooks/useLaneFoldPrune';
import { Badge, EmptyState, ScrollArea } from '@/shared/ui';

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
 * `useLaneFoldPrune` hands the fold store the cards this lane still carries — the same hook the
 * gutter widget calls, so the two homes cannot disagree about which folds are worth keeping.
 *
 * THE COUNT INCLUDES PLANS PAUSED, QUEUED AND ENDED-NOT-YET-DISMISSED, and it agrees with the tab's
 * badge because both read the same `count` off the same hook — the badge from `useWorkspaceTabGates`,
 * this header from here, one value with two readers. A badge of 3 over a panel of 2 cards would make
 * a liar of one of them.
 *
 * `data-runner-panel` is the browser harness's handle, on the ROOT: a probe scopes every reading to
 * THIS pane, so a card the operator's own lane puts on screen at the same moment is never mistaken
 * for the one under test.
 *
 * THE PLANS ARE NESTED BY ARC. The lane is split by ONE rule (`byArc`, so this pane and the chat
 * gutter's widget cannot group differently): every arc of it is one DECK holding the plans of that
 * arc in the ARC's own walk order, and the plans no arc holds stay exactly as they were — `PlanCard`s
 * in their own urgency order, below those decks. The header's count and the EmptyState read the plans
 * and the loose outings. A dismissal passes the lane's own carried names, which is what `dismissEnding`
 * prunes the stored list against, and `planDismissal` is the one rule for what a plan's Dismiss does.
 *
 * The EmptyState is reachable and is not dead code: the tab is STICKY, so a person standing here when
 * the last plan ends keeps the tab and meets this instead of the tab vanishing under them. It shows
 * only when there is nothing at all — no plan, no arc and no loose planner outing: an arc whose plans
 * have all been dismissed draws no deck at all (`useDispatcherPlans` drops it), and a plan of no arc
 * is a card in the list below.
 */
export function RunnerPanel() {
  const { t } = useTranslation();
  const { plans, arcs, loosePlanners, count, carriedNames } = useDispatcherPlans();
  const split = useMemo(() => byArc(plans, arcs), [plans, arcs]);
  useLaneFoldPrune(plans, arcs);

  return (
    <div className="flex h-full flex-col" data-runner-panel>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <ActivityIcon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">{t('runner.title')}</h2>
        {/* No badge at zero: the EmptyState below already says "nothing", and a "0" over it would
            say it a second time in a shape that reads like a count worth checking. */}
        {count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>

      {/* A LOOSE PLANNER COUNTS AS A ROW of this pane: it is something out on the lane with no card
          of its own, and "nothing here" over a soul at work would be the pane's one lie. */}
      {count === 0 && arcs.length === 0 && loosePlanners.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState icon={ActivityIcon} title={t('runner.empty')} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          {/* The outings no deck can carry — an arc's design, before the arc's own file has loaded —
              stand above the decks rather than nowhere (`LoosePlannerBadges`). It draws nothing when
              there are none, which is every ordinary lane. */}
          <LoosePlannerBadges planners={loosePlanners} />
          {/* THE ARCS SIT ABOVE THE PLANS NO ARC HOLDS, in the same centred column, each deck holding
              the plans of its own arc: an arc's word and verbs reach every plan of it, so the plans of
              it are that arc's strip rather than a list beside it (`DispatchArcDecks`). */}
          <DispatchArcDecks groups={split.groups} carriedNames={carriedNames} />
          {/* A measured column, centred, the way the memory queue's is: these are short cards, and
              letting one run the full width of a desktop workspace strands a line of text in a field
              of empty surface. What lets a title wrap at 390px is `w-full break-words` on the card's
              own heading (`PlanCard`), not anything here. */}
          <ul className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-3 px-4 py-5">
            {split.rest.map((plan) => (
              <li key={plan.name} className="min-w-0">
                <PlanCard plan={plan} onDismiss={planDismissal(plan, carriedNames)} />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
