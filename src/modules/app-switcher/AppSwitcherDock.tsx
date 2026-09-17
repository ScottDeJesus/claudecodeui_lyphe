import { useLayoutEffect, useRef } from 'react';

import { useAppSwitcher } from '@/modules/app-switcher/context/AppSwitcherContext';

/**
 * Where the FAB docks: an empty box in the sidebar's logo row, left of the wordmark.
 *
 * Rendered by the project-workspace module into the sidebar header's `leading` slot — the sidebar
 * never imports this module. It PAINTS NOTHING, no border and no ground: the FAB is one fixed node
 * for its whole life and is drawn centred on this box's rect, so the box only has to hold the space
 * open and say where it is. What the reader sees in the rail is the FAB itself.
 *
 * 28px at every width, the FAB's one size (`--vv-fab-size` in the kit's surfaces.css): the row it
 * joins holds 30px icon buttons beside a wordmark that truncates, so the slot stays no bigger than
 * the circle it holds. The FAB's 44px catch reaches 8px past this box on every side, which is the
 * `gap-2` the logo row leaves before the wordmark — the catch touches the wordmark and never
 * covers it.
 */
export function AppSwitcherDock() {
  const { registerDock } = useAppSwitcher();
  const dockRef = useRef<HTMLDivElement>(null);

  // A LAYOUT effect, so a docked FAB lands in the rail on the first paint instead of flashing in
  // the corner for a frame. `registerDock` is stable, so this runs on mount and its cleanup on
  // unmount — the moment a collapsed sidebar takes the whole header, dock included, away.
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
    // `h-7 w-7`, so a `ResizeObserver` on it could never fire, and neither could one on the wrapper
    // the sidebar header builds around it — that wrapper is sized to this box's content. Watching
    // nothing is worse than not watching, because the comment would then be claiming coverage the
    // element cannot give. A rail that changed width without a window resize would want an observer;
    // this rail has no such state (it is `md:w-[20.5rem]` while it is drawn, and `SidebarCollapsed`
    // swaps this whole header away when it is not).
    // The rects themselves are judged by the provider: a rect that has no size, or one that does not
    // intersect the viewport, is not a place the FAB may be sent to.
    window.addEventListener('resize', report);
    document.addEventListener('transitionend', report);

    return () => {
      window.removeEventListener('resize', report);
      document.removeEventListener('transitionend', report);
      // UNMOUNTED, so the rect goes with it. `SidebarCollapsed` swaps this whole header away when the
      // reader collapses the rail, and a remembered point that no longer exists is exactly where the
      // FAB would sit. Clearing it lets the kit float the button somewhere it can be reached.
      registerDock(null);
    };
  }, [registerDock]);

  return <div ref={dockRef} aria-hidden="true" className="h-7 w-7 flex-shrink-0" />;
}
