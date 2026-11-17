import { FollowupsContext, FollowupsWidgetBody } from '@/modules/followups';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';

/**
 * THE CHAT'S FOLLOW-UPS, DRAWN APART FROM ITS PANEL: its next steps and known gaps in the app's own groups and words (the
 * followups module's body), each with its tick, from the same reading the panel and its switch share. Nothing while the chat
 * has none, and nothing with no provider over it.
 *
 * Used by project-workspace's `ChatDesk`, in the chat's side column under its core; the provider is told so
 * (`followupsApart`), and the panel then leaves them out.
 */
export function SessionFollowups({ className }: { className?: string }) {
  const panel = useSessionPanel();
  if (panel === null || (panel.followups.items?.length ?? 0) === 0) return null;
  return (
    <div data-session-followups="" className={className}>
      <FollowupsContext.Provider value={panel.followups}>
        <FollowupsWidgetBody />
      </FollowupsContext.Provider>
    </div>
  );
}
