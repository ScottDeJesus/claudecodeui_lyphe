import { memo } from 'react';
import type { ReactNode } from 'react';

import { AccountSwitcher, AccountsProvider } from '@/modules/accounts';
import { AppSwitcherProvider } from '@/modules/app-switcher';
import { ChatHostProvider } from '@/modules/chat-host';
import { useProjectChatState } from '@/modules/project-workspace/context/ProjectsStateContext';
import CompanionHost from '@/modules/project-workspace/CompanionHost';
import { PlacesProvider } from '@/modules/project-workspace/context/PlacesContext';
import { WorkspaceHomeLayer } from '@/modules/project-workspace/home/WorkspaceHomeLayer';
import { PageAnchorsProvider } from '@/shared/context/PageAnchorsContext';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import WorkspaceFrame from '@/modules/project-workspace/WorkspaceFrame';

/**
 * Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays, inside the providers they share (the page's anchors, the chat's host, the application switcher, the account panel's state, Kaylee's picture).
 * `stationLayer` is the app's other whole page, drawn beside the frame inside the same providers: it reads the one chat host and the one Kaylee the workspace holds.
 */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
  stationLayer,
}: ProjectWorkspaceShellProps & { stationLayer: ReactNode }) {
  // Read from the chat context, not the sidebar's: the choices keep one identity until a project is
  // added, renamed or removed, so this shell is not woken by every session upsert.
  const { projectChoices } = useProjectChatState();

  return (
    // The page's anchors, outermost: the sidebar's rows, the chat's composer, the file tree and the rail register in it,
    // and the companion's button below reads it, so it stands above every one of them.
    <PageAnchorsProvider>
      <ChatHostProvider>
        <AppSwitcherProvider projects={projectChoices}>
          {/* The account panel's one source, above the views rail's button and the chat's Accounts widget alike. */}
          <AccountsProvider>
            {/* Kaylee's one picture, above her door, her panel and the palette's row. She knows nothing of routes: the chat she opens is this module's to bring forward. */}
            <CompanionHost navigate={navigate}>
              {/* The navigation, one for every page: the wheel of places, the trail a held back arrow opens, the palette's places. */}
              <PlacesProvider>
                <WorkspaceFrame isMobile={isMobile} ws={ws} sendMessage={sendMessage} navigate={navigate} />
                {stationLayer}
                {/* The sessions home, the workspace's own second page: his chats by folder, drawn over the frame while the router stands at `/home`. */}
                <WorkspaceHomeLayer />
              </PlacesProvider>
            </CompanionHost>
            {/* The account switcher, one for the workspace: an account ring on any page, or the rail's account button, opens it. */}
            <AccountSwitcher />
          </AccountsProvider>
        </AppSwitcherProvider>
      </ChatHostProvider>
    </PageAnchorsProvider>
  );
}

export default memo(ProjectWorkspaceShell);
