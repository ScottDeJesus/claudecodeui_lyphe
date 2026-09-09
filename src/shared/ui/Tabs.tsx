import type { KeyboardEvent } from 'react';

import { cn } from '@/shared/utils';

/**
 * `count` is a capability of the strip, not a prop every caller needs: a measured site
 * (doctrine §8) decides it exists. One caller today — the workspace strip's Memory tab
 * (Phase 5); the git panel's two tabs pass none.
 */
type TabItem = { id: string; label: string; count?: number };

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
 * There is no sliding indicator. The active tab paints its own background, which means the
 * only animated properties are colours: nothing measures a box, and nothing moves. An
 * indicator that animates `left`/`width` also reads a stale width for a frame whenever a
 * label changes, which is precisely when a tab strip is being looked at.
 *
 * A tab's optional `count` is a capability of the strip, drawn as Verve's own count pill; the
 * accessible name stays the bare label regardless.
 */
export function Tabs({ tabs, active, onChange, ariaLabel, variant = 'segmented' }: TabsProps) {
  // Which tab holds the strip's single Tab stop. It falls back to the FIRST tab when `active`
  // names no tab in the list, because `tab.id === active` alone would then give the strip zero
  // stops and put it out of reach of the keyboard entirely — worse than no roving at all. That
  // is a reachable state, not a hypothetical: a plugin tab can be removed while it is selected,
  // and Phase 4 adds preferences that hide a tab a persisted `activeTab` may still name.
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const stopIndex = activeIndex === -1 ? 0 : activeIndex;

  return (
    <div
      className={cn('vv-tabs inline-flex items-center', variant === 'underline' && 'vv-tabs--underline')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="vv-tabs__tab"
          // The label again as the accessible name. It duplicates the button's own text on
          // purpose: `aria-label` is the attribute the workspace strip has always carried and
          // the one the verification harness selects a tab by, so a tab that dropped it would
          // still LOOK right and be unreachable to everything that addresses tabs by name.
          aria-label={tab.label}
          aria-selected={tab.id === active}
          // Roving: exactly one tab is a Tab stop, and the arrows walk the rest.
          tabIndex={index === stopIndex ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={moveSelectionByKey}
        >
          {tab.label}
          {typeof tab.count === 'number' && tab.count > 0 && (
            <span className="vv-tabs__count" data-tone="neutral" aria-hidden="true">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
