import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/**
 * The card's floor, from its rows: the bottom of its last in-flow row less its own top (its top border and padding and
 * every row with its gaps), plus its bottom padding and border, with the field counted at its own min-height (88px)
 * instead of its height. The rows' boxes are laid out the same whether or not the dock squeezes the card, so the floor
 * is the same either way — a floor read from `scrollHeight` lost the bottom padding whenever the card overflowed. A row
 * out of the flow (the field's `sr-only` label) is skipped.
 */
function writeFloor(card: HTMLElement, field: HTMLTextAreaElement) {
  const view = card.ownerDocument.defaultView;
  if (!view) return;
  const cardBox = card.getBoundingClientRect();
  let lastBottom = cardBox.top;
  for (const row of Array.from(card.children)) {
    const position = view.getComputedStyle(row).position;
    if (position === 'absolute' || position === 'fixed') continue;
    lastBottom = Math.max(lastBottom, row.getBoundingClientRect().bottom);
  }
  const cardStyle = view.getComputedStyle(card);
  const foot = Number.parseFloat(cardStyle.paddingBottom) + Number.parseFloat(cardStyle.borderBottomWidth);
  const fieldFloor = Number.parseFloat(view.getComputedStyle(field).minHeight) || 0;
  card.style.minHeight = `${Math.ceil(lastBottom - cardBox.top + foot - field.offsetHeight + fieldFloor)}px`;
}

/**
 * Holds a draft card at its own floor: all of it but the field (the target, a notice, the sends, a refusal), plus the
 * field's 88px floor. Explicit, because the card shrinks with the dock (its automatic minimum would count the field's
 * whole basis) yet must never fold over its own sends: below this floor the dock scrolls the card whole instead.
 *
 * MEASURED ON BOTH EVENTS THAT MOVE IT: every render (a notice or a refusal came or went, the field changed), and a change
 * of the card's width without one (a phone turned, a window crossing lg), where the notice, the sends row and the refusal
 * wrap to another line count. The width is a ResizeObserver on the card (an event, never a poll) that acts only when the
 * width moved, a frame later, so writing the floor never re-enters the observer. Nothing is measured while the panel is
 * not drawn.
 *
 * Used by this module's CompanionDraftCard.
 */
export function useCardFloor(
  cardRef: RefObject<HTMLElement | null>,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  drawn: boolean,
) {
  const hostWindow = useHostWindow();

  // Every render: the rows it measures are what a render changes.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    if (card && field && drawn) writeFloor(card, field);
  });

  useEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    if (!card || !field || !drawn) return undefined;
    let width = card.offsetWidth;
    let frame = 0;
    const observer = resizeObserverIn(hostWindow, () => {
      if (card.offsetWidth === width) return;
      width = card.offsetWidth;
      hostWindow.cancelAnimationFrame(frame);
      frame = hostWindow.requestAnimationFrame(() => writeFloor(card, field));
    });
    observer?.observe(card);
    return () => {
      observer?.disconnect();
      hostWindow.cancelAnimationFrame(frame);
    };
  }, [cardRef, fieldRef, drawn, hostWindow]);
}
