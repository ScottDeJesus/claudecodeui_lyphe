import { useRef } from 'react';

import { useServerFrame } from '@/shared/hooks/useServerFrame';

/** The server's frame after a queued message is appended, cleared, claimed, restored or deleted. */
const DRAFTS_FRAMES = ['drafts_changed'] as const;

/** The composer's reconcile of its queued-draft card: hydrate the drafts, then follow the server's copy. */
type ReconcileQueuedDraft = () => Promise<void>;

/**
 * The queued-draft card's ear on the server.
 *
 * The composer puts its reconcile into the returned holder while a card exists and clears it when
 * the card goes, so a frame heard with no card reads nothing. A reconnect is answered too
 * (`useServerFrame`): frames were missed while the socket was down.
 */
export function useDraftsChangedFrame(): { current: ReconcileQueuedDraft | null } {
  const reconcileRef = useRef<ReconcileQueuedDraft | null>(null);
  useServerFrame(DRAFTS_FRAMES, () => {
    const reconcile = reconcileRef.current;
    if (reconcile) void reconcile();
  });
  return reconcileRef;
}
