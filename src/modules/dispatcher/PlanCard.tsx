import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeletePlanDialog } from '@/modules/dispatcher/DeletePlanDialog';
import { phaseProgress, planDroppable } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useRiseOnce } from '@/modules/dispatcher/hooks/useFirstSight';
import { LaneCardHead } from '@/modules/dispatcher/LaneCardHead';
import { PlanControls } from '@/modules/dispatcher/PlanControls';
import { PlanClock, PlanFace, PlanStatusBadge } from '@/modules/dispatcher/PlanFace';
import { PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
import { SpendPills } from '@/modules/dispatcher/SpendPills';
import { planFoldKey, useCardFold } from '@/shared/hooks/useCardFold';
import { spendParts } from '@/shared/spend';
import { Card, CardContent, CardFoldBody, CardHeader, Collapsible } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * One plan the dispatcher is carrying, in the lane card's ONE anatomy — the arc deck's too: a head
 * that says which plan this is and how it stands, the action bar directly under it, and the face.
 *
 * - THE HEAD (`LaneCardHead`): the mono name, the word (`PlanStatusBadge`), the clock (`PlanClock`)
 *   and `done/total` phases on row one; the goal's FIRST line clamped to two, then who is out on the
 *   plan (`PlannerBadge`) and what of its arc it waits on, on row two; the plan's total as pills
 *   (`SpendPills`, counting at first sight) on row three; Hide and the fold in the corner.
 * - THE BAR (`PlanControls` → `ActionBar`): the verbs the plan's status allows and its model switch.
 * - THE FACE (`PlanFace`): the phases' track, what is moving now, and the closed lists. Its own rules —
 *   which disclosures start closed and why no home can open them — are stated there, not here.
 *
 * A FOLD KEEPS THE WHOLE HEAD AND TAKES THE REST (MAN-5412). The head is what says WHICH plan this is
 * and how it stands — name, word, clock, count, goal, spend — and the corner is how the card comes
 * back or goes away, so a reader who folded ten cards still reads all ten at a glance. The bar and
 * the face fold: they are the plan's verbs and its detail, and a fold that left verbs on screen would
 * be a card that had not collapsed. The body is the house's `CardFoldBody`, so a folded card's verbs
 * leave the tab order too.
 *
 * HIDE PUTS THE CARD AWAY, NOT THE PLAN. Hide sits in the head's corner on every card, whatever its
 * status: the dispatcher is never told, `Hidden · N` lists it and `Show` brings it back
 * (`hiddenPlans.ts`). It is reversible, so no dialog guards it. `onHide` is the caller's
 * `planHide(plan, carriedNames)`, because only the caller holds the lane's carried names the store
 * prunes against.
 *
 * DELETE IS THE MENU'S, AND ONLY WHERE THE DISPATCHER WOULD TAKE IT. `⋯` carries `Delete plan…`
 * exactly when `planDroppable(plan, planners)` holds. It is never drawn disabled on a `live` plan, a
 * walking phase or a planner out on the plan or its arc. Delete is the menu's only item, so those cards
 * draw no `⋯` at all. The planner half of that gate needs the lane's `planners` list, so the card reads
 * the lane (`useDispatcherPlans`) for it, as its face (`PlanFace`) does for the box's route:
 * `plan.planner` gives a plan's own ended row ahead of its arc's live one, so it cannot answer what
 * `drop` asks. The press opens `DeletePlanDialog`, the
 * module's one modal, because `dispatcher drop` is the one verb no press undoes. The card does not
 * leave on the press: it leaves when a frame no longer carries the plan.
 *
 * IT RISES ONCE: `motion-safe:animate-shape-rise` on the first mount this page session draws
 * `plan:<name>`, claimed by the copy whose rise actually PLAYS and gone from the root when it ends
 * (`useRiseOnce`) — never again on a remount, a poll, the Chat tab shown again over a gutter it had
 * hidden, or the other home's copy of a card that arrived while both were mounted.
 *
 * IT FOLDS, and its fold key is the plan's own NAME (`useCardFold`): a plan cut and walked again is
 * the same plan, and the operator who folded it should not have to fold it a second time.
 *
 * `waitsOn` IS THE ARC'S ANSWER, NOT THE CARD'S: the plan names of its own arc this plan waits on
 * (`waitsOnSiblings`), empty for a plan of no arc. It is passed IN rather than read here: the card
 * cannot know which plans are its arc's without the group it was handed.
 *
 * `data-dispatcher-card`, `data-plan-name`, `data-plan-status` and `data-collapsed` are the browser
 * harness's handles, on the ROOT so a probe scopes every reading and every press to ONE plan — the
 * live plan walking beside a probe must never be pressed.
 *
 * Used by `RunnerPanel` and `WidgetPager` (runner-tab), for the plans no arc holds, and by
 * `DispatchArcDeck`, for each plan of an arc.
 */
export function PlanCard({
  plan,
  waitsOn = [],
  onHide,
  headingLevel = 3,
}: {
  plan: DispatcherPlan;
  /** The plan names of this plan's own arc that it waits on, as the document spells them; `[]` for a plan of no arc. */
  waitsOn?: readonly string[];
  /** Puts this card in the `Hidden` list: the caller's `planHide(plan, carriedNames)`. */
  onHide: () => void;
  /** The title's heading level: 4 inside an arc deck, whose own title is the 3 its plans sit under. */
  headingLevel?: 3 | 4;
}) {
  const { t } = useTranslation();
  const goal = (plan.goal ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const { collapsed, toggle } = useCardFold(planFoldKey(plan.name));
  const rise = useRiseOnce(`plan:${plan.name}`);
  // Whether `Delete plan…` has been pressed and its question is up. Local, since it is this card's
  // question, and the dialog is mounted only while it is asked.
  const [deleting, setDeleting] = useState(false);
  const { planners } = useDispatcherPlans();
  const menuItems: ActionMenuItem[] = planDroppable(plan, planners)
    ? [{ key: 'delete', label: t('dispatcher.delete.menu'), icon: Trash2, isDanger: true, onSelect: () => setDeleting(true) }]
    : [];

  return (
    <Card
      className={cn('w-full min-w-0', rise.className)}
      onAnimationStart={rise.onAnimationStart}
      onAnimationEnd={rise.onAnimationEnd}
      data-dispatcher-card
      data-plan-name={plan.name}
      data-plan-status={plan.status}
      data-collapsed={String(collapsed)}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle}>
        <CardHeader className="p-3">
          <LaneCardHead
            title={<span className="font-mono">{plan.name}</span>}
            badge={<PlanStatusBadge plan={plan} />}
            clock={<PlanClock plan={plan} />}
            progress={phaseProgress(plan)}
            lead={(
              <>
                {goal && (
                  <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{goal}</p>
                )}
                {/* WHO IS OUT ON THIS PLAN and what it waits on, under its goal: the word says what the
                    PLAN is (`designing`), the badge who is doing something about it; the wait is a fact
                    about THIS plan ("before this, that"). Neither draws anything when absent. */}
                {(plan.planner || waitsOn.length > 0) && (
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {plan.planner && <PlannerBadge planner={plan.planner} />}
                    {waitsOn.length > 0 && (
                      <span data-plan-waits-on className="min-w-0 break-words font-mono text-xs text-muted-foreground">
                        {t('dispatcher.waitsOn', { names: waitsOn.join(', ') })}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
            spend={(
              <SpendPills
                parts={spendParts(plan.cost_usd, plan.tokens_in, plan.tokens_out, plan.tokens)}
                countKey={`plan:${plan.name}`}
              />
            )}
            corner={{ menuLabel: t('dispatcher.menu'), menuItems, onHide, hideLabel: t('dispatcher.hide') }}
            headingLevel={headingLevel}
          />
        </CardHeader>

        <CardFoldBody>
          <CardContent className="flex min-w-0 flex-col gap-3 p-3 pt-0">
            <PlanControls plan={plan} />
            <PlanFace plan={plan} />
          </CardContent>
        </CardFoldBody>
      </Collapsible>
      {/* AFTER THE HEAD, ON PURPOSE: the dialog's effects run after `ActionMenu` has handed focus back
          to `⋯`, which is where `DeletePlanDialog` returns focus when it closes. It portals, so its
          place in the DOM does not matter. */}
      {deleting && <DeletePlanDialog plan={plan} onClose={() => setDeleting(false)} />}
    </Card>
  );
}
