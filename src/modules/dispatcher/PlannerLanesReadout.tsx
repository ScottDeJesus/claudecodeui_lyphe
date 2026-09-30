import { useTranslation } from 'react-i18next';

import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { cn } from '@/shared/utils';

/**
 * `planners <out> of <lanes> out` — how full the planner lane is, in one small phrase: the
 * dispatcher's own count of planner outings out, against the width the operator set in Settings →
 * Agents → Planner lanes (`~/.claude/state/planners.flag`).
 *
 * DRAWN FROM THE FRAME AND NEVER FROM THE SETTINGS HOOK: `route.planners` is one document's two
 * figures read at the same instant (`planner_lanes.census`), so the phrase cannot say `3 of 2` off a
 * width read a poll apart from the count — and `out` above `lanes` IS a true reading, the moment after
 * the dial is lowered, since an outing already out is never stopped.
 *
 * NOT DRAWN when the frame carries no `planners`: a dispatcher build older than the field sends none,
 * and a phrase guessed from nothing would be the only lie on the lane. Drawn by the Runner tab's
 * header and the chat gutter's widget, both beside the plans it counts.
 *
 * `data-planner-lanes` (valued `<out>/<lanes>`) is the browser harness's handle.
 */
export function PlannerLanesReadout({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { route } = useDispatcherPlans();
  const planners = route?.planners;
  if (planners === undefined) return null;
  return (
    <span
      data-planner-lanes={`${planners.out}/${planners.lanes}`}
      className={cn('whitespace-nowrap text-xs tabular-nums text-muted-foreground', className)}
    >
      {t('dispatcher.plannersOut', { out: planners.out, lanes: planners.lanes })}
    </span>
  );
}
