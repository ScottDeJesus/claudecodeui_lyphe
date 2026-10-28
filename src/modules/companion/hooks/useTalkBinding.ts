import { useEffect, useLayoutEffect, useRef } from 'react';

import { useChatHost } from '@/modules/chat-host';
import { isTalkBindingRepeat, matchesTalkBinding } from '@/modules/companion/utils/talkBinding';
import type { TalkKeyEvent, TalkMouseEvent } from '@/modules/companion/utils/talkBinding';
import type { TalkBinding } from '@/shared/companion-types';

/**
 * The attribute Settings puts on its field while it captures a new binding. The listeners below pass over every
 * event while an element carries it, so pressing the old binding to re-bind does not press the talk button.
 */
const CAPTURE_MARKER = '[data-talk-binding-capture]';

/** The press is the talk button's now: nothing else on the page hears it, and the browser does not act on it. */
function swallow(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

/** One capture-phase listener on every window the hook watches; the answer takes all of them down. */
function listen<Type extends keyof WindowEventMap>(
  windows: Window[],
  type: Type,
  handler: (event: WindowEventMap[Type]) => void,
): () => void {
  for (const target of windows) target.addEventListener(type, handler, true);
  return () => {
    for (const target of windows) target.removeEventListener(type, handler, true);
  };
}

/**
 * Settings is capturing a new binding. It is always in the main window, so the main document is the one asked
 * even when the press came in the picture-in-picture window.
 */
function bindingIsBeingCaptured(): boolean {
  return document.querySelector(CAPTURE_MARKER) !== null;
}

/**
 * Used by the companion's talk button (`CompanionTalkButton`) to press it from the keyboard or the mouse: `binding` is the
 * account's `talkBinding` (`null` binds nothing and listens to nothing) and `toggle` is the button's own press.
 *
 * THE LISTENERS ARE ON `window`, IN THE CAPTURE PHASE, like `useChatHotkey`'s, so the press is heard before the
 * composer's field, the editor or a framed page can take it, whatever has focus. A key pressed in the floating
 * chat's picture-in-picture window reaches that window and never the opener, so the same listeners are bound
 * to `useChatHost().pipWindow` while one is open; the effect is keyed on the binding and on that window, and a
 * window that closes takes its listeners down in the cleanup.
 *
 * A KEY BINDING matches on `KeyboardEvent.code` and all four modifiers exactly. A `repeat` of the held chord never
 * calls `toggle` — a held key does not flap the recording — but it is swallowed all the same, so a held F5 or Ctrl+S
 * is not handed to the browser. A MOUSE BINDING matches `button` on mousedown. A match calls
 * `preventDefault()` and `stopPropagation()` and then `toggle`, inside the same event: the microphone opens from
 * a user gesture. For a mouse button the PAIRED `mouseup` and `auxclick` are swallowed the same way, so the back
 * button records and does not also navigate back, and the `pointerdown` and `pointerup` that come with it are
 * stopped (not prevented: preventing a pointerdown would cancel the mousedown that follows it), so a popover
 * that closes on an outside pointerdown stays open. The pairing outlives a re-bind and a press of any other button
 * in between: it is held in a ref, and only the armed button's own mousedown, auxclick or an unbinding ends it.
 * A mouseup or auxclick whose mousedown was passed over is left alone.
 *
 * A BINDING ON THE CHAT'S OWN CHORD (Ctrl or ⌘ with `CHAT_TOGGLE_KEY`) FIRES BOTH. `useChatHotkey` listens on the
 * same window in the same phase, and `stopPropagation` does not stop a sibling listener on the same target, so one
 * press toggles the chat and the talk button. Nothing refuses that chord.
 *
 * `toggle` is read through a ref written in a layout effect, as `useChatHotkey` reads its own, so listeners bound
 * once call the latest one and a press is never behind the button's state.
 */
export function useTalkBinding(binding: TalkBinding | null, toggle: () => void): void {
  const { pipWindow } = useChatHost();
  const latestToggle = useRef(toggle);
  useLayoutEffect(() => {
    latestToggle.current = toggle;
  });
  // The mouse button whose mousedown matched and whose mouseup, auxclick and pointerup are still to come; `null`
  // between presses. A ref and not a local of the effect: a re-bind (a `companion_settings` frame hands the hook a
  // new, equal binding object) tears the listeners down between the two halves of a press, and the release must
  // still be this press's.
  const pressedButton = useRef<number | null>(null);

  useEffect(() => {
    // `?? null`: a server that predates the field sends no `talkBinding` at all, and that is `undefined` on the wire.
    const bound = binding ?? null;
    if (bound === null) {
      pressedButton.current = null;
      return undefined;
    }
    const windows = pipWindow === null ? [window] : [window, pipWindow];

    const onKeyDown = (event: KeyboardEvent) => {
      if (bindingIsBeingCaptured()) return;
      // `KeyboardEvent.type` is a `string` in the DOM's typing and `'keydown'` here: this listener hears nothing else.
      const press = event as TalkKeyEvent;
      if (matchesTalkBinding(bound, press)) {
        swallow(event);
        latestToggle.current();
      } else if (isTalkBindingRepeat(bound, press)) {
        swallow(event);
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if (bindingIsBeingCaptured() || !matchesTalkBinding(bound, { type: 'mousedown', button: event.button })) return;
      event.stopPropagation();
    };
    const onMouseDown = (event: MouseEvent) => {
      // A new press of the armed button: the last press's release never arrived (it was let go outside every
      // window), so what is armed is not this press's.
      if (event.button === pressedButton.current) pressedButton.current = null;
      if (bindingIsBeingCaptured() || !matchesTalkBinding(bound, event as TalkMouseEvent)) return;
      pressedButton.current = event.button;
      swallow(event);
      latestToggle.current();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button === pressedButton.current) event.stopPropagation();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === pressedButton.current) swallow(event);
    };
    // The auxclick is the last of the press: it ends the pairing.
    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== pressedButton.current) return;
      swallow(event);
      pressedButton.current = null;
    };

    // The release halves are listened for whatever the binding is: a re-bind from a mouse button to a key between a
    // press and its release must still finish that press. With nothing armed they do nothing.
    const stops = [
      listen(windows, 'pointerup', onPointerUp),
      listen(windows, 'mouseup', onMouseUp),
      listen(windows, 'auxclick', onAuxClick),
      ...(bound.kind === 'key'
        ? [listen(windows, 'keydown', onKeyDown)]
        : [listen(windows, 'pointerdown', onPointerDown), listen(windows, 'mousedown', onMouseDown)]),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [binding, pipWindow]);
}
