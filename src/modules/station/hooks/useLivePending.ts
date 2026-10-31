import { useActionLapse } from '@/modules/companion';
import type { CompanionPendingAction } from '@/shared/companion-types';

/**
 * Her pending action as the count of what needs him holds it: `pending` while its card is drawn, `null` when none stands and `null`
 * once it has lapsed (the server leaves a lapsed row in her picture until its next prepare, take or cancel, while her card goes at the
 * deadline). The deadline is `useActionLapse`'s, the one her card draws by, so the count and the card lapse together.
 *
 * `useActionLapse` is a timer: it lapses a stamp one tick after it is handed it. The card is keyed by its action, so a lapsed one is
 * never drawn; these readers stand mounted across actions, so an action that arrives already past its deadline would be counted for
 * one painted frame (3, 4, 3). The stamp is therefore also read against the clock in the render that brings it. A stamp that is not
 * a time is never past, as in the hook: the action is still his to fire or withdraw until the server says otherwise.
 *
 * Used by `useNeedsCount` (compact's button and the phone's bar) and `WhatNeedsYouView` (the rail's head), which hand the answer to `needsCountOf`.
 */
export function useLivePending(pending: CompanionPendingAction | null): CompanionPendingAction | null {
  const lapsed = useActionLapse(pending?.expiresAt ?? null);
  const past = pending !== null && Date.parse(pending.expiresAt) <= Date.now();
  return lapsed || past ? null : pending;
}
