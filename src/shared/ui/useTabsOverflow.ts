import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { TabItem } from '@/shared/ui/Tabs';

/**
 * The strip's overflow measurement and the plan it feeds, split out of Tabs.tsx so the strip stays
 * one readable file. Tabs.tsx is the only importer, and it draws the ghost row these widths are
 * read off; the More trigger that holds what the plan leaves out is TabsMore.tsx.
 */

/** Every width the plan needs, read off the ghost row and the row itself, in CSS pixels. */
type Measured = { widths: number[]; more: number; gap: number; room: number };

/**
 * Tab boxes measure in fractions of a pixel, and a row that fits by 0.2px must not lose its last
 * tab to rounding — nor keep one that misses by half a pixel.
 */
const SLACK_PX = 0.5;

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

const sameMeasure = (a: Measured, b: Measured) =>
  a.more === b.more && a.gap === b.gap && a.room === b.room
  && a.widths.length === b.widths.length && a.widths.every((width, index) => width === b.widths[index]);

/**
 * Which tabs the row draws, as indexes in order. Every one of them while they all fit; otherwise
 * the longest leading run that fits beside the trigger. The active tab is never behind the menu:
 * when it falls past that run it takes the run's last slot, and the tab that held the slot is the
 * one collapsed instead — so choosing a tab from the menu is always choosing a tab you can see.
 */
function planShown({ widths, more, gap, room }: Measured, activeIndex: number): number[] {
  const every = widths.map((_, index) => index);
  if (total(widths) + gap * (widths.length - 1) <= room + SLACK_PX) return every;

  const pick = (slots: number) =>
    activeIndex < slots ? every.slice(0, slots) : [...every.slice(0, slots - 1), activeIndex];
  for (let slots = widths.length - 1; slots > 1; slots -= 1) {
    const shown = pick(slots);
    // `slots` gaps: one between each pair of shown tabs, and one before the trigger.
    if (total(shown.map((index) => widths[index])) + gap * slots + more <= room + SLACK_PX) return shown;
  }
  // A row too narrow for even two: the active tab and the trigger, overflowing if they must.
  return pick(1);
}

/**
 * Splits `tabs` into the ones the row draws and the ones the More menu holds. `enabled` false
 * leaves every tab drawn and measures nothing, which is every strip that passes no overflow
 * label.
 *
 * The widths come off a GHOST row — every tab drawn once, invisible and out of the flow — and
 * never off the live tabs: a live tab has been stretched to share the row, and a collapsed one is
 * not drawn at all. That is also why this cannot oscillate: the plan reads the ghost and the
 * row's own width, and neither moves when the plan changes what the row draws.
 */
export function useTabsOverflow(tabs: TabItem[], active: string, enabled: boolean) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // The widths the plan is computed from. State rather than a ref because a change in them has to
  // redraw the row. Null until the first reading, and the row draws every tab while it is — that
  // reading lands in a layout effect, before the first paint, so nobody ever sees that frame.
  const [measured, setMeasured] = useState<Measured | null>(null);

  const measure = useCallback(() => {
    const row = rowRef.current;
    const ghost = ghostRef.current;
    if (!row || !ghost) return;

    const room = row.getBoundingClientRect().width;
    // A row with no width is a row not laid out (a closed drawer's display:none), not a row with
    // no room: a plan made from it would collapse every tab the moment it opened.
    if (room === 0) return;

    const widths = Array.from(ghost.children, (child) => child.getBoundingClientRect().width);
    const more = widths.pop() ?? 0; // the ghost's last child is the trigger's own face
    const gap = Number.parseFloat(getComputedStyle(ghost).columnGap) || 0;
    const next = { widths, more, gap, room };
    setMeasured((previous) => (previous && sameMeasure(previous, next) ? previous : next));
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return undefined;

    measure();

    const row = rowRef.current;
    const ghost = ghostRef.current;
    if (!row || !ghost || typeof ResizeObserver === 'undefined') return undefined;

    // The row for the room it is given; each ghost tab for a label that grows — a webfont landing
    // widens every word tab without moving the row by a pixel.
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of ghost.children) observer.observe(child);
    return () => observer.disconnect();
  }, [enabled, measure, tabs]);

  // A reading taken against a different tab list is no reading: it is replaced before paint.
  const plan = enabled && measured && measured.widths.length === tabs.length
    ? planShown(measured, tabs.findIndex((tab) => tab.id === active))
    : null;
  const shownIndexes = new Set(plan ?? []);

  return {
    rowRef,
    ghostRef,
    shown: plan ? plan.map((index) => tabs[index]) : tabs,
    collapsed: plan ? tabs.filter((_, index) => !shownIndexes.has(index)) : [],
  };
}
