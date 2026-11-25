import { useCallback, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';

import { AppSwitcherDrawer, AppSwitcherLayer, useCurrentApplication } from '@/modules/app-switcher';
import { ChatHostFloating, useChatHost } from '@/modules/chat-host';
import { CompanionPanel } from '@/modules/companion';
import FloatingChatHeader from '@/modules/project-workspace/FloatingChatHeader';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import { useHomeShowing, useStationDoors, useStationShowing } from '@/shared/context/StationLayerContext';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import { HeldPage } from '@/shared/ui';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';
import { useChatDoor } from '@/modules/project-workspace/hooks/useChatDoor';
import { useChatHotkey } from '@/modules/project-workspace/hooks/useChatHotkey';

/**
 * Tells the chat's host whether the main region is covered, which is one thing from two causes: an application up over it, or the station on screen over
 * the whole frame. With either, the chat tab under it is out of sight, and a reply that lands there is the unread rule's to count. A LAYOUT effect, so
 * the host knows in the commit that draws the cover: a passive one runs after the paint, and a reply landing in that gap (measured at 0ms after the
 * drawer closed) would be judged against a chat still "in sight". A component of its own so the frame is not re-rendered by a switch of pages.
 */
function CoverReporter() {
  const { reportCovered } = useChatHost();
  const applicationUp = useCurrentApplication() !== null;
  const stationShowing = useStationShowing();
  const homeShowing = useHomeShowing();
  const covered = applicationUp || stationShowing || homeShowing;
  useLayoutEffect(() => {
    reportCovered(covered);
  }, [covered, reportCovered]);
  return null;
}

/** Holds the frame while the station or the sessions home is the page on screen. Its own component, for the same reason as `CoverReporter`: `children` is the element the frame already built, so a switch re-renders this wrapper and nothing under it. */
function HeldWorkspace({ children }: { children: ReactNode }) {
  const stationShowing = useStationShowing();
  const homeShowing = useHomeShowing();
  return <HeldPage held={stationShowing || homeShowing}>{children}</HeldPage>;
}

/**
 * Rendered by ProjectWorkspaceShell inside its providers (the chat's host, the application switcher and Kaylee's picture): the fixed container that lays out the sidebar, main region and global overlays, where the pieces that read those providers are wired together.
 *
 * ONE THING FLOATS OVER THE PAGE: THE CHAT. The applications' floating button and Kaylee's are gone from this app: the applications' acts are
 * the sessions home's menu's and the command palette's, the list of applications (`AppSwitcherDrawer`) is mounted here so it can
 * open with no application up, and Kaylee is at the station (her panel is still the rail's door's and the palette's). The floating
 * chat (`ChatHostFloating`: its panel, and the button that is the chat's own core) is mounted here beside the frame, not inside it.
 * The chat's door (`useChatDoor`) is built once here and pressed from two places: the hotkey, wherever the reader's keys land (this tab or
 * the chat's picture-in-picture window), and the command palette's Applications group. The Places menu's "last chat" floats it too.
 *
 * THE FRAME IS HELD WHILE THE STATION OR THE SESSIONS HOME IS THE PAGE ON SCREEN (`HeldWorkspace`): it stays mounted with everything it keeps, and nothing of it, her
 * panel included, is seen, focused or pressed. The chat's tab under it is out of sight, which `CoverReporter` tells the chat's host. THE FLOATING CHAT STANDS
 * OUTSIDE THAT HOLD: once floated it stays up over every page of the app, the station and the home included, until the reader sends it home. The hotkey of the
 * chat's door stands down while one of those pages is on screen and the chat is home (it opens the chat of a page that is on screen), and still sends home a chat
 * that floats there.
 */
export default function WorkspaceFrame({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const door = useChatDoor();
  const { pipWindow } = useChatHost();
  const doors = useStationDoors();
  const toggleChatWhileOnScreen = useCallback(() => {
    if (door.floating || (!doors.showing() && !doors.homeShowing())) door.toggle();
  }, [door, doors]);
  useChatHotkey(toggleChatWhileOnScreen, pipWindow);

  return (
    <>
      <HeldWorkspace>
        <CoverReporter />
        {/* `pwa-status-clear` is the frame's opt-in to the status-bar offset in a standalone PWA
            (see src/index.css): this shell and the drawer it holds are the only layers whose
            persistent chrome has to clear the iOS status bar. Overlays must NOT take it — they
            cover the whole screen and pad their own content. */}
        <div
          className="pwa-status-clear fixed inset-0 flex bg-background"
          style={{ bottom: 'var(--keyboard-height, 0px)' }}
        >
          <ProjectEffects navigate={navigate} />
          <ProjectSidebarRegion isMobile={isMobile} />

          <div className="relative flex min-w-0 flex-1 flex-col">
            <ProjectMainRegion
              isMobile={isMobile}
              ws={ws}
              sendMessage={sendMessage}
              navigate={navigate}
            />
            <AppSwitcherLayer />
          </div>

          <ProjectCommandPalette chatDoor={door} />
          <CompanionPanel />
          <AppSwitcherDrawer />
        </div>
      </HeldWorkspace>
      <ChatHostFloating header={<FloatingChatHeader />} />
    </>
  );
}
