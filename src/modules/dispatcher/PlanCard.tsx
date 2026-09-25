import { useTranslation } from 'react-i18next';

import { PlanControls } from '@/modules/dispatcher/PlanControls';
import { PlanClock, PlanFace, PlanStatusBadge } from '@/modules/dispatcher/PlanFace';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, Chip } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';

/**
 * One v3 plan the dispatcher is carrying, whole — `RunCard`'s own composition over the
 * dispatcher's document (operator, 2026-09-24: "it can be identical to our existing cards, it'll
 * just have a dispatch v1 pill label on it"). Nothing here is invented: the frame, the title, the
 * clamped description, the word, the clock, the meter, the phase rows and the verbs are the run
 * card's, and the PILL is the one thing that tells the two engines' cards apart in the same list.
 *
 * `plan.v3` is the name (`<name>.v3`, what every dispatcher verb and toast prints); the goal's
 * FIRST line, clamped to three, is the description. The pill is a static span (`Chip` with no
 * press), wrapped so its handle rides a node the house pill does not have to forward.
 *
 * `data-dispatcher-card`, `data-plan-name` and `data-plan-status` are the browser harness's
 * handles, on the ROOT so a probe scopes every reading and every press to ONE plan — the live
 * plan walking beside a probe must never be pressed.
 *
 * NO `defaultOpen`, UNLIKE `RunCard`: a plan card's phases are shown wherever it is drawn. The
 * gutter and the tab are two homes for one card, and a prop one of them could pass `false` is a prop
 * that lets them disagree about what the card shows — and they did: measured on the bundle this
 * change landed on top of, the tab painted 9/9 and 14/14 phase rows while the gutter painted 0/9 and
 * 0/14 with the list `closed`. `PlanFace` therefore states the open list itself, so the disagreement
 * is unreachable rather than merely unwatched.
 *
 * Used by `RunnerPanel`, above the runs of the tab, and by `RunnerWidgetBody` in the chat gutter.
 */
export function PlanCard({
  plan,
  onDismiss,
}: {
  plan: DispatcherPlan;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const goal = (plan.goal ?? '').split('\n').map((line) => line.trim()).find(Boolean) ?? '';

  return (
    <Card className="w-full min-w-0" data-dispatcher-card data-plan-name={plan.name} data-plan-status={plan.status}>
      <CardHeader className="gap-2 p-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="w-full min-w-0 break-words font-mono text-sm leading-snug">{plan.v3}</CardTitle>
          {goal && (
            <p className="line-clamp-3 w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">{goal}</p>
          )}
          <span className="inline-flex flex-none" data-dispatcher-pill>
            <Chip size="sm">{t('dispatcher.pill')}</Chip>
          </span>
          <PlanStatusBadge plan={plan} />
          <PlanClock plan={plan} />
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0">
        <PlanFace plan={plan} />
      </CardContent>

      <CardFooter className="p-3 pt-0">
        <PlanControls plan={plan} onDismiss={onDismiss} />
      </CardFooter>
    </Card>
  );
}
