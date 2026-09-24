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
 * Used by `RunnerPanel` (every card open) and `RunnerWidgetBody` (every card folded).
 */
export function PlanCard({
  plan,
  defaultOpen,
  onDismiss,
}: {
  plan: DispatcherPlan;
  defaultOpen: boolean;
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
        <PlanFace plan={plan} defaultOpen={defaultOpen} />
      </CardContent>

      <CardFooter className="p-3 pt-0">
        <PlanControls plan={plan} onDismiss={onDismiss} />
      </CardFooter>
    </Card>
  );
}
