import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPath, matchPath, parsePath, resolvePath, useLocation, useNavigate } from 'react-router-dom';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom';

import { STATION_PATH } from '@/shared/constants';

/** What the workspace stands on while the app is opened on the station and has stood nowhere else: its home. */
const HOME_PATH = '/';

/** What `useHeldWorkspace` hands the workspace's route. */
type HeldWorkspace = {
  /** True while the router stands at `/station`: the station is the page on screen and the workspace is held under it. */
  stationShowing: boolean;
  /** The address (path, search, hash) the workspace stands at: the live location while it is the page on screen, the last one it stood at while the station covers it. */
  workspacePath: string;
  /** The router's `navigate`, as one function for the workspace's life: the switch to the station and back moves nothing the workspace depends on. */
  navigate: NavigateFunction;
  /**
   * The `navigate` the workspace's own state hook (`useProjectsState`) moves the route with: the router's while the workspace is on screen; while the station covers it,
   * the move is made to the held address and the browser stays where it is. A session whose id is renamed by the server, a chat deleted from elsewhere, a lookup that finds
   * nothing: each ends in a navigation, and none of them is a reason to take the page out from under the station.
   */
  holdNavigate: NavigateFunction;
};

/**
 * THE WORKSPACE'S ADDRESS, HELD WHILE THE STATION COVERS IT. The workspace and the station are two pages of one tab, so leaving the workspace for the station
 * must not unmount it, and it must keep the address it had (its session is read off it): while the router stands at `/station` the workspace is handed the last address
 * that was not the station's, or `/` when the app was opened there. It follows the live location on every other path, adjusting its state during the render that
 * sees the location move (no effect behind it, so no frame draws the old address).
 *
 * Used by `ProjectWorkspaceRoute`, once.
 */
export function useHeldWorkspace(): HeldWorkspace {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const stationShowing = matchPath({ path: STATION_PATH, end: true }, location.pathname) !== null;
  const livePath = createPath(location);

  // The last address the workspace stood at. State, because the workspace's session is read off it while the station covers the page and nothing in the router remembers it.
  const [workspacePath, setWorkspacePath] = useState(() => (stationShowing ? HOME_PATH : livePath));
  if (!stationShowing && workspacePath !== livePath) setWorkspacePath(livePath);

  // The newest router `navigate`, the page on screen and the held path, written after each commit and read by the two functions below at the moment they are called.
  const routerNavigateRef = useRef(routerNavigate);
  const stationShowingRef = useRef(stationShowing);
  const workspacePathRef = useRef(workspacePath);
  useLayoutEffect(() => {
    routerNavigateRef.current = routerNavigate;
    stationShowingRef.current = stationShowing;
    workspacePathRef.current = workspacePath;
  });

  // The router's `navigate` changes identity with every path, the station's included, which would wake the whole workspace on a switch of pages. This one
  // never changes: it calls the router's newest.
  const navigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') routerNavigateRef.current(to);
    else routerNavigateRef.current(to, options);
  }, []) as NavigateFunction;

  const holdNavigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (!stationShowingRef.current) {
      if (typeof to === 'number') routerNavigateRef.current(to);
      else routerNavigateRef.current(to, options);
      return;
    }
    // A step through the browser's history is the browser's, not a move of the held address.
    if (typeof to === 'number') return;
    setWorkspacePath(createPath(resolvePath(to, parsePath(workspacePathRef.current).pathname)));
  }, []) as NavigateFunction;

  return { stationShowing, workspacePath, navigate, holdNavigate };
}
