import { useSyncExternalStore } from 'react';

/** The browser's own claim that a mouse, a trackpad or a pen is attached. Made once: `matchMedia` hands back a live object, so every subscriber and every read shares it. */
const attached = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: fine)') : null;

/** Set by the first mouse or pen event this page hears, and never cleared: a hand put down and picked up again does not move her panel back and forth. */
let seen = false;

/** The `pointerType` of the latest press this page heard, `mouse`, `pen` or `touch`; null before any press. Read as her panel opens. */
let lastPress: string | null = null;

/** The subscribed renders of `useFinePointer`, told once, when the first mouse or pen event latches `seen`. */
const listeners = new Set<() => void>();

/** One capture-phase listener on the window for the life of the page: every press says what it was made with. */
function notePress(event: PointerEvent): void {
  lastPress = event.pointerType;
}

/** One capture-phase listener on the window until the first fine event; touch events pass it by. */
function noteFinePointer(event: PointerEvent): void {
  if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
  seen = true;
  window.removeEventListener('pointerdown', noteFinePointer, true);
  window.removeEventListener('pointermove', noteFinePointer, true);
  for (const listener of listeners) listener();
}

// Listening from the page's first moment, not from the first render that asks: a mouse moved before her panel is first drawn counts.
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', notePress, { capture: true, passive: true });
  window.addEventListener('pointerdown', noteFinePointer, { capture: true, passive: true });
  window.addEventListener('pointermove', noteFinePointer, { capture: true, passive: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  attached?.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    attached?.removeEventListener('change', listener);
  };
}

const readFinePointer = () => seen || attached?.matches === true;

/**
 * Used by this module's `useCompanionPanelPlace` (her panel floats, and so moves and resizes, only where a mouse or a pen can
 * place it) and `CompanionTalkButton` (the station's line "or press Mouse middle" is drawn only where a key or a mouse can press
 * it): whether a mouse, a trackpad or a pen drives this page, now and when that changes. True when the browser says one is
 * attached (`any-pointer: fine`), or once the page has heard one (a pointer event of type `mouse` or `pen`).
 *
 * WHY THE EVENT AND NOT THE QUERY ALONE. A pointer media query answers how the browser CLASSIFIES the device, and the
 * classification can be wrong about what is in his hand. Chromium on Windows names a touchscreen computer that Windows reports
 * as used as a tablet (touch screen, keyboard detached or folded back) a coarse pointer with no hover, and never asks whether a
 * mouse is attached (`IsDeviceUsedAsATablet` in `pointer_device_win.cc`); and every desktop Chromium names the primary pointer
 * fine whenever a fine one is available (`GetPrimaryPointerType`), so a browser that says `pointer: coarse` says
 * `any-pointer: fine` false too. The mouse on that machine works all the same: its moves and presses arrive as pointer events
 * of type `mouse`. The event is the answer a classification cannot get wrong, so it latches true for the life of the page.
 * A touch screen with no mouse never latches it, and a phone's page never hears one: both keep what a finger is given.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, readFinePointer, () => false);
}

/**
 * Used by this module's CompanionPanel, as she opens: whether her typing box may take the focus. It may where a mouse or a pen
 * drives the page and the press the page last heard was not a finger's: a finger's press raises the keyboard, and a page that has
 * heard a mouse is not a page that is only ever touched (a touchscreen computer, an iPad with a trackpad). A phone's page has
 * heard neither, so it never takes the focus. Read once, as she opens; it is not a state the render follows.
 */
export function mayFocusFieldOnOpen(): boolean {
  return readFinePointer() && lastPress !== 'touch';
}
