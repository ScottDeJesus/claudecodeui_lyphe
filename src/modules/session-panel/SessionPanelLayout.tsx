import type { ReactNode } from 'react';

import '@/modules/session-panel/sessionPanel.css';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { SessionPanel } from '@/modules/session-panel/SessionPanel';

/**
 * THE CHAT AND ITS PANEL, SIDE BY SIDE. The chat is `children`, mounted in the same place at every width and in every form of the
 * panel, so nothing of it (a half-typed line, where the talk is scrolled to) is lost when a panel comes or goes.
 *
 * - No panel (the chat has neither a thing shown nor a follow-up): the chat has the whole pane, as before.
 * - A thing shown, at a desk: the panel has the room and the talk a column beside it (`sessionPanel.css` has the measures).
 * - Follow-ups alone, at a desk: a narrow column of them beside the chat.
 * - On a narrow screen: one of the two is in front, chosen by the switch in the chat's head (`SessionPanelSwitch`). The chat is
 *   hidden while the panel is in front, never unmounted.
 *
 * With no provider over it (the chat floating) it is the chat alone.
 *
 * Used by project-workspace's `WorkspaceMain`, round the chat's pane, gutters and all.
 */
export function SessionPanelLayout({ children }: { children: ReactNode }) {
  const panel = useSessionPanel();
  return (
    <div className="session-panel-layout" data-panel={panel?.form ?? 'none'} data-view={panel?.view ?? 'talk'}>
      <SessionPanel />
      <div className="session-panel-chat">{children}</div>
    </div>
  );
}
