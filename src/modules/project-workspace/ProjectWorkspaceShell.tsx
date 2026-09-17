import { memo } from 'react';

import { AppSwitcherFab, AppSwitcherLayer, AppSwitcherProvider } from '@/modules/app-switcher';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  return (
    <AppSwitcherProvider>
      <div
        className="fixed inset-0 flex bg-background"
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

        <ProjectCommandPalette />
        <AppSwitcherFab />
      </div>
    </AppSwitcherProvider>
  );
}

export default memo(ProjectWorkspaceShell);
