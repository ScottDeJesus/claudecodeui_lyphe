import { PanelLeftOpen } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';
import { FAB_SELECTOR, RAIL_BUTTON_BASE, RAIL_BUTTON_UNLIT } from '@/shared/constants';
import type { DockPress } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * Where the FAB docks: an empty box in the top cell of the sidebar's views rail.
 *
 * Rendered by the project-workspace module's WorkspaceRail, in the rail's disc cell — a 40px cell, 44px below
 * md, the box centred in it about 24px in from the rail's left edge. The rail reaches the sidebar through its
 * `rail` slot, so the sidebar never imports this module. The BOX PAINTS NOTHING, no border and no ground: the FAB is
 * one fixed node for its whole life and is drawn centred on this box's rect, so the box only has to hold the
 * space open and say where it is. What the reader sees in the rail is the FAB itself.
 *
 * 28px at every width, the FAB's one size (`--vv-fab-size` in the kit's surfaces.css): the cell is a button's
 * size, so the box stays no bigger than the circle it holds. The FAB's 44px catch reaches 8px past this box on
 * every side, which the 48px rail holds whole — the catch never reaches the list beside it.
 *
 * THE DOCK NEVER UNMOUNTS ON A COLLAPSE. Collapsing the chat list hides the list column only; the rail, and this dock in
 * it, keep their place in the tree and their rect, so the FAB stays seated through it.
 *
 * `pressOverride` is what the rail asks the seated disc to do with a press instead of opening the radial, and the name
 * it carries (the rail names "Show the chat list" while the list is collapsed). It is written to the switcher's context
 * as `dockPress` and cleared when the dock unmounts; the FAB reads it there, since which press goes which way is decided
 * where the FAB, its seat and its drag live. With the disc DRAGGED OUT of the dock and an override set, nothing seated
 * would answer it, so the dock draws its own rail button over the box, with the same name and the same act. The box
 * keeps registering its rect beneath that button, so a drag back still docks. When an override ARRIVES just as the
 * element that held focus has left the page (the list's hide button, unmounted by the collapse it ran), focus is handed
 * to the seated disc, or to that button when the disc is out: a keyboard reader who collapsed the list lands on the way
 * back. A page that loads collapsed, or a collapse that arrives from another tab, has no such element and moves nothing.
 *
 * `unreadBadgeHidden` is the rail's one other fact the FAB needs: a reply waits and the Chat badge that says so is scrolled
 * out of the rail's region (a window too short for the rail). The seated disc draws no dot while the badge shows, so
 * this is what puts the dot back; it is written to the switcher's context and cleared when the dock unmounts.
 */
export function AppSwitcherDock({
  unreadBadgeHidden = false,
  pressOverride = null,
}: {
  unreadBadgeHidden?: boolean;
  pressOverride?: DockPress | null;
}) {
  const { registerDock, setDockBadgeHidden, setDockPress, fabPosition, dockRect } = useAppSwitcher();
  const dockRef = useRef<HTMLDivElement>(null);
  const ownButtonRef = useRef<HTMLButtonElement>(null);

  // The kit's own test for "drawn in the dock", less the drag in hand: docked, on a dock that measured.
  const seated = fabPosition.docked && dockRect !== null;
  // Read by the focus hand-off below at the moment an override arrives, so that hand-off is keyed on the arrival alone
  // and a disc dragged out or back later never re-runs it.
  const seatedRef = useRef(seated);
  useLayoutEffect(() => {
    seatedRef.current = seated;
  });

  // A LAYOUT effect, so a docked FAB lands in the rail on the first paint instead of flashing in
  // the corner for a frame. `registerDock` is stable, so this runs on mount and its cleanup on
  // unmount — the moment the rail itself leaves the tree.
  useLayoutEffect(() => {
    const box = dockRef.current;
    if (!box) return;
    const report = () => registerDock(box.getBoundingClientRect());
    report();

    // WHEN TO RE-MEASURE, and there are exactly two signals because there are exactly two ways this
    // box can move:
    //   - a window resize reflows the rail the box sits in;
    //   - the sidebar's mobile drawer slides in and out under a transform, taking the box with it —
    //     and its `transitionend` is the only signal the sidebar module gives without being imported
    //     (this module must not depend on it; the dependency points the other way).
    // NO OBSERVER IS INSTALLED, and not because one here would be redundant: this box is a fixed
    // `h-7 w-7`, so a `ResizeObserver` on it could never fire, and neither could one on the cell the
    // rail puts around it — that cell changes size only where the `md` breakpoint does, which is a
    // window resize. Watching nothing is worse than not watching, because the comment would then be
    // claiming coverage the element cannot give. A rail that changed width without a window resize
    // would want an observer;
    // this rail has no such state (it is a fixed `w-12` column, and collapsing the list hides the
    // column beside it, never this one).
    // The rects themselves are judged by the provider: a rect that has no size, or one that does not
    // intersect the viewport, is not a place the FAB may be sent to.
    window.addEventListener('resize', report);
    document.addEventListener('transitionend', report);

    return () => {
      window.removeEventListener('resize', report);
      document.removeEventListener('transitionend', report);
      // UNMOUNTED, so the rect goes with it. A remembered point that no longer exists is exactly where the FAB
      // would sit; clearing it lets the kit float the button somewhere it can be reached.
      registerDock(null);
    };
  }, [registerDock]);

  // A layout effect, as the measuring one is, so the dot and the seat change in one frame. Cleared with the dock: the
  // FAB with no rail draws its dot by the ordinary rule.
  useLayoutEffect(() => {
    setDockBadgeHidden(unreadBadgeHidden);
    return () => setDockBadgeHidden(false);
  }, [unreadBadgeHidden, setDockBadgeHidden]);

  // A layout effect for the same reason: the FAB's press and its label change in the frame the list does, so there is
  // no frame where the list is collapsed and the disc still offers the radial. The cleanup runs before each write and
  // on unmount; the two writes of a change are batched, so the FAB never sees the null between them.
  useLayoutEffect(() => {
    setDockPress(pressOverride);
    return () => setDockPress(null);
  }, [pressOverride, setDockPress]);

  // The last element that held focus. A focused button that unmounts leaves focus on the body and no event anyone hears,
  // so the hand-off below asks whether the holder has LEFT the document. That tells a collapse the reader pressed apart
  // from a stored preference that arrives after the page loads (a cold localStorage mirror) or from another tab, where
  // the body held focus all along and focus is not the dock's to take.
  const lastFocused = useRef<Element | null>(null);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      lastFocused.current = event.target instanceof Element ? event.target : null;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  // Focus follows the override's ARRIVAL, not its presence: the previous value starts as the mount's, so a page that
  // loads with the list already collapsed has no arrival. Then only while nothing holds focus (`document.body`) and the
  // element that did has gone, which is what a pressed hide button unmounting leaves behind.
  const hasOverride = pressOverride !== null;
  const hadOverride = useRef(hasOverride);
  useEffect(() => {
    if (hadOverride.current === hasOverride) return;
    hadOverride.current = hasOverride;
    const holder = lastFocused.current;
    if (!hasOverride || document.activeElement !== document.body || holder === null || holder.isConnected) return;
    const target = seatedRef.current ? document.querySelector<HTMLElement>(FAB_SELECTOR) : ownButtonRef.current;
    target?.focus();
  }, [hasOverride]);

  return (
    // Its own grid, so the button below can stand in the box's cell without the rail's cell being any particular
    // layout. The wrapper fills the cell the rail gives it, and the box is centred in it as it always was.
    <div className="grid size-full place-items-center">
      <div ref={dockRef} aria-hidden="true" className="col-start-1 row-start-1 h-7 w-7 flex-shrink-0" />
      {pressOverride !== null && !seated && (
        // The disc is out of its dock and the list is collapsed, so nothing seated answers the override: the dock draws
        // the act itself, in the rail's own button. The wrapper is the cell's size, the button's own.
        <div className="col-start-1 row-start-1">
          <Tooltip position="right" showOnFocus content={pressOverride.label}>
            <button
              ref={ownButtonRef}
              type="button"
              aria-label={pressOverride.label}
              onClick={pressOverride.run}
              className={cn(RAIL_BUTTON_BASE, RAIL_BUTTON_UNLIT)}
            >
              <PanelLeftOpen className="size-5" strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
