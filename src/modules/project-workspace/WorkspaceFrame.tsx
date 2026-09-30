import { AppSwitcherFab, AppSwitcherLayer } from '@/modules/app-switcher';
import { ChatHostFloating, useChatHost } from '@/modules/chat-host';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';
import { useChatDoor } from '@/modules/project-workspace/hooks/useChatDoor';
import { useChatHotkey } from '@/modules/project-workspace/hooks/useChatHotkey';

/**
 * Rendered by ProjectWorkspaceShell inside its two providers (the chat's host and the application switcher): the fixed container that lays out the sidebar, main region and global overlays, where the pieces that read those providers are wired together.
 *
 * The floating chat is mounted here, inside the container, just before the FAB: above the application layer and
 * below the FAB, which stays the reader's way out. The FAB's drawn rect goes to the chat's host through
 * `reportAnchor`, so the panel stands beside it and follows it; the chat's door (`useChatDoor`) is pressed by the
 * hotkey wherever the reader's keys land.
 */
export default function WorkspaceFrame({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  const door = useChatDoor();
  useChatHotkey(door.toggle);
  const { reportAnchor } = useChatHost();

  return (
    <>
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
        <ChatHostFloating header={null} />
        <AppSwitcherFab onAnchorChange={reportAnchor} />
      </div>
    </>
  );
}
