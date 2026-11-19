import { FollowupsContext, FollowupsWidgetBody } from '@/modules/followups';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';

/**
 * THE CHAT'S FOLLOW-UPS, BESIDE THE TALK: its next steps and known gaps in the app's own groups and words (the followups
 * module's body), each with its tick, from the reading their switch shares. Nothing while the chat has none, while the reader
 * has put them away by that switch (`SessionFollowupsSwitch`), and with no provider over it.
 *
 * Used by project-workspace's `ChatDesk`, in the chat's side column under its core; the provider is told the page keeps that
 * place (`followupsApart`).
 */
export function SessionFollowups({ className }: { className?: string }) {
  const panel = useSessionPanel();
  if (panel === null || !panel.followupsOpen || (panel.followups.items?.length ?? 0) === 0) return null;
  return (
    <div data-session-followups="" className={className}>
      <FollowupsContext.Provider value={panel.followups}>
        <FollowupsWidgetBody />
      </FollowupsContext.Provider>
    </div>
  );
}
