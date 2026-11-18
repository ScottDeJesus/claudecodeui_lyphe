import { useEffect } from 'react';

import { ESCAPE_LAYER_SELECTOR } from '@/shared/constants';
import { ESCAPE_PASSES_SELECTOR, WAY_BACK_SELECTOR } from '@/shared/ui/overlayEscape';

// Input types that hold no text. Escape on one of these (a focused checkbox or button) cancels nothing, so it is still the page's.
const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'];

// The fields a person types into, where Escape has its own meaning (cancel a rename, leave the terminal). A selector, read with
// `Element.matches`, never `instanceof HTMLInputElement`, so it holds for an element whichever window made it.
const TEXT_ENTRY_SELECTOR = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  `input${NON_TEXT_INPUT_TYPES.map((type) => `:not([type="${type}"])`).join('')}`,
].join(', ');

/** Whether a way back is on screen and can be pressed: not in a page held under another (inert, hidden), not folded away, not disabled. */
function canBePressed(back: HTMLElement): boolean {
  if (back.matches(':disabled') || back.closest('[inert]') !== null || back.getClientRects().length === 0) return false;
  return getComputedStyle(back).visibility !== 'hidden';
}

/**
 * Used by `App`, once for the whole page: ESCAPE IS THE WAY BACK. A key that nothing else took presses the back button on screen
 * (`WAY_BACK`, the mark a back button states itself with), so every page that has a way back has it on the same key, and a page's
 * own handler stays the one thing that says where back leads.
 *
 * THE KEY IS SOMEONE ELSE'S FIRST, in the order the app already keeps. A panel that owns it (a dialog, a sheet, a menu, the core's
 * open rings, the roadmap's standing stack) takes it on the window's capture phase and marks it handled, which is read here as
 * `defaultPrevented`; an open layer that closes itself later in the key's travel is seen by its marker (`ESCAPE_LAYER_SELECTOR`);
 * and a key typed into a text field is that field's (a rename is cancelled, the terminal keeps it), except a field that says the
 * key passes through it (`ESCAPE_PASSES`: the chat's line, where the reader's hands are while a chat is open).
 *
 * WITH MORE THAN ONE WAY BACK ON SCREEN the last in the document is pressed: a place opened inside another is drawn after it, so the
 * deepest place steps back first and the next press takes the one round it.
 *
 * It listens on the document's capture phase, ahead of every handler on the focused element, so a control that swallows the key on
 * its way up cannot shield it.
 */
export function useEscapeBack(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
      const focused = document.activeElement;
      if (focused !== null && focused.matches(TEXT_ENTRY_SELECTOR) && !focused.matches(ESCAPE_PASSES_SELECTOR)) return;
      if (document.querySelector(ESCAPE_LAYER_SELECTOR) !== null) return;
      const back = Array.from(document.querySelectorAll<HTMLElement>(WAY_BACK_SELECTOR)).filter(canBePressed).at(-1);
      if (back === undefined) return;
      event.preventDefault();
      back.click();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);
}
