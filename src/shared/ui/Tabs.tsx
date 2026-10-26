import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { Tone } from '@/shared/types';
import { cn, resizeObserverIn } from '@/shared/utils';

/**
 * `count` is a capability of the strip, not a prop every caller needs: a measured site
 * (doctrine §8) decides it exists. Three callers today — the Inbox's section strip, the Roadmap
 * tab's In flight face and the Affected Areas face strip; the other strips pass none.
 *
 * `attention` is the SECOND capability of the same kind, and it is a sentence rather than a
 * number: what is waiting on the tab, in the operator's own words — the Roadmap tab's
 * "`3 waiting for you`". While it is set the count pill is drawn in the warn register and the
 * title reads `<label> (<count>) · <attention>`, so a mark that is only a colour is never the
 * whole signal (doctrine §6). A tab without one is drawn exactly as it was.
 *
 * `tone` is the pill's register when nothing waits on the operator — the state of what is counted:
 * the Inbox's section counts wear `warn`, the face strip's wear `info`. Attention outranks it. A
 * tab without one wears the neutral grey of a routine count.
 */
export type TabItem = {
  id: string;
  label: string;
  count?: number;
  /** What waits on this tab, said in words — drawn on hover, and the reason its pill turns amber. */
  attention?: string;
  /** The pill's register while nothing waits on the operator; `attention` outranks it. */
  tone?: Tone;
};

/**
 * A tab's hover title. A tab carrying attention titles itself `<label> (<count>) · <attention>`:
 * the amber is a colour and the sentence is the point, so the sentence travels with the count in
 * words.
 *
 * A tab without attention draws its own label and needs no title for it, except an `equal`-share
 * tab, which keeps the full label there since its slice of the row may have cut the word short.
 * `undefined` is what leaves the attribute off entirely rather than drawing an empty tooltip.
 */
function tabTitle(tab: TabItem, hasCount: boolean, equal: boolean): string | undefined {
  if (tab.attention !== undefined) {
    const withCount = hasCount ? `${tab.label} (${tab.count})` : tab.label;
    return `${withCount} · ${tab.attention}`;
  }
  return equal ? tab.label : undefined;
}

/**
 * Arrow / Home / End move the selection, which is the contract `role="tablist"` announces.
 *
 * A `Tabs` without it would announce "tab, 1 of 3" and then do nothing when the reader presses
 * ArrowRight — a regression dressed as a restyle. Focus and click move together, so the selection
 * follows focus.
 */
function moveSelectionByKey(event: KeyboardEvent<HTMLElement>, current: HTMLElement) {
  const list = current.closest('[role="tablist"]');
  if (!list) return;

  const stops = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
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
  next?.click();
}

/** The register a tab's pill wears: amber while it carries attention, else its own `tone`, else the neutral grey. */
function markTone(tab: TabItem): Tone | undefined {
  return tab.attention !== undefined ? 'warn' : tab.tone;
}

/** A tab's face — its word, and its count pill while there is a count to say. */
function TabFace({ tab }: { tab: TabItem }) {
  const hasCount = typeof tab.count === 'number' && tab.count > 0;

  return (
    <>
      {tab.label}
      {/* Decoration: the tab's name is its aria-label, and the count reaches readers in the title
        * while attention is set. The register only colours the pill — whether one is drawn is the
        * count alone, so a tab with nothing to count draws none whatever its attention says. */}
      {hasCount && (
        <span className="vv-tabs__count" data-tone={markTone(tab) ?? 'neutral'} aria-hidden="true">
          {tab.count}
        </span>
      )}
    </>
  );
}

/**
 * `variant`: `segmented` is the filled pill row. `underline` is the flat form for chrome that
 * already has a surface of its own, where a second filled tray would read as a card floating on
 * a card.
 *
 * `equal`: every tab takes an equal share of the row, and a label too long for its share ends in
 * an ellipsis, with the full name kept as its title. For a strip with a fixed set of tabs whose
 * labels vary in length — the git tab's repositories — where sizing each tab by its label reads
 * as uneven and pushes the last one off a phone screen. Off by default.
 */
type TabsProps = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** The accessible name for the strip — "Git view", "Inbox sections". A tablist needs one. */
  ariaLabel: string;
  variant?: 'segmented' | 'underline';
  equal?: boolean;
};

/**
 * The app's one tab strip: one `role="tablist"` in two registers — a filled segmented tray
 * (`segmented`, the default) and a flat rule-and-underline row (`underline`). Every tab is a word,
 * and a word tab may carry a count, an attention sentence and a tone (see `TabItem`).
 *
 * Used by the git-panel module for the
 * git tab's repository strip (`underline` + `equal`) and each panel's own two views, by the
 * file-manager and document-preview modules for their view and sheet strips, by the api-tab module
 * for its sub-views, by the roadmap module for its two faces, by the inbox module for its Memory ·
 * Heal · Roadmap sections, by the affected-areas module for its face strip, by the cerberus module
 * for its tab's Fleet · History strip (`CerberusPanel`) and Fleet's Grid · List · Rings
 * (`FleetToolbar`), and by the chat module's tabbed code block. The same shape each time, so none
 * hand-rolls it.
 *
 * The `underline` register slides ONE indicator between tabs; the `segmented` one paints its own
 * background and moves nothing. The indicator's measurement runs in a layout effect (before
 * paint, never a stale frame) and a ResizeObserver on the strip re-runs it whenever a tab's box
 * changes, which is exactly the case of a label changing.
 */
export function Tabs({ tabs, active, onChange, ariaLabel, variant = 'segmented', equal = false }: TabsProps) {
  const hostWindow = useHostWindow();
  const isUnderline = variant === 'underline';

  // Which tab holds the strip's single Tab stop. It falls back to the FIRST tab when `active`
  // names no tab in the list, because `tab.id === active` alone would then give the strip zero
  // stops and put it out of reach of the keyboard entirely — worse than no roving at all. That
  // is a reachable state, not a hypothetical: the Inbox's strip is handed no section at all until
  // the readings its entry rule rests on have landed.
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  const stopIndex = activeIndex === -1 ? 0 : activeIndex;

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
    if (!list) return undefined;

    // Every tab, not just the strip: a label that grows changes ITS box, and the strip's own
    // width may not move at all when the row has room to absorb it. Built by the host window's own
    // constructor: a strip in the transcript's tabbed code is drawn in the floating window too.
    const observer = resizeObserverIn(hostWindow, measure);
    if (!observer) return undefined;
    observer.observe(list);
    for (const tab of list.querySelectorAll('[role="tab"]')) observer.observe(tab);
    return () => observer.disconnect();
  }, [isUnderline, measure, active, tabs, hostWindow]);

  return (
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
      {tabs.map((tab, index) => {
        const hasCount = typeof tab.count === 'number' && tab.count > 0;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="vv-tabs__tab"
            // The label again as the accessible name. It duplicates the button's own text on
            // purpose: `aria-label` is the attribute the verification harness selects a tab by,
            // so a tab that dropped it would still LOOK right and be unreachable to everything
            // that addresses tabs by name.
            aria-label={tab.label}
            aria-selected={tab.id === active}
            // The native title, not the Tooltip primitive: Tooltip wraps its child in a div, and
            // a div between `role="tablist"` and `role="tab"` breaks the relationship a screen
            // reader announces the strip by. It carries the attention, word for word, because a
            // mark that is only a colour says nothing at all to a reader who cannot see it; an
            // equal-share tab carries its label there too, since its share of the row may have
            // cut the word short.
            title={tabTitle(tab, hasCount, equal)}
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
}
