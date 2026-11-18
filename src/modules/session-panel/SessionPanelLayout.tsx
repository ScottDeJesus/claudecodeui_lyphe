import type { ReactNode } from 'react';

import '@/modules/session-panel/sessionPanel.css';
import { useSessionPanel } from '@/modules/session-panel/context/sessionPanelContext';
import { SessionPanel } from '@/modules/session-panel/SessionPanel';

/**
 * THE CHAT AND ITS PANEL, ONE IN FRONT. The chat is `children`, mounted in the same place at every width and in every form of the
 * panel, so nothing of it (a half-typed line, where the talk is scrolled to) is lost when a panel comes or goes.
 *
 * - No panel (the chat has nothing shown, and no follow-up the panel is to draw): the chat has the whole pane.
 * - A panel: the talk is in front until the reader switches, by the switch in the chat's head (`SessionPanelSwitch`) or a mark
 *   in the talk (`SessionPanelMark`); the panel then stands in the chat's place. The chat is hidden meanwhile, never unmounted.
 *
 * With no provider over it (the chat floating) it is the chat alone.
 *
 * Used by project-workspace's `WorkspaceMain`, round the chat's pane.
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
