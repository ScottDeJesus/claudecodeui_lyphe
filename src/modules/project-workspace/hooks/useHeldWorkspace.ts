import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPath, matchPath, parsePath, resolvePath, useLocation, useNavigate } from 'react-router-dom';
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom';

import { SESSIONS_HOME_PATH, STATION_PATH } from '@/shared/constants';

/** What the workspace stands on while the app is opened on the station or the sessions home and has stood nowhere else: its own first address. */
const HOME_PATH = '/';

/** What `useHeldWorkspace` hands the workspace's route. */
type HeldWorkspace = {
  /** True while the router stands at `/station`: the station is the page on screen and the workspace is held under it. */
  stationShowing: boolean;
  /** True while the router stands at `/home`: the sessions home is the page on screen and the workspace is held under it. */
  homeShowing: boolean;
  /** The address (path, search, hash) the workspace stands at: the live location while it is the page on screen, the last one it stood at while the station or the home covers it. */
  workspacePath: string;
  /** The router's `navigate`, as one function for the workspace's life: the switch to the station and back moves nothing the workspace depends on. */
  navigate: NavigateFunction;
  /**
   * The `navigate` the workspace's own state hook (`useProjectsState`) moves the route with: the router's while the workspace is on screen; while the station or the home covers it,
   * the move is made to the held address and the browser stays where it is. A session whose id is renamed by the server, a chat deleted from elsewhere, a lookup that finds
   * nothing: each ends in a navigation, and none of them is a reason to take the page out from under the station.
   */
  holdNavigate: NavigateFunction;
};

/**
 * THE WORKSPACE'S ADDRESS, HELD WHILE ANOTHER PAGE COVERS IT. The workspace, the station and the sessions home are three pages of one tab, so leaving the workspace
 * for either of the others must not unmount it, and it must keep the address it had (its session is read off it): while the router stands at `/station` or `/home`
 * the workspace is handed the last address that was neither, or `/` when the app was opened there. It follows the live location on every other path, adjusting its state during the render that
 * sees the location move (no effect behind it, so no frame draws the old address).
 *
 * Used by `ProjectWorkspaceRoute`, once.
 */
export function useHeldWorkspace(): HeldWorkspace {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const stationShowing = matchPath({ path: STATION_PATH, end: true }, location.pathname) !== null;
  // THE APP OPENS ON THE SESSIONS HOME. A window that opens at the bare root (`/`, no query, no hash) shows the home from its first render, and its address
  // follows in the effect below, by a replace, so Back does not find the root again. State, true for that one window until its address has moved: it is what
  // keeps the first paint from being the workspace's. Once, at the mount: every later move to `/` is the workspace's own (New chat, a chat removed, the way
  // back from the station) and stands, and an address that names something (a chat, the station, a landing's query) is left alone.
  const [landing, setLanding] = useState(() => location.pathname === HOME_PATH && location.search === '' && location.hash === '');
  const homeShowing = landing || matchPath({ path: SESSIONS_HOME_PATH, end: true }, location.pathname) !== null;
  // Either of the two pages drawn over the workspace is on screen: the workspace is held under it, at the address it had.
  const covered = stationShowing || homeShowing;
  const livePath = createPath(location);

  // The last address the workspace stood at. State, because the workspace's session is read off it while the station covers the page and nothing in the router remembers it.
  const [workspacePath, setWorkspacePath] = useState(() => (covered ? HOME_PATH : livePath));
  if (!covered && workspacePath !== livePath) setWorkspacePath(livePath);

  // The newest router `navigate`, the page on screen and the held path, written after each commit and read by the two functions below at the moment they are called.
  const routerNavigateRef = useRef(routerNavigate);
  const coveredRef = useRef(covered);
  const workspacePathRef = useRef(workspacePath);
  useLayoutEffect(() => {
    routerNavigateRef.current = routerNavigate;
    coveredRef.current = covered;
    workspacePathRef.current = workspacePath;
  });

  // The router's `navigate` changes identity with every path, the station's included, which would wake the whole workspace on a switch of pages. This one
  // never changes: it calls the router's newest.
  const navigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') routerNavigateRef.current(to);
    else routerNavigateRef.current(to, options);
  }, []) as NavigateFunction;

  const holdNavigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (!coveredRef.current) {
      if (typeof to === 'number') routerNavigateRef.current(to);
      else routerNavigateRef.current(to, options);
      return;
    }
    // A step through the browser's history is the browser's, not a move of the held address.
    if (typeof to === 'number') return;
    setWorkspacePath(createPath(resolvePath(to, parsePath(workspacePathRef.current).pathname)));
  }, []) as NavigateFunction;

  // A passive effect, not a layout one: the router subscribes to its history in a layout effect that runs after this component's own, and a move made
  // before that changes the address and tells the router nothing.
  /* oxlint-disable react-hooks/exhaustive-deps -- the mount's address alone. */
  useEffect(() => {
    if (!landing) return;
    routerNavigateRef.current(SESSIONS_HOME_PATH, { replace: true });
    setLanding(false);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  return { stationShowing, homeShowing, workspacePath, navigate, holdNavigate };
}
