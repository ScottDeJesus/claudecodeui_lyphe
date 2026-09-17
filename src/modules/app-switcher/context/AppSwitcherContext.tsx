import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { useAppRegistry } from '@/modules/app-switcher/hooks/useAppRegistry';
import {
  fabPositionOf,
  fabRecordOf,
  readAppSwitcherRecord,
  writeAppSwitcherRecord,
} from '@/modules/app-switcher/utils/appSwitcherStorage';
import { dockableRect, sameRect } from '@/modules/app-switcher/utils/dockRect';
import type { AppEntry } from '@/shared/app-types';
import type { DockableFabPosition } from '@/shared/ui';

/** One half of the layer. With dual screen off only `left` is ever drawn. */
export type PaneSide = 'left' | 'right';

/**
 * One of the layer's two slots: the app it shows (or nothing), the url that app is framed at, and the
 * nonce a Reload bumps.
 *
 * The URL IS RESOLVED AT THE OPEN SITE and travels with the slot. Resolving `{host}` needs the page's
 * own address, and this module has exactly one place that reads it — the drawer's rows, which is also
 * the place that has to decide whether a row is this app looking at itself. Doing it again in the
 * layer would be a second reader of the same fact and a second answer to disagree with it.
 */
export type PaneSlot = { appId: string | null; src: string | null; reloadNonce: number };

type AppSwitcherValue = {
  /** The registry, in file order. A failed read keeps the last good list beside the error. */
  apps: AppEntry[];
  selfPorts: number[];
  registryError: string | null;
  /**
   * True once the first registry read has answered — with rows, or with a refusal. The drawer paints
   * placeholders before it and an empty state only after it, so "No applications yet" is a claim
   * somebody measured. See `useAppRegistry`.
   */
  registryRead: boolean;
  /**
   * Re-reads the registry. Fired on every drawer open, and by the drawer again after a row is added
   * or removed — the list it draws is the registry's answer, never a draft it made up.
   */
  refresh: () => Promise<void>;
  panes: Record<PaneSide, PaneSlot>;
  dual: boolean;
  /** The LEFT pane's share of the layer. */
  ratio: number;
  fabPosition: DockableFabPosition;
  /** The dock's rect when it is real and on screen; null means the FAB has nowhere to dock. */
  dockRect: DOMRect | null;
  nextSide: PaneSide;
  drawerOpen: boolean;
  /** Puts an app up in the side the next choice fills, or takes it down wherever it is already up. */
  open: (appId: string, src: string) => void;
  /** Clears both panes: the way back to the workspace. */
  close: () => void;
  toggleDual: (next: boolean) => void;
  /**
   * Turns dual screen ON with this app in the second half, in ONE update.
   *
   * It cannot be composed from `toggleDual(true)` and `open(...)`: `open` reads `dual` and
   * `nextSide` from the render it was made in, so a reader choosing it while dual screen is off
   * fills the LEFT half — an app beside itself is not what "Open in dual screen" says.
   */
  openInDualScreen: (appId: string, src: string) => void;
  setRatio: (next: number) => void;
  /** Remounts one side's pane by bumping its slot's nonce. A row finds its side in `panes`. */
  reload: (side: PaneSide) => void;
  moveFab: (next: DockableFabPosition) => void;
  registerDock: (rect: DOMRect | null) => void;
  chooseSide: (side: PaneSide) => void;
  /** Opening re-reads the registry, so the list is at most one open old. */
  setDrawerOpen: (open: boolean) => void;
};

const EMPTY_SLOT: PaneSlot = { appId: null, src: null, reloadNonce: 0 };

const AppSwitcherContext = createContext<AppSwitcherValue | null>(null);

/**
 * How long the record waits, after the divider stops moving, before it is written.
 *
 * The divider is the one value that arrives as a STREAM — `SplitPane` reports every pointermove of its
 * drag — and writing on each one would hammer storage for the length of the gesture. The moves of a
 * real drag are far closer together than this (the browser probe's own drag steps are 16ms apart), so
 * the timer is re-armed through the gesture and the record is written once, when the reader lets go.
 */
const RATIO_SETTLE_MS = 250;

/**
 * A LONE APPLICATION IS A LEFT APPLICATION — the invariant that keeps the state, the pane and the
 * layer saying one thing.
 *
 * `SplitPane` draws its left child whether or not it has a right one, so a single application always
 * FILLS the layer. An app left holding the right slot alone would therefore be drawn in the left half
 * while `panes.right` said otherwise — and the next application the reader chose would remount it into
 * the half it was already occupying. Moving the survivor left closes both at once, and it costs no
 * remount the clear had not already forced: an application coming down takes its frame with it either
 * way.
 */
function loneAppOnTheLeft(panes: Record<PaneSide, PaneSlot>): Record<PaneSide, PaneSlot> {
  if (panes.left.appId !== null || panes.right.appId === null) return panes;
  return { left: panes.right, right: EMPTY_SLOT };
}

/**
 * The switcher's one state home, mounted by the project-workspace module around the whole shell
 * so the dock (in the sidebar header), the FAB, its drawer and the layer (over the main region)
 * read one truth from four places in the tree.
 *
 * Every action is stable for the life of the provider except where its dependency list says
 * otherwise; the dock re-measures on `registerDock`'s identity, so that one must never change.
 */
export function AppSwitcherProvider({ children }: { children: ReactNode }) {
  const { apps, selfPorts, error: registryError, registryRead, refresh } = useAppRegistry();
  // The stored record, read once: only the first render's initial values come from it.
  const initial = useMemo(() => readAppSwitcherRecord(), []);

  // Which app each half shows. NOT persisted: a window reopens onto the workspace, every time.
  const [panes, setPanes] = useState<Record<PaneSide, PaneSlot>>({ left: EMPTY_SLOT, right: EMPTY_SLOT });
  // Dual screen on or off — a reader's standing preference, so it is persisted.
  const [dual, setDual] = useState(initial.dual);
  // The divider's position, persisted so a split reopens where the reader left it.
  const [ratio, setRatioValue] = useState(initial.ratio);
  // Where the FAB sits, persisted: the reader put it there, and storage wins at every width.
  const [fabPosition, setFabPosition] = useState<DockableFabPosition>(() => fabPositionOf(initial.fab));
  // The dock's measured rect. Measured by the dock, never derived: it is a fact about layout.
  const [dockRect, setDockRect] = useState<DOMRect | null>(null);
  // Which half the next choice in the drawer fills while dual screen is on. Set from the drawer's Opens-in strip.
  const [nextSide, setNextSide] = useState<PaneSide>('left');
  // Whether the drawer is open. Owned here, not by the FAB, so the FAB's pressed state and the sheet agree.
  const [drawerOpenValue, setDrawerOpenValue] = useState(false);

  const open = useCallback((appId: string, src: string) => {
    // With dual screen off there is one pane and one side; with it on, the side the drawer's Opens-in
    // strip last named.
    const side: PaneSide = dual ? nextSide : 'left';
    setPanes((current) => {
      // A row that is already up comes down again — from WHICHEVER half is holding it. The row reads
      // "on screen" and says so with `aria-pressed`, so the press is a toggle for the app the row
      // names: taking the other half's application away instead would leave the badge and the press
      // disagreeing, and would replace an application the reader never chose.
      if (current.left.appId === appId) return loneAppOnTheLeft({ ...current, left: EMPTY_SLOT });
      if (current.right.appId === appId) return loneAppOnTheLeft({ ...current, right: EMPTY_SLOT });
      // A choice aimed at the right half with the left half empty lands in the LEFT half instead:
      // nothing is to the right of nothing, and a lone app is drawn filling the layer. See
      // `loneAppOnTheLeft`.
      const fill: PaneSide = current.left.appId === null ? 'left' : side;
      return { ...current, [fill]: { appId, src, reloadNonce: current[fill].reloadNonce } };
    });
  }, [dual, nextSide]);

  const close = useCallback(() => {
    setPanes({ left: EMPTY_SLOT, right: EMPTY_SLOT });
    // Nothing is up, so the next choice has one side it could possibly go to. Leaving the strip
    // pointing at Right would put the next application in the right half of a single-pane layer.
    setNextSide('left');
  }, []);

  const toggleDual = useCallback((next: boolean) => {
    setDual(next);
    if (next) {
      // Turning it ON seeds the second slot. The left pane keeps whatever is already up — a reader who
      // switches dual screen on with one application showing means to put a SECOND one beside it, not
      // to watch the first be replaced — so the next choice is aimed at the empty side.
      setNextSide(panes.left.appId === null ? 'left' : 'right');
    } else {
      // Turning it OFF takes the right pane down with it: a half the layer no longer draws must not
      // stay in the state, or the drawer would go on reading it as "on screen".
      setPanes((current) => (current.right.appId === null ? current : { ...current, right: EMPTY_SLOT }));
      setNextSide('left');
    }
    // A switch is one act, so this is the end of the gesture the record is written at.
    writeAppSwitcherRecord({ fab: fabRecordOf(fabPosition), dual: next, ratio });
  }, [panes, fabPosition, ratio]);

  /**
   * Dual screen on, the next choice aimed at the right half, and THIS app in it — one update, so
   * every value the write needs is the one the reader's act meant. See the type's own note on why
   * `toggleDual(true)` then `open(...)` cannot say this.
   */
  const openInDualScreen = useCallback((appId: string, src: string) => {
    setDual(true);
    // Aimed at the right whatever happens to this app below, so the next application the reader
    // chooses goes BESIDE it rather than on top of it.
    setNextSide('right');
    setPanes((current) => {
      // An app that is already up keeps the half it is in. Filling the second half with the app the
      // first half is showing would draw one application twice.
      if (current.left.appId === appId || current.right.appId === appId) return current;
      // Nothing is to the right of nothing: a first application fills the LEFT half and the layer
      // with it, and the aim above is what puts the second one beside it. See `loneAppOnTheLeft`.
      const filled = { ...current, right: { appId, src, reloadNonce: current.right.reloadNonce } };
      return loneAppOnTheLeft(filled);
    });
    // A switch is one act: the same end of the gesture `toggleDual` writes the record at.
    writeAppSwitcherRecord({ fab: fabRecordOf(fabPosition), dual: true, ratio });
  }, [fabPosition, ratio]);

  const setRatio = useCallback((next: number) => {
    // Written by the effect below, once the moves stop: `SplitPane` reports every pointermove.
    setRatioValue(next);
  }, []);

  const reload = useCallback((side: PaneSide) => {
    setPanes((current) => ({
      ...current,
      [side]: { ...current[side], reloadNonce: current[side].reloadNonce + 1 },
    }));
  }, []);

  const moveFab = useCallback((next: DockableFabPosition) => {
    setFabPosition(next);
    // Written HERE rather than from an effect: the kit hands a position over exactly once, at the
    // release that ended the drag, so this IS the end of the gesture. A reader who reloads the page
    // straight after dropping the button must not come back to the position it had before the drag.
    writeAppSwitcherRecord({ fab: fabRecordOf(next), dual, ratio });
  }, [dual, ratio]);

  const registerDock = useCallback((rect: DOMRect | null) => {
    setDockRect((current) => {
      const next = dockableRect(rect);
      // Unchanged answers keep the object they found: see `sameRect`.
      return sameRect(current, next) ? current : next;
    });
  }, []);

  const chooseSide = useCallback((side: PaneSide) => {
    setNextSide(side);
  }, []);

  const setDrawerOpen = useCallback((next: boolean) => {
    setDrawerOpenValue(next);
    // Opening re-reads the registry, so a row the operator appended a second ago is in the list the
    // next time the drawer is looked at. `useAppRegistry` says why this is a call on open and never a
    // timer.
    if (next) void refresh();
  }, [refresh]);

  // The record's third value, and the only one written on a delay: the divider reports every move of
  // its drag. The FAB's position and the dual flag are written by the callbacks that receive them,
  // each of which is handed its value once per gesture.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeAppSwitcherRecord({ fab: fabRecordOf(fabPosition), dual, ratio });
    }, RATIO_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [ratio, fabPosition, dual]);

  const value = useMemo<AppSwitcherValue>(
    () => ({
      apps,
      selfPorts,
      registryError,
      registryRead,
      refresh,
      panes,
      dual,
      ratio,
      fabPosition,
      dockRect,
      nextSide,
      drawerOpen: drawerOpenValue,
      open,
      close,
      toggleDual,
      openInDualScreen,
      setRatio,
      reload,
      moveFab,
      registerDock,
      chooseSide,
      setDrawerOpen,
    }),
    [
      apps, selfPorts, registryError, registryRead, refresh, panes, dual, ratio, fabPosition, dockRect,
      nextSide, drawerOpenValue, open, close, toggleDual, openInDualScreen, setRatio, reload, moveFab,
      registerDock, chooseSide, setDrawerOpen,
    ],
  );

  return <AppSwitcherContext.Provider value={value}>{children}</AppSwitcherContext.Provider>;
}

/** Read by the switcher's own dock, FAB, drawer and layer. Never leaves the module's barrel. */
export function useAppSwitcher(): AppSwitcherValue {
  const context = useContext(AppSwitcherContext);
  if (!context) throw new Error('useAppSwitcher must be used within <AppSwitcherProvider>');
  return context;
}
