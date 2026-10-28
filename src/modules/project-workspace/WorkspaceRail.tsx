import { Settings } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccountRailButton, UsageRings } from '@/modules/accounts';
import { AppSwitcherDock } from '@/modules/app-switcher';
import { CompanionDoorButton } from '@/modules/companion';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useRailBadges } from '@/modules/project-workspace/hooks/useRailBadges';
import { useWorkspaceViews } from '@/modules/project-workspace/hooks/useWorkspaceViews';
import RailButton from '@/modules/project-workspace/RailButton';
import { PAGE_ANCHOR } from '@/shared/constants';
import type { AppTab, DockPress, SidebarListState, WorkspaceView, WorkspaceViewGroup } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The runs the scroll region draws, top to bottom. The `foot` run stands below it, outside the scroll. */
const SCROLL_GROUPS: readonly WorkspaceViewGroup[] = ['chat', 'tools', 'plans', 'house', 'plugins'];

/** A 24px hairline between two runs. `aria-hidden`: where one run ends is the eye's business, not a reader's. */
function RailHairline({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('h-px w-6 flex-none bg-border', className)} />;
}

/**
 * THE VIEWS RAIL: the house's views as one column of glyphs down the sidebar's left edge, one of them lit.
 *
 * A `<nav>` of buttons, not a tablist, because two of its buttons are not views: Settings opens a dialog and the
 * account a panel. The lit view says so with `aria-current="page"`.
 *
 * TOP TO BOTTOM: the app switcher's disc, a hairline, then the views in their runs — `chat`, `tools`, `plans`, `house`,
 * `plugins` — with a hairline between each pair of runs that are drawn, and at the foot the two usage rings (5-hour
 * over weekly: a status, not a button, always in their places), the Inbox, Settings and the account. The runs scroll
 * in a region of their own, so in a window too short for the rail the disc and the foot stay put. The region spans
 * the rail's whole width because a scroller clips at its own box, and the lit bar, the badges and the focus rings
 * reach to the rail's edges. It keeps 6px of scroll padding at each end, so a button the keyboard
 * or the reveal brings in keeps its whole ring clear of the edge. Its scrollbar is hidden: 48px has no room for one,
 * and a wheel, a swipe and the keyboard (a focused button scrolls itself into view) all still scroll it.
 *
 * THE EDGES say where runs are hidden, since no scrollbar does. While runs are hidden below, a full-width line stands
 * on the region's bottom edge over the runs passing under it; while runs are hidden above, the hairline under the disc
 * widens into the same line, on the same row. Each edge is a sticky line under a cover in the canvas at the runs' own
 * end: once that end is in view the cover sits on the line, so a rail with room draws neither and nothing is measured.
 * The top cover draws the hairline under the disc itself, which is why the region starts on that hairline's row. No
 * fade: it would wash the rings and glyphs of the buttons it crossed. The foot stands above both edges, so the ring of
 * its first button, which on a phone sits on the button's edge, is never crossed by the bottom line.
 *
 * On an iPhone the foot clears the home indicator: the nav pads its bottom by the safe-area inset, as the list's own
 * foot beside it does.
 *
 * THE DISC is the switcher's one FAB. It floats over the page and is drawn over the dock's box in the top cell, so the
 * dock paints nothing. While the list is collapsed, a press on it brings the list back.
 *
 * THE GROUND is the canvas, the list's own, and a badge's ring is the ground of the button it stands on. The hairline
 * between the rail and the list is the list's left edge, not the rail's right one, so a rail standing alone — the
 * list collapsed — draws one edge, the sidebar's own. `relative z-50`, so what the rail opens beside itself (the
 * account panel) stands above the list and, with the list collapsed, above an open application's layer: the layer is
 * `z-40` in this same stacking context and begins where the rail ends, so it would cover the panel at any lower level.
 * The FAB (60) stays above the rail.
 *
 * Composed for this module's ProjectSidebarRegion, which renders it into the sidebar's `rail` slot.
 */
export default function WorkspaceRail({ list, isMobile }: { list: SidebarListState; isMobile: boolean }) {
  const { t } = useTranslation();
  const { activeTab, setActiveTab, setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();
  const { views } = useWorkspaceViews();
  const badges = useRailBadges();

  // The scroll region: the reveal finds the lit button in it, and the Chat watch below reads it as its root.
  const scrollRef = useRef<HTMLDivElement>(null);
  // The lit button comes into view whenever the view changes, wherever the change came from (the palette, a link, a
  // stored id), and when the lit button first appears (a persisted plugin view lands with the plugin list, after the view
  // was chosen): in a window too short for the rail it may be in a run scrolled out of sight. `nearest` leaves the
  // region be when the button is already whole in it. A FRAME LATER, because a dialog closing on the same commit
  // (the palette's "Go to") returns focus to the rail button that held it, and focusing it scrolls the region back to
  // it: the reveal must come after that, not before.
  const litPresent = views.some((view) => view.id === activeTab);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, litPresent]);

  // Whether the Chat button stands whole in the scroll region. State because the switcher's disc, seated in this rail,
  // draws no dot while the Chat badge says a reply waits — and in a window too short for the rail the region scrolls
  // and the reveal of a lit view far down can take Chat out of it, leaving the reply unsigned. Watched only while a
  // reply waits, by an observer rooted at the region, so nothing polls and no scroll listener runs.
  const [chatInView, setChatInView] = useState(true);
  const chatBadged = badges.chat !== undefined;
  useEffect(() => {
    const region = scrollRef.current;
    const chatButton = region?.querySelector('[data-view-id="chat"]');
    if (!chatBadged || !region || !chatButton) return undefined;
    const watch = new IntersectionObserver(([entry]) => setChatInView(entry.intersectionRatio >= 0.9), { root: region, threshold: [0.9] });
    watch.observe(chatButton);
    return () => watch.disconnect();
  }, [chatBadged]);

  // A press on a phone chooses a pane the drawer is covering, so the drawer gets out of the way. Docked, it closes nothing.
  const press = (id: AppTab) => {
    setActiveTab(id);
    if (isMobile) setSidebarOpen(false);
  };

  // What the seated disc does in place of opening the radial while the list is collapsed: bring the list back. Memoised
  // so the dock's layout effect, keyed on it, writes the switcher's context once per change of the collapse and not once
  // per render of the rail. `list.expand` keeps one identity (the sidebar holds it in a `useCallback`).
  const pressOverride = useMemo<DockPress | null>(
    () => (list.collapsed ? { label: t('rail.showList'), run: list.expand } : null),
    [list.collapsed, list.expand, t],
  );

  // A run with no view in it is dropped first, so a hairline never stands at an end or beside another.
  const runs = SCROLL_GROUPS.map((group) => views.filter((view) => view.group === group)).filter((run) => run.length > 0);
  const footViews = views.filter((view) => view.group === 'foot');

  const viewButton = (view: WorkspaceView) => (
    <RailButton
      key={view.id}
      viewId={view.id}
      // The Files button is where a guide points while dactyls read code and the tree is not drawn.
      anchorKey={view.id === 'files' ? PAGE_ANCHOR.railFiles : undefined}
      label={view.label}
      icon={view.icon}
      lit={view.id === activeTab}
      badge={badges[view.id] ?? null}
      onPress={() => press(view.id)}
    />
  );

  return (
    <nav
      aria-label={t('rail.label')}
      className="relative z-50 flex h-full w-12 flex-none flex-col items-center bg-background pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pt-2"
    >
      <div className="grid size-11 flex-none place-items-center md:size-10">
        <AppSwitcherDock unreadBadgeHidden={chatBadged && !chatInView} pressOverride={pressOverride} />
      </div>
      <div
        ref={scrollRef}
        className="scrollbar-hide mt-1 flex min-h-0 w-full flex-1 scroll-py-1.5 flex-col items-center overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        {/* The top edge's line, and over it until runs are hidden above, its cover: the hairline under the disc. */}
        <div aria-hidden="true" className="pointer-events-none sticky top-0 z-20 h-px w-full flex-none bg-border" />
        <div aria-hidden="true" className="pointer-events-none relative z-30 -mt-px mb-1 flex h-px w-full flex-none justify-center bg-background">
          <RailHairline />
        </div>
        {runs.map((run, index) => (
          <Fragment key={run[0].group}>
            {index > 0 && <RailHairline className="my-1" />}
            {run.map(viewButton)}
          </Fragment>
        ))}
        {/* The bottom edge's line, and the cover that sits on it once the runs' end is in view. */}
        <div aria-hidden="true" className="pointer-events-none sticky bottom-0 z-20 mt-1 h-px w-full flex-none bg-border" />
        <div aria-hidden="true" className="pointer-events-none relative z-30 -mt-px h-px w-full flex-none bg-background" />
      </div>
      <div className="relative z-40 flex flex-none flex-col items-center">
        <UsageRings />
        <CompanionDoorButton />
        {footViews.map(viewButton)}
        <RailButton
          label={t('rail.settings')}
          icon={Settings}
          onPress={() => sidebarSharedProps.onShowSettings()}
        />
        <AccountRailButton />
      </div>
    </nav>
  );
}
