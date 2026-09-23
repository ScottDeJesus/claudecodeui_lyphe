import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';

import { MoreFace, TabsMore } from '@/shared/ui/TabsMore';
import { useTabsOverflow } from '@/shared/ui/useTabsOverflow';
import { cn } from '@/shared/utils';

/**
 * `count` is a capability of the strip, not a prop every caller needs: a measured site
 * (doctrine §8) decides it exists. One caller today — the workspace strip's Memory tab
 * (Phase 5); the git panel's two tabs pass none.
 *
 * A tab with an `icon` draws the glyph ALONE and keeps `label` as its accessible name and
 * hover title — the workspace strip's built-in tabs, where seven words never fit a 328px
 * sidebar without a scroller. A tab without one draws its label, unchanged.
 */
export type TabItem = {
  id: string;
  label: string;
  count?: number;
  icon?: ComponentType<{ className?: string; strokeWidth?: string | number }>;
};

/**
 * Arrow / Home / End move the selection, which is the contract `role="tablist"` announces.
 *
 * Ported from WorkspaceTabs.tsx:82-99 rather than invented: that strip is the first thing
 * Phase 5 hands to this component, and it has this behaviour today. A `Tabs` without it would
 * announce "tab, 1 of 3" and then do nothing when the reader presses ArrowRight — a regression
 * dressed as a restyle. Focus and click move together, so the selection follows focus the way
 * the app's own strip already does.
 *
 * An overflowing row's More trigger is the last stop the arrows reach, and landing on it moves
 * focus ONLY: a trigger that opened on arrival would drop a menu over the row every time a reader
 * walked past it. Enter or Space opens it, which is the Menu's own contract.
 */
function moveSelectionByKey(event: KeyboardEvent<HTMLElement>, current: HTMLElement) {
  const row = current.closest('.vv-tabs-row') ?? current.closest('[role="tablist"]');
  if (!row) return;

  const stops = Array.from(row.querySelectorAll<HTMLElement>('[role="tab"], [aria-haspopup="menu"]'));
  const currentIndex = stops.indexOf(current);
  let nextIndex: number;

  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % stops.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + stops.length) % stops.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = stops.length - 1;
  else return;

  event.preventDefault();
  const next = stops[nextIndex];
  next?.focus();
  if (next?.getAttribute('role') === 'tab') next.click();
}

/** A tab's face — the glyph or the word, and its count — drawn by the live tab and by the ghost. */
function TabFace({ tab }: { tab: TabItem }) {
  const hasCount = typeof tab.count === 'number' && tab.count > 0;

  return (
    <>
      {tab.icon ? (
        // The glyph carries the dot, not the tab: once the strip spreads its tabs to share the
        // row, a dot anchored to the TAB's corner drifts as far from the icon as the slice is wide.
        <span className="vv-tabs__glyph">
          <tab.icon className="vv-tabs__icon" strokeWidth={2} />
          {hasCount && <span className="vv-tabs__dot" aria-hidden="true" />}
        </span>
      ) : tab.label}
      {/* A glyph has no room beside it for a number, so an icon tab marks a waiting count with a
        * single accent dot; a word tab still counts out loud in the pill. Both are decoration —
        * the tab's name is its aria-label either way. */}
      {hasCount && !tab.icon && (
        <span className="vv-tabs__count" data-tone="neutral" aria-hidden="true">
          {tab.count}
        </span>
      )}
    </>
  );
}

type TabsBaseProps = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** The accessible name for the strip — "Workspace", "Git view". A tablist needs one. */
  ariaLabel: string;
};

/**
 * `variant`: `segmented` is the filled pill row. `underline` is the flat form for chrome that
 * already has a surface of its own — the sidebar, where a second filled tray under the wordmark
 * would read as a card floating on a card.
 *
 * `equal`: every tab takes an equal share of the row, and a label too long for its share ends in
 * an ellipsis, with the full name kept as its title. For a strip with a fixed set of tabs whose
 * labels vary in length — the git tab's repositories — where sizing each tab by its label reads
 * as uneven and pushes the last one off a phone screen. Off by default.
 *
 * `overflowLabel`: the name of the More trigger, and the switch for the overflow capability —
 * a strip given one never scrolls and never wraps; the tabs its row has no room for collapse
 * behind that trigger (see the header). One caller today, measured: the workspace's two rows in
 * the sidebar. Every other underline strip sits in a scroller of its own and passes none. The
 * type admits it on `underline` alone and never with `equal`, because both opt-outs are
 * deliberate: an `equal` strip answers width by shrinking every tab, so nothing overflows it; a
 * `segmented` tray is a toggle between two or three views sized by its own content — every caller
 * passes two — and a More inside a toggle would hide one of the choices it exists to show side by
 * side.
 */
type TabsProps = TabsBaseProps & (
  | { variant: 'underline'; equal?: false; overflowLabel?: string }
  | { variant?: 'segmented' | 'underline'; equal?: boolean; overflowLabel?: never }
);

/**
 * The app's one tab strip, in two registers: a filled segmented tray (`segmented`, the default)
 * and a flat rule-and-underline row (`underline`).
 *
 * Used by the project-workspace module for the workspace's two rows under the wordmark —
 * `underline` with overflow, since they sit in the sidebar — by the git-panel module for the
 * git tab's repository strip (`underline` + `equal`) and each panel's own two views, by the
 * file-manager and document-preview modules for their view and sheet strips, and by the chat
 * module's tabbed code block. The same shape each time, so none hand-rolls it.
 *
 * The `underline` register slides ONE indicator between tabs; the `segmented` one still paints
 * its own background and moves nothing. The objection this file used to record — that an
 * indicator reads a stale width for a frame whenever a label changes — is answered rather than
 * avoided: the measurement runs in a layout effect (before paint, never a stale frame) and a
 * ResizeObserver on the strip re-runs it whenever a tab's box changes, which is exactly the
 * label-change case. Cross-fading each tab's own border was the alternative, and with a row of
 * icons it read as no animation at all: nothing moves, and there is no weight change to carry
 * it the way a word's does.
 *
 * A tab's optional `count` is a capability of the strip: a word tab draws Verve's own count
 * pill, an icon tab a single accent dot on the glyph's shoulder. The accessible name stays
 * the bare label regardless.
 *
 * Overflow is a capability of the strip in the same way, switched on by `overflowLabel`. When
 * the tabs' natural widths exceed the row the caller gave, the trailing tabs collapse into ONE
 * More trigger at the row's end — a tab-shaped glyph that opens the kit's Menu, listing the
 * collapsed tabs by their words with their counts; a collapsed tab that carries a count puts the
 * same dot on the trigger. The ACTIVE tab is never collapsed: selected from the menu, it takes
 * the row's last slot and that slot's tab collapses instead. The widths are read off an invisible
 * ghost row, so the row never scrolls, never wraps and never shows a clipped tab — the measuring
 * lives in useTabsOverflow.ts, the trigger in TabsMore.tsx. The trigger sits beside the tablist rather than in it, since a
 * tablist owns tabs and a menu button is not one.
 */
export function Tabs({ tabs, active, onChange, ariaLabel, variant = 'segmented', equal = false, overflowLabel }: TabsProps) {
  const isUnderline = variant === 'underline';
  const overflows = isUnderline && !equal && overflowLabel !== undefined;
  const { rowRef, ghostRef, shown, collapsed } = useTabsOverflow(tabs, active, overflows);

  // Which tab holds the strip's single Tab stop. It falls back to the FIRST tab when `active`
  // names no tab in the list, because `tab.id === active` alone would then give the strip zero
  // stops and put it out of reach of the keyboard entirely — worse than no roving at all. That
  // is a reachable state, not a hypothetical: a plugin tab can be removed while it is selected,
  // Phase 4 adds preferences that hide a tab a persisted `activeTab` may still name, and the
  // workspace draws two rows of which only one ever holds the selection.
  const activeIndex = shown.findIndex((tab) => tab.id === active);
  const stopIndex = activeIndex === -1 ? 0 : activeIndex;
  // The indicator's measurement re-runs when the row's membership changes, not only its list.
  const shownKey = shown.map((tab) => tab.id).join('\n');

  const listRef = useRef<HTMLDivElement | null>(null);
  // Null until the first measurement, and the indicator is not drawn until then — a bar that
  // starts at 0 and slides into place on mount would animate a choice nobody made.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const selected = list.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    if (!selected) {
      setIndicator(null);
      return;
    }

    // `offsetLeft` against the strip, not a viewport rect: a strip inside a caller's horizontal
    // scroller would jump by the scroll offset the moment it scrolled.
    setIndicator({ left: selected.offsetLeft, width: selected.offsetWidth });
  }, []);

  useLayoutEffect(() => {
    if (!isUnderline) return undefined;

    measure();

    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;

    // Every tab, not just the strip: a label that grows changes ITS box, and the strip's own
    // width may not move at all when the row has room to absorb it.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab);
    return () => observer.disconnect();
  }, [isUnderline, measure, active, tabs, shownKey]);

  const strip = (
    <div
      ref={listRef}
      className={cn('vv-tabs inline-flex items-center', isUnderline && 'vv-tabs--underline', equal && 'vv-tabs--equal')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {isUnderline && indicator && (
        <span
          className="vv-tabs__indicator"
          aria-hidden="true"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}
      {shown.map((tab, index) => {
        const hasCount = typeof tab.count === 'number' && tab.count > 0;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={cn('vv-tabs__tab', tab.icon && 'vv-tabs__tab--icon')}
            // The label again as the accessible name. It duplicates the button's own text on
            // purpose: `aria-label` is the attribute the workspace strip has always carried and
            // the one the verification harness selects a tab by, so a tab that dropped it would
            // still LOOK right and be unreachable to everything that addresses tabs by name.
            aria-label={tab.label}
            aria-selected={tab.id === active}
            // The native title, not the Tooltip primitive: Tooltip wraps its child in a div, and
            // a div between `role="tablist"` and `role="tab"` breaks the relationship a screen
            // reader announces the strip by. An icon-only tab still has to be nameable on hover,
            // and it carries the count in words there, since the dot says only THAT something
            // waits and never how much. An equal-share tab carries its label there too, since its
            // share of the row may have cut the word short.
            title={tab.icon ? (hasCount ? `${tab.label} (${tab.count})` : tab.label) : equal ? tab.label : undefined}
            // Roving: exactly one tab is a Tab stop, and the arrows walk the rest.
            tabIndex={index === stopIndex ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => moveSelectionByKey(event, event.currentTarget)}
          >
            <TabFace tab={tab} />
          </button>
        );
      })}
    </div>
  );

  if (!overflows) return strip;

  return (
    <div
      ref={rowRef}
      className="vv-tabs-row"
      // The trigger's arrows. Menu draws its own button, so its keys are read here as they bubble
      // — and only while it is closed: an open panel is the Menu's to drive.
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches('[aria-haspopup="menu"][aria-expanded="false"]')) moveSelectionByKey(event, target);
      }}
    >
      {strip}
      {collapsed.length > 0 && <TabsMore label={overflowLabel} tabs={collapsed} onSelect={onChange} />}
      {/* Every tab once, at its natural width, plus the trigger — what the plan is measured
        * against. Invisible, out of the flow, and clipped to the row so it never widens a scroller
        * the strip happens to sit in. */}
      <div ref={ghostRef} className="vv-tabs--underline vv-tabs__ghost" aria-hidden="true">
        {tabs.map((tab) => (
          <span key={tab.id} className={cn('vv-tabs__tab', tab.icon && 'vv-tabs__tab--icon')}>
            <TabFace tab={tab} />
          </span>
        ))}
        <MoreFace waiting={false} />
      </div>
    </div>
  );
}
