import { useCallback, useEffect, useRef } from 'react';

import type { StationFocus, StationFocusKind } from '@/shared/station-types';

/**
 * The handle of the control that fires what a kind of focus shows, inside the stage's body. A card is the dispatcher's own
 * `PlanCard`, so its own handles: LockAnswer's Queue for an Accept (`data-ask-queue`), RoundAnswer's first question for a round
 * (`data-ask-question`). The ask's, the follow-ups' and the check's stages mark theirs `data-station-fire`. A kind with no entry
 * (a chat, a page, her cards) has no firing control, and the keyboard stays where it was.
 */
const FIRE_HANDLES: Readonly<Partial<Record<StationFocusKind, string>>> = {
  card: '[data-ask-queue], [data-ask-question]',
  ask: '[data-station-fire]',
  followups: '[data-station-fire]',
  check: '[data-station-fire]',
};

/** What can hold the keyboard: a control, a link, a field, or anything that opted in with a `tabindex` (a group is `-1`: it takes the focus and Tab walks in). */
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]';

/**
 * How long a landing waits for a stage that has not drawn its control: a plan card or a list still being read. Past it the stage
 * has none to give (the ask was answered elsewhere, the Accept already queued) and the keyboard stays where it is. A deadline for giving up, never a re-check.
 */
const LANDING_DEADLINE_MS = 5_000;

/** The handle's own element when it can take the focus, else the first thing inside it that can (a round's question is a list item; its first option is the press). */
function focusTargetOf(handle: HTMLElement): HTMLElement | null {
  return handle.matches(FOCUSABLE) ? handle : handle.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * HOLDS BACK THE KEY THAT PRESSED THE ACT. An Enter on the rail's act clicks it on its keydown, and the key is still down when the keyboard
 * lands on the control that fires (Queue is a button, and a button clicks on Enter): its auto-repeat would press Queue, approving a census he
 * has seen for less than one repeat interval. So every repeated keydown and keypress is swallowed in the capture phase until THAT key (`code`)
 * comes up, or the window loses the keyboard: another key's release (Shift's, in a Shift+Enter) does not end it while Enter is still down.
 * A fresh keydown is a new press of his own and goes through. Returns the release.
 */
function holdBackHeldKey(code: string, onReleased: () => void): () => void {
  const swallow = (event: KeyboardEvent) => {
    if (!event.repeat) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const released = (event: KeyboardEvent) => { if (event.code === code) release(); };
  const release = () => {
    document.removeEventListener('keydown', swallow, true);
    document.removeEventListener('keypress', swallow, true);
    document.removeEventListener('keyup', released, true);
    window.removeEventListener('blur', release);
    onReleased();
  };
  document.addEventListener('keydown', swallow, true);
  document.addEventListener('keypress', swallow, true);
  document.addEventListener('keyup', released, true);
  window.addEventListener('blur', release);
  return release;
}

/**
 * THE KEYBOARD'S LANDING after a rail item's act: `land(focus)` moves the keyboard to the control that fires the focus's stage,
 * once the stage has drawn it. The act has just called `setFocus`, so the stage may not be there yet (a different thing is
 * drawn at the next commit) or may need a moment (a plan card). The landing is waiting on the DOM itself: a `MutationObserver` on the
 * page sees the control arrive and focuses it; no timer asks again. Only the stage's own body is searched, and only while its
 * kind is the pressed one, so a control of the previous thing is never taken.
 *
 * It stops at the first of: the control found, the next landing (a newer press), the page's next press or key (he has moved
 * on and the keyboard is his; a held key's auto-repeat is not a new key), the deadline, and the rail leaving. It focuses and presses
 * nothing: a fresh Enter after it is his word, and on an Accept it is Queue's own button he then presses. The Enter that pressed the act
 * is held back until it comes up (`holdBackHeldKey`), so holding it down never presses what it was only asked to show.
 *
 * Used by `WhatNeedsYou`, once, for every act the rail offers.
 */
export function useLandOnStageControl(): (focus: StationFocus) => void {
  // How the landing in progress stops, or null when none is. A ref: a press starts and ends landings, and nothing is drawn from it.
  const stopRef = useRef<(() => void) | null>(null);
  // How the hold on the pressing key's repeat is released, or null when none is held. A ref for the same reason.
  const releaseKeyRef = useRef<(() => void) | null>(null);

  // The `code` of the key most recently pressed and still down, or null when none is. A ref: it is read at the instant of a press, to tell a keyboard
  // press (its key is still down as the keyboard lands, and is the one to hold back) from a mouse or a touch press (no key to hold back), and nothing is drawn from it.
  const keyDownRef = useRef<string | null>(null);

  useEffect(() => {
    // Capture, so it is set before the press's own handler runs: an Enter clicks the act on its keydown.
    const down = (event: KeyboardEvent) => { keyDownRef.current = event.code; };
    const up = (event: KeyboardEvent) => { if (event.code === keyDownRef.current) keyDownRef.current = null; };
    const lost = () => { keyDownRef.current = null; };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    window.addEventListener('blur', lost);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', lost);
      stopRef.current?.();
      releaseKeyRef.current?.();
    };
  }, []);

  return useCallback((focus: StationFocus) => {
    stopRef.current?.();
    const handle = FIRE_HANDLES[focus.kind];
    if (handle === undefined) return;
    // A press by key is armed with the landing, before the control exists: the repeat can arrive at any moment after it.
    releaseKeyRef.current?.();
    if (keyDownRef.current !== null) releaseKeyRef.current = holdBackHeldKey(keyDownRef.current, () => { releaseKeyRef.current = null; });

    const seek = (): boolean => {
      const body = document.querySelector(`[data-station-stage="${focus.kind}"] [data-station-stage-body]`);
      const target = body?.querySelector<HTMLElement>(handle);
      const landing = target ? focusTargetOf(target) : null;
      if (landing === null) return false;
      landing.focus();
      return true;
    };

    const observer = new MutationObserver(() => { if (seek()) stop(); });
    const deadline = window.setTimeout(() => stop(), LANDING_DEADLINE_MS);
    const frame = window.requestAnimationFrame(() => { if (seek()) stop(); });
    // A held key's repeat is the press that asked for the landing, not him moving on.
    const moved = (event: Event) => { if (!(event instanceof KeyboardEvent && event.repeat)) stop(); };
    function stop() {
      observer.disconnect();
      window.clearTimeout(deadline);
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', moved, true);
      document.removeEventListener('keydown', moved, true);
      stopRef.current = null;
    }
    // The `disabled` attribute is watched too: Queue is disabled while its card is busy and enabled again without a node arriving.
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('pointerdown', moved, true);
    document.addEventListener('keydown', moved, true);
    stopRef.current = stop;
  }, []);
}
