import { useTranslation } from 'react-i18next';

import { useDispatcherVerbs, type DispatcherVerbScope } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { PaceHoldLine } from '@/modules/dispatcher/PaceLine';
import { Button } from '@/shared/ui';

/**
 * THE CARD'S DOOR TO THE USAGE PACER'S HOLD: `Override` beside the clause that holds it, and `Override on`
 * with `Turn off` once the operator has pressed it (`dispatcher override`). A PLAN CARD draws it for the plan's
 * own asks — any ready phase, or a planner outing aimed at the plan — and an ARC DECK for the epic's own
 * outings: its design before any plan of it exists, its whole-arc cut, a tell, its judgment (`scope="arc"`,
 * `arc.pace_hold`). Every hold the pacer places is on ONE card, and the press on that card lifts exactly it:
 * the plan's lifts the plan's, the epic's lifts the epic's and none of its plans' phases.
 *
 * THE OVERRIDE LIFTS THE PACER AND NOTHING ELSE — so it is offered against the pacer's clause alone. A
 * plan the QUEUE holds (an epic waiting its turn, Pause all) draws no Override for that hold — its queue line stands
 * alone, and a press would change nothing the card is waiting on — and draws one only for a pace clause of its own (a
 * planner outing aimed at it); a card with no hold and no override draws neither line. The plan's model word, its epic's and the house switch are not this press's to touch.
 *
 * `overridden` is the dispatcher's own reading of the log (`plan.overridden`, `arc.overridden`), and wins over the
 * clause: a subject that carries the override is not held by the pacer, so the card says the state it is in.
 * Nothing is optimistic — the next frame redraws the line from the store.
 *
 * Handles: `data-plan-override` on the `Override on` line, `data-dispatcher-override` on the press and
 * `data-dispatcher-override-off` on Turn off, each with `data-override-scope` (`plan` or `arc`) — an arc deck
 * holds its plans' cards, so a probe tells the deck's own press from theirs by it.
 *
 * Used by `PlanCard` (this module), in the row where the queue's hold draws, and by `DispatchArcDeck`, in the
 * deck head under the planner badge.
 */
export function PaceOverride({
  name,
  hold,
  overridden,
  scope = 'plan',
}: {
  name: string;
  hold: string;
  overridden: boolean;
  /** Whose hold this is: a plan's own asks, or the epic's own outings. Picks the door the press goes through. */
  scope?: DispatcherVerbScope;
}) {
  const { t } = useTranslation();
  const { override, overrideOff, busy } = useDispatcherVerbs(name, scope);
  const pending = busy !== null;

  if (overridden) {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span data-plan-override="" data-override-scope={scope} className="min-w-0 break-words text-xs text-foreground">
          {t('dispatcher.override.on')}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.override.offTitle')}
          onClick={() => void overrideOff()} data-dispatcher-override-off data-override-scope={scope}>
          {t('dispatcher.override.off')}
        </Button>
      </span>
    );
  }
  return (
    <PaceHoldLine hold={hold}>
      <Button type="button" variant="secondary" size="sm" className="h-8 finger:h-11" disabled={pending} title={t('dispatcher.override.pressTitle')}
        onClick={() => void override()} data-dispatcher-override data-override-scope={scope}>
        {t('dispatcher.override.press')}
      </Button>
    </PaceHoldLine>
  );
}
