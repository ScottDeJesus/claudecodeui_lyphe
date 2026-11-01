import { useTranslation } from 'react-i18next';

import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { PaceHoldLine } from '@/modules/dispatcher/PaceLine';
import { Button } from '@/shared/ui';

/**
 * THE PLAN CARD'S DOOR TO THE USAGE PACER'S HOLD: `Override` beside the clause that holds the plan, and
 * `Override on` with `Turn off` once the operator has pressed it (`dispatcher override`).
 *
 * THE OVERRIDE LIFTS THE PACER AND NOTHING ELSE — so it is offered against the pacer's clause alone. A
 * plan the QUEUE holds (an epic waiting its turn, Pause all) has no `pace_hold` while the queue speaks,
 * and a press would change nothing the card is waiting on; a plan with no hold and no override draws
 * neither line. The plan's model word, its epic's and the house switch are not this press's to touch.
 *
 * `overridden` is the dispatcher's own reading of the plan's log (`plan.overridden`), and wins over the
 * clause: a plan that carries the override is not held by the pacer, so the card says the state it is in.
 * Nothing is optimistic — the next frame redraws the line from the store.
 *
 * Handles: `data-plan-override` on the `Override on` line, `data-dispatcher-override` on the press and
 * `data-dispatcher-override-off` on Turn off.
 *
 * Used by `PlanCard` (this module), in the row where the queue's hold draws.
 */
export function PaceOverride({ name, hold, overridden }: { name: string; hold: string; overridden: boolean }) {
  const { t } = useTranslation();
  const { override, overrideOff, busy } = useDispatcherVerbs(name);
  const pending = busy !== null;

  if (overridden) {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span data-plan-override="" className="min-w-0 break-words text-xs text-foreground">
          {t('dispatcher.override.on')}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.override.offTitle')}
          onClick={() => void overrideOff()} data-dispatcher-override-off>
          {t('dispatcher.override.off')}
        </Button>
      </span>
    );
  }
  return (
    <PaceHoldLine hold={hold}>
      <Button type="button" variant="secondary" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.override.pressTitle')}
        onClick={() => void override()} data-dispatcher-override>
        {t('dispatcher.override.press')}
      </Button>
    </PaceHoldLine>
  );
}
