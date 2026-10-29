import { useEffect, useState } from 'react';

/**
 * Whether an action waiting for his word has lapsed: false until its `expiresAt`, true from that moment on.
 *
 * THE LAPSE IS A DEADLINE, NOT A CLOCK THAT CHECKS: one `window.setTimeout` to `expiresAt`, set when the card mounts and
 * cleared when it unmounts or its deadline changes (the panel keys the card by the action, so a new action is a new card).
 * The server closes the row itself at the next prepare, take or cancel; this only stops the page offering what it would
 * refuse. An action already past its time starts lapsed, so it is never drawn for a frame. A stamp that is not a time sets
 * no timer and never lapses here: the action is still his to fire or withdraw until the server says otherwise, and hiding
 * a live action is the worse mistake.
 *
 * Used by this module's CompanionActionCard, which draws nothing once it returns true.
 */
export function useActionLapse(expiresAt: string): boolean {
  // The `expiresAt` that has passed. The stamp, not a flag, so the answer stays true to the action on screen: a card
  // handed another deadline reads as live again until that one passes.
  const [lapsedAt, setLapsedAt] = useState<string | null>(() => (Date.parse(expiresAt) <= Date.now() ? expiresAt : null));

  useEffect(() => {
    const deadline = Date.parse(expiresAt);
    if (Number.isNaN(deadline)) return undefined;
    const timer = window.setTimeout(() => setLapsedAt(expiresAt), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return lapsedAt === expiresAt;
}
