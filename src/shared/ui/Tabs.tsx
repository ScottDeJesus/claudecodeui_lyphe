import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent } from 'react';

import { cn } from '@/shared/utils';

/**
 * `count` is a capability of the strip, not a prop every caller needs: a measured site
 * (doctrine §8) decides it exists. One caller today — the workspace strip's Memory tab
 * (Phase 5); the git panel's two tabs pass none.
 *
 * A tab with an `icon` draws the glyph ALONE and keeps `label` as its accessible name and
 * hover title — the workspace strip's built-in tabs, where seven words never fit a 288px
 * sidebar without a scroller. A tab without one draws its label, unchanged.
 */
type TabItem = {
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
 */
function moveSelectionByKey(event: KeyboardEvent<HTMLButtonElement>) {
  const tabList = event.currentTarget.closest('[role="tablist"]');
  if (!tabList) return;

  const tabButtons = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const currentIndex = tabButtons.indexOf(event.currentTarget);
  let nextIndex: number;

  if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
  else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = tabButtons.length - 1;
  else return;

  event.preventDefault();
  tabButtons[nextIndex]?.focus();
  tabButtons[nextIndex]?.click();
}

type TabsProps = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** The accessible name for the strip — "Workspace", "Git view". A tablist needs one. */
  ariaLabel: string;
  /**
   * `segmented` is the filled pill row. `underline` is the flat form for chrome that already
   * has a surface of its own — the sidebar, where a second filled tray under the wordmark
   * would read as a card floating on a card.
   */
  variant?: 'segmented' | 'underline';
};

/**
 * The app's one tab strip, in two registers: a filled segmented tray (`segmented`, the default)
 * and a flat rule-and-underline row (`underline`).
 *
 * Used by the project-workspace module for the Chat / Files / Git strip — `underline`, since it
 * sits in the sidebar under the wordmark — and by the git-panel module for its own two views.
 * The same shape twice, so neither hand-rolls it.
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
 */
export function Tabs({ tabs, active, onChange, ariaLabel, variant = 'segmented' }: TabsProps) {
  // Which tab holds the strip's single Tab stop. It falls back to the FIRST tab when `active`
  // names no tab in the list, because `tab.id === active` alone would then give the strip zero
  // stops and put it out of reach of the keyboard entirely — worse than no roving at all. That
  // is a reachable state, not a hypothetical: a plugin tab can be removed while it is selected,
  // and Phase 4 adds preferences that hide a tab a persisted `activeTab` may still name.
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const stopIndex = activeIndex === -1 ? 0 : activeIndex;

  const listRef = useRef<HTMLDivElement | null>(null);
  // Null until the first measurement, and the indicator is not drawn until then — a bar that
  // starts at 0 and slides into place on mount would animate a choice nobody made.
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const isUnderline = variant === 'underline';

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const selected = list.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    if (!selected) {
      setIndicator(null);
      return;
    }

    // `offsetLeft` against the strip, not a viewport rect: the strip lives in a horizontal
    // scroller, and a rect-based left would jump by the scroll offset the moment it scrolled.
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
  }, [isUnderline, measure, active, tabs]);

  return (
    <div
      ref={listRef}
      className={cn('vv-tabs inline-flex items-center', isUnderline && 'vv-tabs--underline')}
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
      {tabs.map((tab, index) => {
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
            // waits and never how much.
            title={tab.icon ? (hasCount ? `${tab.label} (${tab.count})` : tab.label) : undefined}
            // Roving: exactly one tab is a Tab stop, and the arrows walk the rest.
            tabIndex={index === stopIndex ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={moveSelectionByKey}
          >
            {tab.icon ? (
              // The glyph carries the dot, not the tab: once the strip spreads its tabs to
              // share the row, a dot anchored to the TAB's corner drifts as far from the icon
              // as the slice is wide.
              <span className="vv-tabs__glyph">
                <tab.icon className="vv-tabs__icon" strokeWidth={2} />
                {hasCount && <span className="vv-tabs__dot" aria-hidden="true" />}
              </span>
            ) : tab.label}
            {/* A glyph has no room beside it for a number, so an icon tab marks a waiting count
              * with a single accent dot; a word tab still counts out loud in the pill. Both are
              * decoration — the tab's name is its aria-label either way. */}
            {hasCount && !tab.icon && (
              <span className="vv-tabs__count" data-tone="neutral" aria-hidden="true">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
