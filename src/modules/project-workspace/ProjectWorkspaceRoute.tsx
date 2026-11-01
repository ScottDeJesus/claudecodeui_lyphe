import { memo } from 'react';
import type { ReactNode } from 'react';
import { matchPath, parsePath } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';

import { PaletteOpsProvider } from '@/modules/command-palette';
import { ProjectsStateProvider } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useHeldWorkspace } from '@/modules/project-workspace/hooks/useHeldWorkspace';
import {
  SessionProtectionProvider,
  useSessionProtectionActions,
} from '@/shared/context/SessionProtectionContext';
import { StationLayerProvider } from '@/shared/context/StationLayerContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useVisualViewportKeyboardOffset } from '@/shared/hooks/useVisualViewportKeyboardOffset';
import ProjectWorkspaceShell from '@/modules/project-workspace/ProjectWorkspaceShell';

type ProjectWorkspaceRouteContentProps = {
  /** The chat the held address names (`/session/<id>`), or undefined on the workspace's home. */
  sessionId: string | undefined;
  /** The router's `navigate`, one function for the workspace's life: the shell's effects and doors use it. */
  navigate: NavigateFunction;
  /** The `navigate` the workspace's state hook moves the route with: held while the station covers the page. */
  holdNavigate: NavigateFunction;
  /** The page drawn over the workspace, handed on to the shell. */
  stationLayer: ReactNode;
};

const MemoizedProjectWorkspaceRouteContent = memo(ProjectWorkspaceRouteContent);

/** The chat a workspace address names: the `:sessionId` of `/session/:sessionId`, else undefined. */
function sessionIdOf(workspacePath: string): string | undefined {
  return matchPath('/session/:sessionId', parsePath(workspacePath).pathname ?? '/')?.params.sessionId;
}

/**
 * This module's only public export: THE APP'S ONE LAYOUT, rendered by App for `/`, `/session/:sessionId` and `/station` together, so a move between
 * the workspace and the station unmounts nothing. The workspace (its projects, its open chat, its scroll and its drafts) stays mounted while the station is
 * the page on screen, and the station, once visited, stays mounted while the workspace is. `stationLayer` is the station, drawn inside the workspace's own
 * chat host and Kaylee's provider, so the page keeps one of each.
 *
 * WHICH PAGE IS ON SCREEN is the router's: `/station` is the station, every other path the workspace (`useHeldWorkspace`). While the station covers it
 * the workspace stands at the address it had and is held out of reach (`HeldPage`, worn by the frame and by the station's layer); the doors between the
 * pages (`StationLayerProvider`) tell the station where to send "CloudCLI" back to.
 */
export default function ProjectWorkspaceRoute({ stationLayer }: { stationLayer: ReactNode }) {
  const { stationShowing, workspacePath, navigate, holdNavigate } = useHeldWorkspace();

  return (
    <StationLayerProvider showing={stationShowing} workspacePath={workspacePath}>
      <SessionProtectionProvider>
        <PaletteOpsProvider>
          <MemoizedProjectWorkspaceRouteContent
            sessionId={sessionIdOf(workspacePath)}
            navigate={navigate}
            holdNavigate={holdNavigate}
            stationLayer={stationLayer}
          />
        </PaletteOpsProvider>
      </SessionProtectionProvider>
    </StationLayerProvider>
  );
}

function ProjectWorkspaceRouteContent({ sessionId, navigate, holdNavigate, stationLayer }: ProjectWorkspaceRouteContentProps) {
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, subscribe } = useWebSocket();
  const { isSessionProcessing } = useSessionProtectionActions();

  useVisualViewportKeyboardOffset();

  return (
    <ProjectsStateProvider
      sessionId={sessionId}
      navigate={holdNavigate}
      subscribe={subscribe}
      isMobile={isMobile}
      isSessionProcessing={isSessionProcessing}
    >
      <ProjectWorkspaceShell
        isMobile={isMobile}
        ws={ws}
        sendMessage={sendMessage}
        navigate={navigate}
        stationLayer={stationLayer}
      />
    </ProjectsStateProvider>
  );
}
