import { useEffect } from 'react';
import type { RefObject } from 'react';

import { ESCAPE_LAYER_SELECTOR } from '@/shared/constants';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';

// Input types that hold no text. Escape on one of these (a focused checkbox or button) is not
// cancelling anything, so it still stops the turn.
const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'];

// The fields a person types into, where Escape has its own meaning (cancel a rename, leave the terminal).
// A selector, read with `Element.matches`, never `instanceof HTMLInputElement`: the chat can stand in a
// floating window, and an element of that window is an instance of THAT window's classes, so an
// `instanceof` against this window's constructors is false for every field there.
const TEXT_ENTRY_SELECTOR = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  `input${NON_TEXT_INPUT_TYPES.map((type) => `:not([type="${type}"])`).join('')}`,
].join(', ');

/**
 * Whether an Escape belongs to some other part of the page rather than to the running turn: it was
 * typed into a text field other than the composer (an inline rename, the terminal), or an open menu,
 * modal dialog or Escape-owning panel is about to close on it.
 *
 * The focused element is the key's target: a keydown is dispatched to `activeElement` (the body when
 * nothing is focused), and the document's `activeElement` is typed `Element`, so no cast is needed.
 * Both reads use the HOST document, the one the chat is drawn in, never the global `document`.
 */
function isEscapeOwnedElsewhere(hostDocument: Document, composer: HTMLTextAreaElement | null): boolean {
  const focused = hostDocument.activeElement;
  if (focused !== null && focused !== composer && focused.matches(TEXT_ENTRY_SELECTOR)) {
    return true;
  }
  return hostDocument.querySelector(ESCAPE_LAYER_SELECTOR) !== null;
}

type UseEscapeToAbortSessionArgs = {
  /** The listener is only attached while there is a running turn to stop. */
  canAbortSession: boolean;
  onAbortSession: () => void;
  /** The chat composer, the one text field where Escape stops the turn. */
  composerRef: RefObject<HTMLTextAreaElement>;
};

/**
 * Used by the chat module's `ChatInterface`: lets Escape stop the running turn from anywhere in the
 * chat's window, except where Escape already means something else.
 *
 * The listener runs in the host document's CAPTURE phase, ahead of every handler on the focused
 * element, so a rename input calling `stopPropagation` cannot shield its Escape. Ownership is decided
 * here instead, from the focused field and any open layer. A panel that must win outright still does so
 * from a WINDOW capture listener that calls `preventDefault` (`Dialog`, `Sheet`, the app switcher's
 * radial), which runs first and is honoured through `defaultPrevented`.
 */
export function useEscapeToAbortSession({
  canAbortSession,
  onAbortSession,
  composerRef,
}: UseEscapeToAbortSessionArgs): void {
  const hostWindow = useHostWindow();
  const isPageHeld = useIsPageHeld();

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    // The host document, not the opener's: a key pressed in the floating window never reaches the
    // opener's document.
    const hostDocument = hostWindow.document;
    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }
      // The station on screen covers this chat (it stays mounted under it): an Escape typed there is
      // the station's, and must not end a turn nobody is looking at.
      if (isPageHeld()) {
        return;
      }
      if (isEscapeOwnedElsewhere(hostDocument, composerRef.current)) {
        return;
      }

      event.preventDefault();
      onAbortSession();
    };

    hostDocument.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      hostDocument.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, onAbortSession, composerRef, hostWindow, isPageHeld]);
}
