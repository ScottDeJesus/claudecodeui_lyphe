import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { dismissPlans, putAwayVerb, releaseDismissed } from '@/modules/dispatcher/hiddenPlans';
import { useVerbSend } from '@/modules/dispatcher/hooks/useVerbSend';
import { api } from '@/shared/api';
import type { DispatcherPlan } from '@/shared/types';

/** The two presses of the dispatcher's own that putting a card away and bringing it back run. */
type PutAwayPress = 'hide' | 'unhide';

/** The presses a screen hands its cards: a plan's corner, an epic deck's corner, and Show for the `Hidden` list and a hidden card. */
type PutAway = {
  /** One card's corner press: Dismiss on a done plan, Hide (the dispatcher's) on an unfinished one. */
  plan(plan: DispatcherPlan): () => void;
  /** An epic deck's corner press over the deck's drawn `plans`, the epic named `arc`. */
  arc(arc: string, plans: readonly DispatcherPlan[]): () => void;
  /** Show for `plans`, all hidden at the dispatcher: they take their turn in the queue again. */
  show(plans: readonly DispatcherPlan[]): void;
};

/**
 * The corner's press, the deck's, and Show — the one place that decides which half of putting a card away
 * is the dispatcher's and which is the screen's, so no home can drift apart from another about it.
 *
 * - A DONE card is DISMISSED: an entry in the operator's own list (`dismissPlans`), because a finished plan
 *   holds nothing back and the dispatcher has nothing to do for it.
 * - An UNFINISHED card is HIDDEN, and a hide is the dispatcher's: `dispatcher hide` pauses the plan and holds
 *   it out of the queue until he Shows it (`POST /api/dispatcher/hide`, relayed like the other verbs). An epic
 *   deck's corner hides the EPIC (`hide <epic>`: every open plan of it, at one moment) — and, on a deck holding
 *   finished plans too, dismisses those, so the deck leaves; the dismissals are written once the dispatcher has
 *   answered, so a refusal leaves the deck as it was.
 * - SHOW is `dispatcher unhide`, named by the EPIC for a plan an epic's press hid (`plan.hidden.arc`) and by
 *   the plan otherwise, so the plans of one press come back as one; once the dispatcher has shown them, the
 *   dismissals of the same epic press are released (`releaseDismissed`) and a mixed deck returns whole.
 *
 * NOTHING IS OPTIMISTIC: the card leaves or returns on the next `dispatcher_state` frame, which is the store
 * read back. The dispatcher's own sentence is the toast, in the operator's words (`useVerbSend`). No dialog
 * guards any of them: neither deletes anything.
 *
 * `carriedNames` is the lane's UNFILTERED list of names (`useDispatcherPlans`), which every entry write prunes
 * the stored list against.
 *
 * Used by `PlanCard`'s callers (`RunnerPanel`, `RunnerWidgetBody`), `DispatchArcDeck`, `PlanControls` (a hidden
 * card's Show) and `HiddenPlans`.
 */
export function usePutAway(carriedNames: string[]): PutAway {
  const { t } = useTranslation();
  const { send } = useVerbSend<PutAwayPress>({
    keep: [],
    titles: {
      refused: (verb) => t(verb === 'hide' ? 'dispatcher.hideRefused' : 'dispatcher.hidden.showRefused'),
      done: (verb) => t(verb === 'hide' ? 'dispatcher.hide' : 'dispatcher.hidden.show'),
    },
  });

  const plan = useCallback(
    (target: DispatcherPlan) => () => {
      if (putAwayVerb([target]) === 'dismiss') {
        dismissPlans([target.name], carriedNames);
        return;
      }
      void send('hide', () => api.dispatcher.hide([target.name]));
    },
    [carriedNames, send],
  );

  const arc = useCallback(
    (name: string, plans: readonly DispatcherPlan[]) => () => {
      const finished = plans.filter((member) => member.status === 'complete').map((member) => member.name);
      if (putAwayVerb(plans) === 'dismiss') {
        dismissPlans(finished, carriedNames, name);
        return;
      }
      void send('hide', () => api.dispatcher.hide([name])).then((took) => {
        if (took) dismissPlans(finished, carriedNames, name);
      });
    },
    [carriedNames, send],
  );

  const show = useCallback(
    (plans: readonly DispatcherPlan[]) => {
      const targets = [...new Set(plans.map((member) => member.hidden?.arc ?? member.name))];
      const arcs = [...new Set(plans.flatMap((member) => (member.hidden?.arc ? [member.hidden.arc] : [])))];
      void send('unhide', () => api.dispatcher.unhide(targets)).then((took) => {
        if (took) releaseDismissed(plans.map((member) => member.name), arcs, carriedNames);
      });
    },
    [carriedNames, send],
  );

  return useMemo(() => ({ plan, arc, show }), [plan, arc, show]);
}
