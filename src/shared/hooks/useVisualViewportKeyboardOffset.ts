import { useEffect } from 'react';

import { COARSE_POINTER_QUERY } from '@/shared/constants';

/** The least gap, in px, that is a keyboard: a real one is over a hundred, a fractional viewport leaves under one. */
const KEYBOARD_MARK_FLOOR_PX = 2;

/** The least shrink of the layout viewport, in px, that is a keyboard: the browser's own bar sliding away moves it by well under this. */
const LAYOUT_SHRINK_FLOOR_PX = 120;

/** The `input` types that open a keyboard. A type the browser does not know reads as `text`, so `input.type` is always one of these or a non-text one. */
const TEXT_ENTRY_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** The layout viewport as last measured with no text field focused: the height a keyboard is measured against, at the width it was read. */
type FieldFreeViewport = { width: number; height: number };

/** Whether `target` is a box a keyboard types into: a text-entry `input`, a `textarea` or a `contenteditable` element, none of them read-only. */
function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  if (target instanceof HTMLInputElement) return !target.readOnly && TEXT_ENTRY_INPUT_TYPES.has(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * Keeps the fixed workspace shell above the virtual keyboard and writes the keyboard's MARK, from one handler. Consumed by
 * project-workspace's route (the workspace shell) and by the station's route (the station's root), each of which draws a fixed frame.
 *
 * `--keyboard-height` on the root is the visual viewport's gap: `innerHeight` less `visualViewport.height`, which a fixed frame's
 * `bottom` reads. It is the iOS lift: iOS Safari leaves the layout viewport whole and slides the visual one up over the keys.
 *
 * `data-keyboard` on html is the MARK, `up` or `down`, one attribute for CSS to key on (`html[data-keyboard=up]`) that both
 * platforms set. It is `up` under either rule:
 * - the visual viewport stands 2 px or more short of `innerHeight` (iOS; a fractional viewport, a zoom or a rounded `innerHeight`
 *   leaves under a pixel and is no keyboard, and a pinch-zoomed page reads as a gap, as `--keyboard-height` always did);
 * - a text field holds the focus, the pointer is coarse and `innerHeight` stands at least 120 px under the last `innerHeight` read
 *   with no field focused at the same `innerWidth` (Android: `interactive-widget=resizes-content` in index.html makes its browser
 *   resize the LAYOUT viewport for the keys, so the visual viewport never stands short of it and the first rule never fires). The
 *   focused field is what tells a keyboard from a window resized; the width is what tells it from a phone turned over. Only a
 *   `resize` moves that height (and the first read sets it): a focus move says nothing new of the viewport, and one that leaves a
 *   field for a button, or for nothing, while the keys still stand would record their shrink as the page's own height, so a
 *   refocus would measure the keys against themselves and read `down` under them.
 *
 * Both are read on the visual viewport's `resize`, on the window's `resize` and on `focusin` and `focusout`, never on a timer. A
 * `focusout` whose `relatedTarget` is itself a text field keeps the mark: the focus is moving between two fields, and the keys stay.
 * A keyboard that is closed with its field still focused (Android's Back) ends the mark when the layout viewport grows back.
 *
 * Its readers: the station's phone arrangement (its foot, the bar and the pending line, step aside under `up`), compact's fold (the
 * strip's line and the switch, while the column is short) and the sections (the dock's cap and the talk control's box, while the
 * dock's own field holds the focus). Each reads only the mark.
 *
 * It writes both once as it mounts too. The two routes take turns on a phone (`/` and `/station`, the station a lazy chunk with a
 * gap while it loads), so a keyboard that closed while neither was mounted sent its events to no one, and the variable and the mark
 * would otherwise keep what they held before: the new route's frame would stand that high over a dead band.
 */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    const coarsePointer = window.matchMedia(COARSE_POINTER_QUERY);
    const root = document.documentElement;
    // The layout viewport as last read with no text field focused, on a resize or the first read (see above). Kept here, not in state:
    // only this handler reads it, and nothing draws from it. Null until such a read has been made, when a keyboard cannot be told
    // from a window of that size.
    let fieldFree: FieldFreeViewport | null = null;

    const read = (event?: Event) => {
      const { innerWidth, innerHeight } = window;
      // A `focusout` fires while `document.activeElement` is already the body: the field the focus is moving to is the event's own.
      const fieldFocused = event?.type === 'focusout'
        ? isTextField((event as FocusEvent).relatedTarget)
        : isTextField(document.activeElement);
      if (!fieldFocused && (event?.type === 'resize' || fieldFree === null)) fieldFree = { width: innerWidth, height: innerHeight };

      const visualGap = visualViewport ? Math.max(0, innerHeight - visualViewport.height) : 0;
      const layoutShrunk = fieldFocused
        && coarsePointer.matches
        && fieldFree !== null
        && fieldFree.width === innerWidth
        && fieldFree.height - innerHeight >= LAYOUT_SHRINK_FLOOR_PX;

      // Each is written only when it changes: this runs on every focus move on the page, and most of them change neither.
      const lift = `${visualGap}px`;
      if (root.style.getPropertyValue('--keyboard-height') !== lift) root.style.setProperty('--keyboard-height', lift);
      const mark = visualGap >= KEYBOARD_MARK_FLOOR_PX || layoutShrunk ? 'up' : 'down';
      if (root.dataset.keyboard !== mark) root.dataset.keyboard = mark;
    };

    read();
    visualViewport?.addEventListener('resize', read);
    window.addEventListener('resize', read);
    document.addEventListener('focusin', read);
    document.addEventListener('focusout', read);
    return () => {
      visualViewport?.removeEventListener('resize', read);
      window.removeEventListener('resize', read);
      document.removeEventListener('focusin', read);
      document.removeEventListener('focusout', read);
    };
  }, []);
}
