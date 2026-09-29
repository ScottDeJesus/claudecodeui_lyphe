import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { planDroppable, planWaiters } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { spendText } from '@/shared/spend';
import { ConfirmDialog } from '@/shared/ui';
import type { DispatcherPlan } from '@/shared/types';

/**
 * Sends focus back to where it was when the dialog mounted, once the dialog is gone.
 *
 * The dialog is mounted only while it is open, so `DialogContent` never sees `open` turn false and
 * never restores focus itself. Without this, closing the dialog dropped focus to `<body>`. At mount,
 * focus is on the `⋯` trigger: `ActionMenu` hands focus back to its trigger in an effect that runs
 * earlier in the same commit, because the card's head comes before this dialog in the tree. A trigger
 * that has since left with its card is skipped.
 */
function useReturnFocus(): void {
  useEffect(() => {
    const origin = document.activeElement;
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, []);
}

/**
 * `Delete plan…`: `dispatcher drop` asked first, since no later press can undo it.
 *
 * It is open for as long as it is mounted, and the card mounts it only while the question is asked.
 * That also keeps the lane subscription (`useDispatcherPlans`) to the one open dialog, instead of one
 * subscription per card.
 *
 * THE MESSAGE SAYS WHAT LEAVES THE STORE (`store_drop.drop_plan`): the design (when the plan has
 * one), its phases, its events and its spend (`spendText`, left out when there is none). When the
 * plan belongs to an arc, the plan leaves that arc and the arc stays. It also names every plan whose
 * `waits_on` holds this one while that wait is still unmet (`planWaiters`): those are the plans the
 * drop may let start sooner. A met wait's edge goes too but releases nothing, so it is not named.
 * Hidden plans count as well, because the store keeps their edges whether or not a card is drawn. A
 * dismissed plan is in neither list and needs to be in none: it is complete, and `planWaiters` never
 * names a complete plan as a waiter.
 *
 * A DISMISSAL WAITS FOR THE ANSWER. Once Delete is pressed, the press is already at the dispatcher,
 * so Cancel is disabled and Escape and the backdrop do nothing until `drop()` answers (within the
 * relay's 20-second ceiling). The dialog then closes whatever the answer was. The verdict is the
 * hook's toast, in the dispatcher's own sentence: `DROPPED <name>`, or its REFUSED line.
 *
 * NOTHING OPTIMISTIC: the card leaves only when a `dispatcher_state` frame no longer carries the plan.
 *
 * `data-delete-plan`, `data-delete-arc` and `data-delete-waiters` are the browser harness's handles.
 *
 * Used by `PlanCard` (dispatcher module).
 */
export function DeletePlanDialog({ plan, onClose }: { plan: DispatcherPlan; onClose: () => void }) {
  const { t } = useTranslation();
  const { drop, busy } = useDispatcherVerbs(plan.name);
  const { plans, hidden, planners } = useDispatcherPlans();
  useReturnFocus();

  const dropping = busy === 'drop';
  const droppable = planDroppable(plan, planners);
  // A FRAME CAN END THE QUESTION: once the plan stops being droppable (its timer fired, or an arc's
  // Start came from the other home), the card has already taken its `⋯` away, and a Delete left open
  // here would be drawn where the dispatcher refuses. Never while the press is out: it is already at
  // the dispatcher, and its answer closes the dialog.
  useEffect(() => {
    if (!droppable && !dropping) onClose();
  }, [droppable, dropping, onClose]);
  const spend = spendText(t, plan.cost_usd, plan.tokens_in, plan.tokens_out, plan.tokens);
  // The sentence's grammar is the COPY's: one variant for each part a plan may lack (no design on a
  // plan that was only opened, no spend on one that never ran). Its joins never come from a
  // formatter, which conjoins in the READER's language: while a locale has not translated these
  // keys, a French reader got the English fallback joined with `et`.
  const shape = plan.goal !== null ? (spend ? 'designSpent' : 'design') : (spend ? 'spent' : undefined);
  const message = t('dispatcher.delete.message', {
    context: shape,
    phases: t('dispatcher.delete.phases', { count: (plan.phases ?? []).length }),
    events: t('dispatcher.delete.events', { count: (plan.events ?? []).length }),
    spend,
  });
  const waiters = planWaiters(plan, [...plans, ...hidden]);

  const dismiss = () => {
    if (!dropping) onClose();
  };
  const confirm = async () => {
    await drop();
    onClose();
  };

  return (
    <ConfirmDialog
      open
      title={t('dispatcher.delete.title', { name: plan.name })}
      message={(
        <div data-delete-plan={plan.name} className="flex flex-col gap-2">
          <p>{message}</p>
          {plan.arc !== null && <p data-delete-arc>{t('dispatcher.delete.arc', { arc: plan.arc })}</p>}
          {waiters.length > 0 && (
            <p data-delete-waiters>{t('dispatcher.delete.waiters', { count: waiters.length, names: waiters.join(', ') })}</p>
          )}
        </div>
      )}
      actions={[
        { label: t('dispatcher.delete.cancel'), variant: 'outline', onSelect: dismiss, disabled: dropping },
        { label: t('dispatcher.delete.confirm'), variant: 'destructive', onSelect: () => void confirm(), busy: dropping },
      ]}
      onDismiss={dismiss}
    />
  );
}
