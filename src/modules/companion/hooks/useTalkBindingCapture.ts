import { useCallback, useEffect, useRef, useState } from 'react';

import { talkBindingFromEvent } from '@/modules/companion/utils/talkBinding';
import type { TalkBindingCapture, TalkKeyEvent, TalkMouseEvent } from '@/modules/companion/utils/talkBinding';
import type { TalkBinding } from '@/shared/companion-types';

/** What the row says when the save got no answer from the server. */
const SAVE_FAILED = 'Your binding could not be saved.';

/** The Cancel button of the binding row. A press on it is the way out, never a press offered as the binding. */
const CANCEL_CONTROL = '[data-talk-binding-cancel]';

/** The press is the capture's now: nothing else on the page hears it (not the old binding's listener, not a dialog), and the browser does not act on it. */
function swallow(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

/** Whether the event happened on the Cancel button (or inside it). */
function isOnCancel(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(CANCEL_CONTROL) !== null;
}

/**
 * Takes the release of a mouse button whose mousedown the capture swallowed, so the button does what it is bound to and
 * nothing else: the back button's mouseup would otherwise navigate back, the left button's click would still land on
 * whatever is under it, and the right button's menu would still open. The release is the button's `mouseup`, then its
 * `click` (left) or `auxclick` (the others), and `contextmenu` for the right button; each is swallowed once.
 *
 * Held at module level, not by the hook: the press that ends the capture unmounts the capture's listeners before its own
 * release arrives. The press that BINDS removes the prompt it went down on, and a browser sends no click or auxclick to an
 * element that has left the page, so the closing event may never come: the NEXT mousedown of any button ends the pairing
 * too, which is before the next real press of this button can be taken by it. A press whose release never arrives (let go
 * outside the window) ends the same way.
 */
let disarmRelease: (() => void) | null = null;

function swallowRelease(button: number, press: MouseEvent): void {
  disarmRelease?.();
  const closing = button === 0 ? 'click' : 'auxclick';
  const types = button === 2 ? ['mouseup', closing, 'contextmenu'] : ['mouseup', closing];
  const stops: Array<() => void> = [];
  const disarm = () => {
    for (const stop of stops) stop();
    if (disarmRelease === disarm) disarmRelease = null;
  };
  for (const type of types) {
    const handler = (event: Event) => {
      if (event instanceof MouseEvent && event.button !== button && type !== 'contextmenu') return;
      swallow(event);
      // The last event of a press ends the pairing (the right button's menu comes after its mouseup, so it waits for that).
      if (type === closing && button !== 2) disarm();
      if (type === 'contextmenu') disarm();
    };
    window.addEventListener(type, handler, true);
    stops.push(() => window.removeEventListener(type, handler, true));
  }
  const onNextPress = (event: MouseEvent) => {
    if (event !== press) disarm();
  };
  window.addEventListener('mousedown', onNextPress, true);
  stops.push(() => window.removeEventListener('mousedown', onNextPress, true));
  disarmRelease = disarm;
}

/**
 * Used by this module's CompanionSettingsSection to bind the talk button. `begin()` (the Bind button) enters capture:
 * window listeners in the CAPTURE phase take the next keydown or mousedown, whatever has focus, and swallow that mouse
 * button's mouseup and click or auxclick. `talkBindingFromEvent` (utils/talkBinding.ts) answers the press with a binding,
 * which `saveBinding` is handed and which ends the capture, or with a refusal, which is shown (`refusal`) while the capture
 * goes on, so the next press can be the right one.
 *
 * PASSED OVER, and the capture waits: a modifier on its own (the start of a chord), a key the browser cannot name, a mouse
 * button past the forward button, any press on Cancel (`[data-talk-binding-cancel]`, whose own click leaves), the
 * auto-repeat of the key that opened it, and a plain Tab, so a keyboard can reach Cancel. ESCAPE cancels from wherever focus is
 * (Cancel included): the binding stays as it was.
 *
 * `clear()` saves `null`. A save that is refused shows the server's own sentence as `refusal` too (with the capture over).
 */
export function useTalkBindingCapture(saveBinding: (binding: TalkBinding | null) => Promise<void>): {
  capturing: boolean;
  refusal: string | null;
  begin: () => void;
  cancel: () => void;
  clear: () => void;
} {
  // Bind was pressed and the next accepted press is awaited. State, because the row draws its prompt and Cancel from it and
  // the talk listeners stand aside for as long as the row carries its capture marker.
  const [capturing, setCapturing] = useState(false);
  // Why the last press was refused, or why the last save was: shown in the helper's place until the next capture or save.
  const [refusal, setRefusal] = useState<string | null>(null);
  // The latest save, read when a press arrives, so the listeners bound for one capture call the newest and are not rebound by it.
  const saveRef = useRef(saveBinding);
  // False once the section unmounted: a save that lands then sets nothing.
  const aliveRef = useRef(true);

  useEffect(() => {
    saveRef.current = saveBinding;
  });
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const save = useCallback(async (binding: TalkBinding | null) => {
    try {
      await saveRef.current(binding);
    } catch (failure) {
      console.warn('[Companion] The talk binding could not be saved:', failure);
      // A refusal carries the server's own sentence (an Error); a request that got no answer is the browser's TypeError, whose
      // words ("Failed to fetch") are not for a person.
      const sentence = failure instanceof Error && !(failure instanceof TypeError) ? failure.message : SAVE_FAILED;
      if (aliveRef.current) setRefusal(sentence);
    }
  }, []);

  useEffect(() => {
    if (!capturing) return undefined;

    /** What a press comes to: the binding (capture over, saved), its refusal (shown, capture goes on). */
    const take = (answer: TalkBindingCapture) => {
      if ('refusal' in answer) {
        setRefusal(answer.refusal);
        return;
      }
      setRefusal(null);
      setCapturing(false);
      void save(answer.binding);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Before the Cancel check: a keyboard reaches Cancel by Tab, and Escape there must cancel too (and never reach the chat's
      // Escape, which stops a running turn).
      if (event.key === 'Escape') {
        swallow(event);
        setRefusal(null);
        setCapturing(false);
        return;
      }
      if (isOnCancel(event)) return;
      // The Enter or Space that pressed Bind is still held: its repeats are not a choice.
      if (event.repeat) {
        swallow(event);
        return;
      }
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
      const answer = talkBindingFromEvent(event as TalkKeyEvent);
      if (answer === null) return;
      swallow(event);
      take(answer);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (isOnCancel(event)) return;
      const answer = talkBindingFromEvent(event as TalkMouseEvent);
      if (answer === null) return;
      swallow(event);
      swallowRelease(event.button, event);
      take(answer);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [capturing, save]);

  const begin = useCallback(() => {
    setRefusal(null);
    setCapturing(true);
  }, []);

  const cancel = useCallback(() => {
    setRefusal(null);
    setCapturing(false);
  }, []);

  const clear = useCallback(() => {
    setRefusal(null);
    void save(null);
  }, [save]);

  return { capturing, refusal, begin, cancel, clear };
}
