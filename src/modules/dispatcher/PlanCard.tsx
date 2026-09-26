import { useTranslation } from 'react-i18next';

import { PlanControls } from '@/modules/dispatcher/PlanControls';
import { PlanClock, PlanFace, PlanStatusBadge } from '@/modules/dispatcher/PlanFace';
import { PlannerBadge } from '@/modules/dispatcher/PlannerBadge';
import { planFoldKey, useCardFold } from '@/shared/hooks/useCardFold';
import { Card, CardContent, CardFoldBody, CardFoldToggle, CardFooter, CardHeader, CardTitle, Collapsible } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';

/**
 * One plan the dispatcher is carrying, whole — the card composition this screen has always drawn,
 * over the dispatcher's document. Nothing here is invented: the frame, the title, the clamped
 * description, the word, the clock, the meter, the phase rows and the verbs are the run card's.
 * (`PlannerBadge` rides beside them, and it is not a second card: it says who is out on this plan,
 * which the card's own word cannot.)
 *
 * `plan.name` is the name (`restorly--kit`, what every dispatcher verb and toast prints); the goal's
 * FIRST line, clamped to three, is the description.
 *
 * IT FOLDS, and its fold key is the plan's own NAME rather than the ending
 * `{<name>, completed_at}` the dismissal list is keyed on: a fold is a way to get a card out of
 * sight for a while, and a plan cut and walked again is the same plan — the operator who folded it
 * should not have to fold it a second time. See `useCardFold`.
 *
 * `data-dispatcher-card`, `data-plan-name`, `data-plan-status` and `data-collapsed` are the browser
 * harness's handles, on the ROOT so a probe scopes every reading and every press to ONE plan — the
 * live plan walking beside a probe must never be pressed.
 *
 * NO `defaultOpen`: a plan card's phases are shown wherever it is drawn. The gutter and the tab are
 * two homes for one card, and a prop one of them could pass `false` is a prop that lets them disagree
 * about what the card shows — and they did: measured on the bundle this change landed on top of, the
 * tab painted 9/9 and 14/14 phase rows while the gutter painted 0/9 and 0/14 with the list `closed`.
 * `PlanFace` therefore states the open list itself, so the disagreement is unreachable rather than
 * merely unwatched.
 *
 * `waitsOn` IS THE ARC'S ANSWER, NOT THE CARD'S: the plan names of its own arc this plan waits on
 * (`waitsOnSiblings`), drawn beside its title row where every other mark of the plan sits, and
 * empty for a plan of no arc. It is passed IN rather than read here — a card that reached for the
 * lane itself would be one bus subscription per card, and it cannot know which plans are its arc's
 * without the group it was handed. Both homes pass the same list through the same component
 * (`DispatchArcDeck`), so the two cannot disagree about it either.
 *
 * Used by `RunnerPanel`, above the plans no arc holds, and by `RunnerWidgetBody` in the chat gutter.
 */
export function PlanCard({
  plan,
  waitsOn = [],
  onDismiss,
}: {
  plan: DispatcherPlan;
  /** The plan names of this plan's own arc that it waits on, as the document spells them; `[]` for a plan of no arc. */
  waitsOn?: readonly string[];
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const goal = (plan.goal ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  const { collapsed, toggle } = useCardFold(planFoldKey(plan.name));

  return (
    <Card
      className="w-full min-w-0"
      data-dispatcher-card
      data-plan-name={plan.name}
      data-plan-status={plan.status}
      data-collapsed={String(collapsed)}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle}>
        <CardHeader className="gap-2 p-3 pb-2">
          {/* The word and the clock ride the title's own row and the fold rides the row's end, so a
              folded card keeps every mark that says WHICH plan this is. */}
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <CardTitle className="w-full min-w-0 break-words font-mono text-sm leading-snug">{plan.name}</CardTitle>
              {goal && (
                <p className="line-clamp-3 w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">{goal}</p>
              )}
              <PlanStatusBadge plan={plan} />
              <PlanClock plan={plan} />
              {/* WHO IS OUT ON THIS PLAN, beside its own word and its own clock: the status word says
                  what the PLAN is (`designing`), and this says who is doing something about it, on
                  what model, for how long. It draws nothing at all on a plan no planner is on. */}
              {plan.planner && <PlannerBadge planner={plan.planner} />}
              {/* What this plan waits on, of its own arc — beside its name and on the marks' own row,
                  because it is a fact about THIS plan and reads as one ("before this, that"). */}
              {waitsOn.length > 0 && (
                <span data-plan-waits-on className="min-w-0 break-words font-mono text-xs text-muted-foreground">
                  {t('dispatcher.waitsOn', { names: waitsOn.join(', ') })}
                </span>
              )}
            </div>
            <CardFoldToggle />
          </div>
        </CardHeader>

        <CardFoldBody>
          <CardContent className="p-3 pt-0">
            <PlanFace plan={plan} />
          </CardContent>

          <CardFooter className="p-3 pt-0">
            <PlanControls plan={plan} onDismiss={onDismiss} />
          </CardFooter>
        </CardFoldBody>
      </Collapsible>
    </Card>
  );
}
