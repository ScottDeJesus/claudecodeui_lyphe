import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** The property her column's budget reads for the dock's basis (`SLOT_BOX` in StationShell.tsx). This hook is its one writer. */
const FLOOR_PROPERTY = '--station-dock-floor';

/** A computed length in px; a value that reads as nothing is 0. */
const px = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Writes the dock's floor onto its slot: the card's own floor, as `useCardFloor` measures it into the card's `min-height` (its
 * target, a notice, the sends, a refusal, and the field's 88 px), with the dock's padding and the slot's hairline. Removed while
 * the dock holds no card, so her column's budget stands on its 14.25rem until there is one.
 */
function writeFloor(section: HTMLElement) {
  const slot = section.parentElement;
  if (slot === null) return;
  const card = section.querySelector<HTMLElement>('[data-companion-draft]');
  const floor = card === null ? Number.NaN : Number.parseFloat(card.style.minHeight);
  const view = section.ownerDocument.defaultView;
  if (!Number.isFinite(floor) || !view) {
    slot.style.removeProperty(FLOOR_PROPERTY);
    return;
  }
  const own = view.getComputedStyle(section);
  const around = view.getComputedStyle(slot);
  const chrome = px(own.paddingTop) + px(own.paddingBottom) + px(around.borderTopWidth) + px(around.borderBottomWidth);
  slot.style.setProperty(FLOOR_PROPERTY, `${Math.ceil(floor + chrome)}px`);
}

/**
 * HANDS THE CARD'S FLOOR TO HER COLUMN'S BUDGET. The shell sizes the dock's slot (`SLOT_BOX`): its basis is the card at its floor,
 * and her conversation gives way to it, from its share down to its own floor, before the dock goes below it and scrolls. That
 * floor is the card's to measure — a refused send's sentence or her rewrite's notice under his edit adds lines to it — so it is
 * read off the card and written to the slot as `--station-dock-floor`, the one property the shell's dock box reads. Without it
 * the box stood on its 14.25rem guess, and a refused send's sentence scrolled out of the dock while her conversation kept its
 * share.
 *
 * WRITTEN ON THE ONE EVENT THAT MOVES IT: `useCardFloor` writes the card's `min-height` on every render and on a width change, so a
 * `MutationObserver` on the card's `style` hears each new floor and the property is written again — no poll, no timer. Written
 * as the card appears, before paint (the card's own layout effect has written its floor by then), and removed as it goes.
 *
 * Used by this module's StationDockView.
 */
export function useDockFloor(sectionRef: RefObject<HTMLElement | null>, carded: boolean) {
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (section === null) return undefined;
    writeFloor(section);
    const card = section.querySelector('[data-companion-draft]');
    const Observer = section.ownerDocument.defaultView?.MutationObserver;
    const watcher = card === null || Observer === undefined ? null : new Observer(() => writeFloor(section));
    if (card !== null) watcher?.observe(card, { attributes: true, attributeFilter: ['style'] });
    return () => {
      watcher?.disconnect();
      section.parentElement?.style.removeProperty(FLOOR_PROPERTY);
    };
  }, [sectionRef, carded]);
}
