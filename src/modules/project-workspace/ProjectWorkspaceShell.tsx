import { memo } from 'react';

import { AppSwitcherProvider } from '@/modules/app-switcher';
import { ChatHostProvider } from '@/modules/chat-host';
import { useProjectChatState } from '@/modules/project-workspace/context/ProjectsStateContext';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import WorkspaceFrame from '@/modules/project-workspace/WorkspaceFrame';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  // Read from the chat context, not the sidebar's: the choices keep one identity until a project is
  // added, renamed or removed, so this shell is not woken by every session upsert.
  const { projectChoices } = useProjectChatState();

  return (
    <ChatHostProvider>
      <AppSwitcherProvider projects={projectChoices}>
        <WorkspaceFrame isMobile={isMobile} ws={ws} sendMessage={sendMessage} navigate={navigate} />
      </AppSwitcherProvider>
    </ChatHostProvider>
  );
}

export default memo(ProjectWorkspaceShell);
