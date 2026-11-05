import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { resizeObserverIn } from '@/shared/utils';

/** Her panel's fold round the card: the element holding the rows the fold's clip holds, and whether it is folded. */
type CardFold = { bodyRef: RefObject<HTMLElement | null>; folded: boolean };

/** A computed length in px; a value that reads as no number counts as nothing. */
const px = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Where the last in-flow row of `parent` ends, from `from` down; a row out of the flow (the field's `sr-only` label) is
 * skipped. A row that holds the fold's `body` — the kit's `CardFoldBody`, whose height is the fold's motion, 200ms of it at
 * every press — is read through to the rows it holds, which are laid out whole the whole time (overflowing the clip while it
 * opens), with the padding under them and the clip's own margin.
 */
function lastRowBottom(view: Window, parent: Element, from: number, body: HTMLElement | null): number {
  let last = from;
  for (const row of Array.from(parent.children)) {
    const position = view.getComputedStyle(row).position;
    if (position === 'absolute' || position === 'fixed') continue;
    const bottom = body !== null && row.contains(body)
      ? lastRowBottom(view, body, body.getBoundingClientRect().top, null)
        + px(view.getComputedStyle(body).paddingBottom) + px(view.getComputedStyle(row).marginBottom)
      : row.getBoundingClientRect().bottom;
    last = Math.max(last, bottom);
  }
  return last;
}

/**
 * Whether the fold's clip round `body` is in motion now: its grid rows' transition running, read off the clip itself
 * (`getAnimations` brings the style up to date first, so the render that turned the fold already finds its motion).
 */
function clipMoving(card: HTMLElement, body: HTMLElement | null): boolean {
  const clip = body === null ? undefined : Array.from(card.children).find((row) => row.contains(body));
  return clip !== undefined && clip.getAnimations().some((motion) => (
    'transitionProperty' in motion && motion.transitionProperty === 'grid-template-rows' && motion.playState === 'running'));
}

/**
 * The card's floor, from its rows: the bottom of its last in-flow row less its own top (its top border and padding and
 * every row with its gaps), plus its bottom padding and border, with the field counted at its own min-height (the kit's 88px;
 * in the dock's head line the field's box, at nothing) instead of its height. The rows' boxes are laid out the same whether
 * or not the dock squeezes the card, so the floor
 * is the same either way — a floor read from `scrollHeight` lost the bottom padding whenever the card overflowed.
 */
function writeFloor(card: HTMLElement, field: HTMLElement, body: HTMLElement | null) {
  const view = card.ownerDocument.defaultView;
  if (!view) return;
  const cardBox = card.getBoundingClientRect();
  const lastBottom = lastRowBottom(view, card, cardBox.top, body);
  const cardStyle = view.getComputedStyle(card);
  const foot = px(cardStyle.paddingBottom) + px(cardStyle.borderBottomWidth);
  const fieldFloor = px(view.getComputedStyle(field).minHeight);
  card.style.minHeight = `${Math.ceil(lastBottom - cardBox.top + foot - field.offsetHeight + fieldFloor)}px`;
}

/**
 * The folded card's floor: its rows but the fold's clip (its line, and a refusal under it), summed by their heights and
 * margins, with its padding and border. Summed and not read off their places: the clip's motion moves the rows under it
 * for 200ms, but sizes none of them, so the floor is the folded card's from the press on.
 */
function writeFoldedFloor(card: HTMLElement, body: HTMLElement | null) {
  const view = card.ownerDocument.defaultView;
  if (!view) return;
  let rows = 0;
  for (const row of Array.from(card.children)) {
    const style = view.getComputedStyle(row);
    if (style.position === 'absolute' || style.position === 'fixed' || (body !== null && row.contains(body))) continue;
    rows += row.getBoundingClientRect().height + px(style.marginTop) + px(style.marginBottom);
  }
  const cardStyle = view.getComputedStyle(card);
  const chrome = px(cardStyle.borderTopWidth) + px(cardStyle.paddingTop) + px(cardStyle.paddingBottom) + px(cardStyle.borderBottomWidth);
  card.style.minHeight = `${Math.ceil(chrome + rows)}px`;
}

/**
 * Holds a draft card at its own floor: all of it but the field (the target, a notice, the sends, a refusal), plus the
 * field's own floor: the TextArea's 88px, or nothing for the box the dock's head line clips it in (`fieldRef` is then that
 * box). Explicit, because the card shrinks with the dock (its automatic minimum would count the field's
 * whole basis) yet must never fold over its own sends: below this floor the dock scrolls the card whole instead.
 *
 * GIVEN HER PANEL'S `fold`, the floor is read through the fold's clip to the rows in it, so it is the same in the middle of
 * the clip's motion as at its end; folded, it is the folded card's own (`writeFoldedFloor`: its line, and a refusal
 * under it), written at the press, so her panel's floor (`useCompanionPanelPlace`, which reads it) drops with the fold at
 * once instead of counting the card at the height it is about to leave. AN OPENING'S floor waits while the clip moves and is
 * written at its `transitionend` (an event), which her panel then reads again: held at once, the card's frame stood at its
 * floor around a clip still opening, an empty band under the rows for the motion's 200ms.
 *
 * MEASURED ON BOTH EVENTS THAT MOVE IT: every render (a notice or a refusal came or went, the field changed, the fold
 * turned), and a change of the card's width without one (a phone turned, a window crossing lg), where the notice, the sends
 * row and the refusal wrap to another line count. The width is a ResizeObserver on the card (an event, never a poll) that
 * acts only when the width moved, a frame later, so writing the floor never re-enters the observer. Nothing is measured
 * while the panel is not drawn.
 *
 * Used by this module's CompanionDraftCard.
 */
export function useCardFloor(
  cardRef: RefObject<HTMLElement | null>,
  fieldRef: RefObject<HTMLElement | null>,
  drawn: boolean,
  fold?: CardFold,
) {
  const hostWindow = useHostWindow();
  const bodyRef = fold?.bodyRef;
  const folded = fold?.folded ?? false;

  // Every render: the rows it measures are what a render changes.
  useLayoutEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    const body = bodyRef?.current ?? null;
    if (!card || !field || !drawn) return;
    if (folded) writeFoldedFloor(card, body);
    else if (!clipMoving(card, body)) writeFloor(card, field, body);
  });

  useEffect(() => {
    const card = cardRef.current;
    const field = fieldRef.current;
    if (!card || !field || !drawn) return undefined;
    const write = () => (folded ? writeFoldedFloor(card, bodyRef?.current ?? null) : writeFloor(card, field, bodyRef?.current ?? null));
    let width = card.offsetWidth;
    let frame = 0;
    const observer = resizeObserverIn(hostWindow, () => {
      if (card.offsetWidth === width) return;
      width = card.offsetWidth;
      hostWindow.cancelAnimationFrame(frame);
      frame = hostWindow.requestAnimationFrame(write);
    });
    observer?.observe(card);
    // Given a fold, the clip done growing: the floor is written once it stands open. The event bubbles up from the clip;
    // the chevron's turn and the buttons' colours end transitions of their own, which are not the clip's.
    const settled = (event: TransitionEvent) => {
      const clip = event.target as Element;
      if (event.propertyName === 'grid-template-rows' && clip.getAttribute('data-state') === 'open') writeFloor(card, field, bodyRef?.current ?? null);
    };
    if (bodyRef) card.addEventListener('transitionend', settled);
    return () => {
      observer?.disconnect();
      hostWindow.cancelAnimationFrame(frame);
      card.removeEventListener('transitionend', settled);
    };
  }, [cardRef, fieldRef, drawn, folded, bodyRef, hostWindow]);
}
