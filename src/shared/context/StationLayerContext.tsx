import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CompanionOpenTarget } from '@/shared/companion-types';
import { createStableContext } from '@/shared/context/stableContext';

/** What puts a thing she opened on the station's stage: the station's `openOnStage`, handed to the workspace's host by `registerStageOpen`. */
type StageOpen = (target: CompanionOpenTarget, label: string) => void;

/** The doors between the two whole pages of the app, held in one place so neither page imports the other. */
type StationDoors = {
  /** Whether the station is the page on screen, read at the moment of the call: for a handler that lives on a page the station covers (a hotkey) and must stand down. */
  showing: () => boolean;
  /**
   * Calls `listener` each time the station comes on screen or leaves it, after the commit that moved it. For what must stand down on the covered page without
   * being rendered again by the switch (the chat's presence report, which would otherwise re-render the transcript's owner). Returns the release.
   */
  onShowingChange: (listener: () => void) => () => void;
  /**
   * The router's `navigate`, as ONE function for the provider's life. `useNavigate()` itself changes identity (and re-renders its caller) on every path, which
   * would re-render the whole station each time the page switches; the station reaches the router through this instead.
   */
  navigate: (to: string) => void;
  /** The workspace address (path, search and hash) "Back to CloudCLI" returns to: the last page that was not the station, or `/` when the app was opened on the station. */
  workspacePath: () => string;
  /**
   * The station's one registration, made while it stands mounted: `open` is what her `companion_open` is handed to while the station is the page on screen. Returns the release.
   * An open that arrived while the station was showing and had not yet registered (its first visit, the chunk still loading) is delivered the moment it does.
   */
  registerStageOpen: (open: StageOpen) => () => void;
  /**
   * The workspace host's one registration: `open` brings a chat forward in the workspace (the Chat view, the route at that chat, floated over an application that
   * covers the page). Returns the release.
   */
  registerWorkspaceChatOpen: (open: (sessionId: string) => void) => () => void;
  /** The station's "Open the chat": takes the page out of the station and shows that chat in the workspace, exactly as her own order to open it does. */
  openChatInWorkspace: (sessionId: string) => void;
  /**
   * The workspace host's first question for every open of hers: hands it to the station and answers true while the station is showing, else false and the host opens it
   * on the workspace.
   */
  openOnStage: (target: CompanionOpenTarget, label: string) => boolean;
};

const StationShowingContext = createStableContext(import.meta.hot, 'StationShowingContext', false);
const StationDoorsContext = createStableContext<StationDoors | null>(import.meta.hot, 'StationDoorsContext', null);

/**
 * Whether the station is the page on screen, i.e. the router stands at `/station`. Its own context, apart from the doors: a switch re-renders
 * only what reads this, never the pages' trees. Read by `HeldPage` (project-workspace and station, to hold whichever page is not on screen),
 * by project-workspace's frame (the chat is out of sight while the station covers it) and by the station's hooks that act only while it is on screen.
 */
export function useStationShowing(): boolean {
  return useContext(StationShowingContext);
}

/**
 * The doors between the workspace and the station, which never change identity. Read by project-workspace's `CompanionHost` (`openOnStage`), by the
 * station (`registerStageOpen`; `navigate` and `workspacePath` for its "CloudCLI"; `openChatInWorkspace` for its "Open the chat"). Throws outside `StationLayerProvider`, so a consumer placed wrong fails at once.
 */
export function useStationDoors(): StationDoors {
  const doors = useContext(StationDoorsContext);
  if (!doors) throw new Error('useStationDoors must be used within a StationLayerProvider');
  return doors;
}

/**
 * Used by project-workspace's route, which owns the router's location and so knows which page is on screen: it hands in whether the station is showing and the
 * address the workspace stood at, and everything under it reads them through `useStationShowing` and `useStationDoors`.
 *
 * THE DOORS ARE READ FROM REFS, so their identity is one for the provider's life: a switch between the pages changes `showing` (one context, a few readers) and
 * nothing a page holds as a dependency.
 */
export function StationLayerProvider({ showing, workspacePath, children }: { showing: boolean; workspacePath: string; children: ReactNode }) {
  // The newest of both, written after each commit, so a door that is called later (a frame off the socket, a press) answers from now and not from the render it was made in.
  const showingRef = useRef(showing);
  const workspacePathRef = useRef(workspacePath);
  const showingListenersRef = useRef(new Set<() => void>());
  // The router's newest `navigate`, called through one stable function (`doors.navigate`).
  const routerNavigate = useNavigate();
  const routerNavigateRef = useRef(routerNavigate);
  useLayoutEffect(() => {
    routerNavigateRef.current = routerNavigate;
  });
  const navigate = useCallback((to: string) => routerNavigateRef.current(to), []);
  useLayoutEffect(() => {
    workspacePathRef.current = workspacePath;
  }, [workspacePath]);
  // A layout effect, so a listener called from it (and any passive effect after it) reads the page that is on screen NOW.
  useLayoutEffect(() => {
    if (showingRef.current === showing) return;
    showingRef.current = showing;
    showingListenersRef.current.forEach((listener) => listener());
  }, [showing]);

  const onShowingChange = useCallback((listener: () => void) => {
    showingListenersRef.current.add(listener);
    return () => {
      showingListenersRef.current.delete(listener);
    };
  }, []);

  // The station's handler while it is mounted, or null.
  const stageOpenRef = useRef<StageOpen | null>(null);
  // The newest open that arrived while the station was showing and had no handler yet; delivered on registration.
  const waitingOpenRef = useRef<{ target: CompanionOpenTarget; label: string } | null>(null);

  const registerStageOpen = useCallback((open: StageOpen) => {
    stageOpenRef.current = open;
    const waiting = waitingOpenRef.current;
    waitingOpenRef.current = null;
    if (waiting !== null) open(waiting.target, waiting.label);
    return () => {
      if (stageOpenRef.current === open) stageOpenRef.current = null;
    };
  }, []);

  // The workspace host's handler for bringing a chat forward, or null.
  const workspaceChatOpenRef = useRef<((sessionId: string) => void) | null>(null);
  const registerWorkspaceChatOpen = useCallback((open: (sessionId: string) => void) => {
    workspaceChatOpenRef.current = open;
    return () => {
      if (workspaceChatOpenRef.current === open) workspaceChatOpenRef.current = null;
    };
  }, []);
  const openChatInWorkspace = useCallback((sessionId: string) => workspaceChatOpenRef.current?.(sessionId), []);

  const openOnStage = useCallback((target: CompanionOpenTarget, label: string): boolean => {
    if (!showingRef.current) return false;
    if (stageOpenRef.current === null) waitingOpenRef.current = { target, label };
    else stageOpenRef.current(target, label);
    return true;
  }, []);

  const doors = useMemo<StationDoors>(
    () => ({
      navigate,
      showing: () => showingRef.current,
      onShowingChange,
      workspacePath: () => workspacePathRef.current,
      registerStageOpen,
      registerWorkspaceChatOpen,
      openChatInWorkspace,
      openOnStage,
    }),
    [navigate, onShowingChange, registerStageOpen, registerWorkspaceChatOpen, openChatInWorkspace, openOnStage],
  );

  // The held open outlives nothing: the station leaving the screen without ever registering drops it.
  useEffect(() => {
    if (!showing) waitingOpenRef.current = null;
  }, [showing]);

  return (
    <StationDoorsContext.Provider value={doors}>
      <StationShowingContext.Provider value={showing}>{children}</StationShowingContext.Provider>
    </StationDoorsContext.Provider>
  );
}
