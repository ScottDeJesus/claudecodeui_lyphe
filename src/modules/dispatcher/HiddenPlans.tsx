import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { showPlans } from '@/modules/dispatcher/hiddenPlans';
import { PlanStatusBadge } from '@/modules/dispatcher/PlanFace';
import type { DispatcherPlan } from '@/shared/types';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';

/**
 * The way back from a Hide: `Hidden · N`, a disclosure listing every plan the operator has hidden,
 * each as its name, its word and a `Show`, then `Show all`.
 *
 * CLOSED BY DEFAULT, and drawn only when something is hidden. The list is what the operator put away,
 * so it stays one quiet line until asked for. At zero it draws nothing at all, since a `Hidden · 0`
 * would be a line about nothing.
 *
 * THE STATUS WORD RIDES EVERY ROW because hiding is not only for finished plans: a plan hidden while
 * it walks is still walking, and the row is the one place on the screen that says so. `Show` and
 * `Show all` are each ONE write to the hide store (`showPlans`), pruned against the whole lane
 * (`carriedNames`), and a shown card returns to the grid on the render the write triggers.
 *
 * `data-hidden-plans` is the root's handle and `data-show-plan=<name>` each row's button, so a probe
 * presses one plan's Show without reading the rows' text.
 *
 * Used by the runner-tab module: at the foot of `RunnerPanel`'s scroll body and of `RunnerWidgetBody`'s
 * column, and under each one's EmptyState, because a lane whose every plan is hidden must still offer
 * the way back.
 */
export function HiddenPlans({ hidden, carriedNames }: { hidden: DispatcherPlan[]; carriedNames: string[] }) {
  const { t } = useTranslation();
  if (hidden.length === 0) return null;

  return (
    <Collapsible className="min-w-0" data-hidden-plans>
      <CollapsibleTrigger className="group flex items-center gap-1 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
        <ChevronDownIcon
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=closed]:-rotate-90"
        />
        {t('dispatcher.hidden.title', { count: hidden.length })}
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0">
        <ul className="flex min-w-0 flex-col gap-1 py-1">
          {hidden.map((plan) => (
            <li key={plan.name} className="flex min-w-0 flex-wrap items-center gap-2 px-2">
              <span className="min-w-0 flex-1 break-words font-mono text-xs">{plan.name}</span>
              <PlanStatusBadge plan={plan} />
              <Button variant="ghost" size="sm" data-show-plan={plan.name}
                onClick={() => showPlans([plan.name], carriedNames)}>
                {t('dispatcher.hidden.show')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="px-2 pb-1">
          <Button variant="secondary" size="sm" data-show-all
            onClick={() => showPlans(hidden.map((plan) => plan.name), carriedNames)}>
            {t('dispatcher.hidden.showAll')}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
