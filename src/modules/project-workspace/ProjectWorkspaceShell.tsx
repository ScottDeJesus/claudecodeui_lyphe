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

        <ProjectCommandPalette />
        <AppSwitcherFab />
      </div>
    </AppSwitcherProvider>
  );
}

export default memo(ProjectWorkspaceShell);
