import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { askIdentity } from '@/modules/dispatcher/askState';
import { DeletePlanDialog } from '@/modules/dispatcher/DeletePlanDialog';
import { cardDescription, phaseProgress, planDroppable } from '@/modules/dispatcher/dispatcherState';
import { putAwayVerb } from '@/modules/dispatcher/hiddenPlans';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useRiseOnce } from '@/modules/dispatcher/hooks/useFirstSight';
import { CardDescription, LaneCardHead } from '@/modules/dispatcher/LaneCardHead';
import { PlanAsk } from '@/modules/dispatcher/PlanAsk';
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
 * - THE HEAD (`LaneCardHead`): the Feature tag (`kind="feature"`, whether the card stands alone or
 *   sits in an epic's deck) leading the mono name, the word (`PlanStatusBadge`), the clock (`PlanClock`)
 *   and `done/total` phases on row one; the plan's description (`cardDescription`: its design's
 *   `delivers` line, else its goal's where that yields nothing) folded to one line until pressed, when
 *   it opens whole (`CardDescription`) — then who is out on the plan (`PlannerBadge`) and what of its
 *   arc it waits on, on row two; the plan's total as pills
 *   (`SpendPills`, counting at first sight) on row three; Dismiss or Hide, and the fold, in the corner.
 * - THE BAR (`PlanControls` → `ActionBar`): the verbs the plan's status allows and its model switch.
 * - THE FACE (`PlanFace`): the phases' track, what is moving now, and the closed lists. Its own rules —
 *   which disclosures start closed and why no home can open them — are stated there, not here.
 *
 * A FOLD KEEPS THE WHOLE HEAD AND TAKES THE REST (MAN-5412). The head is what says WHICH plan this is
 * and how it stands — name, word, clock, count, description, spend — and the corner is how the card
 * comes back or goes away, so a reader who folded ten cards still knows which ten they are. The
 * description stays as the reader left it — one line until pressed — so a fold takes the plan's verbs
 * and its detail and leaves the description alone. The bar and the face fold: a fold
 * that left verbs on screen would be a card that had not collapsed. The body is the house's
 * `CardFoldBody`, so a folded card's verbs leave the tab order too.
 *
 * AN OWED WORD FOLDS TO ITS BAR, AND NEVER AWAY (MAN-5412). The ask band is drawn OUTSIDE that body,
 * between the head and it, so folding a card that owes an answer leaves the one-line bar standing —
 * the prompt folds with the card and is never taken off the screen with the verbs. A fold is not an
 * answer, and the only thing that ends a band is the frame that stops carrying the ask.
 *
 * THE CORNER PUTS THE CARD AWAY, NOT THE PLAN, and the dispatcher is never told (`hiddenPlans.ts`). A
 * COMPLETE plan's corner is Dismiss: the card leaves the board, and no list or count keeps it. Any
 * other plan's is Hide: `Hidden · N` lists it and `Show` brings it back, because a plan still walking
 * must stay reachable. Neither deletes anything, so no dialog guards either. `onPutAway` is the
 * caller's `planPutAway(plan, carriedNames)`, because only the caller holds the lane's carried names
 * the store prunes against.
 *
 * DELETE IS THE MENU'S, AND ONLY WHERE THE DISPATCHER WOULD TAKE IT. `⋯` carries `Delete feature…`
 * exactly when `planDroppable(plan, planners)` holds. It is never drawn disabled on a `live` plan, a
 * walking phase or a planner out on the plan or its arc. Delete is the menu's only item, so those cards
 * draw no `⋯` at all. The planner half of that gate needs the lane's `planners` list, so the card reads
 * the lane (`useDispatcherPlans`) for it, as its controls (`PlanControls`) do for the box's swarm word:
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
 * live plan walking beside a probe must never be pressed. `data-card-description` marks the lead's
 * description line, the arc deck's too.
 *
 * Used by `RunnerPanel` and `RunnerWidgetBody` (runner-tab), for the plans no arc holds, and by
 * `DispatchArcDeck`, for each plan of an arc.
 */
export function PlanCard({
  plan,
  waitsOn = [],
  onPutAway,
  headingLevel = 3,
  showAsk = true,
}: {
  plan: DispatcherPlan;
  /** The plan names of this plan's own arc that it waits on, as the document spells them; `[]` for a plan of no arc. */
  waitsOn?: readonly string[];
  /** The corner's press, Dismiss or Hide by the plan's state: the caller's `planPutAway(plan, carriedNames)`. */
  onPutAway: () => void;
  /** The title's heading level: 4 inside an arc deck, whose own title is the 3 its plans sit under. */
  headingLevel?: 3 | 4;
  /**
   * Whether a prompt this plan owes is drawn on ITS OWN card. `true` wherever a card stands for
   * itself — the tab's wall, the widget's list — so a plan holding a prompt shows it where the plan
   * shows. `false` inside a dispatch arc's deck, whose caller draws the arc's prompts ONCE on the
   * deck (`DispatchArcDeck` → `DeckFrame`'s `asks`): one lock names every plan of the arc that owes
   * its Accept, and the same prompt on ten cards is ten presses of one door (MAN-5706).
   */
  showAsk?: boolean;
}) {
  const { t } = useTranslation();
  const description = cardDescription(plan.delivers, plan.goal);
  const { collapsed, toggle } = useCardFold(planFoldKey(plan.name));
  const rise = useRiseOnce(`plan:${plan.name}`);
  // Whether `Delete feature…` has been pressed and its question is up. Local, since it is this card's
  // question, and the dialog is mounted only while it is asked.
  const [deleting, setDeleting] = useState(false);
  const { planners } = useDispatcherPlans();
  const menuItems: ActionMenuItem[] = planDroppable(plan, planners)
    ? [{ key: 'delete', label: t('dispatcher.delete.menu'), icon: Trash2, isDanger: true, onSelect: () => setDeleting(true) }]
    : [];
  const verb = putAwayVerb([plan]);

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
            kind="feature"
            title={<span className="font-mono">{plan.name}</span>}
            badge={<PlanStatusBadge plan={plan} />}
            clock={<PlanClock plan={plan} />}
            progress={phaseProgress(plan)}
            lead={(
              <>
                {description && <CardDescription text={description} />}
                {/* WHO IS OUT ON THIS PLAN and what it waits on, under its description: the word says
                    what the PLAN is (`designing`), the badge who is doing something about it; the wait is
                    a fact about THIS plan ("before this, that"). Neither draws anything when absent. */}
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
                parts={spendParts(plan.cost_usd, plan.tokens_in, plan.tokens_out, plan.tokens, plan.tokens_cache_read)}
                countKey={`plan:${plan.name}`}
              />
            )}
            corner={{ menuLabel: t('dispatcher.menu'), menuItems, putAway: { verb, label: t(`dispatcher.${verb}`), onPress: onPutAway } }}
            headingLevel={headingLevel}
          />
        </CardHeader>

        {/* THE PROMPT THE PLAN OWES, between the head and the fold's body: OUTSIDE the body, so a fold
            takes the verbs and the detail and leaves this standing as its one-line bar (MAN-5412). It
            is keyed by the ask's identity, so an answered form lasts exactly as long as the ask the
            frame carries and a NEW ask — a re-cut, a fresh round — mounts a fresh one rather than
            inheriting an answer. Nothing at all on a plan that owes nothing, and nothing when the
            caller draws the arc's prompts on the deck (`showAsk`). */}
        {showAsk && plan.asking && (
          <div className="px-3 pb-3">
            <PlanAsk key={askIdentity(plan.asking)} ask={plan.asking} folded={collapsed} onUnfold={toggle} />
          </div>
        )}

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
