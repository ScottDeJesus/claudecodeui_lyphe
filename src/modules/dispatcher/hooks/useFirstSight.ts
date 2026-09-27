import { useCallback, useEffect, useState } from 'react';
import type { AnimationEvent } from 'react';

/**
 * Every key this page session has already drawn. Module-level on purpose: a card unmounts when it
 * folds away, pages out of a strip or is redrawn under a new list, and a remount is not an arrival —
 * the reader has seen that card, so it must come back still.
 */
const drawn = new Set<string>();

/**
 * Every key whose rise has PLAYED this page session — claimed by the first copy whose animation
 * actually starts, which is the copy the reader is looking at (`useRiseOnce`).
 */
const risen = new Set<string>();

/**
 * Whether this page session has NOT drawn `key` before — true for exactly the first mount that draws
 * it, and for every render of that mount.
 *
 * READ ONCE PER MOUNT and never re-asked: the answer is what the card's entrance hangs on, and a
 * value that flipped mid-mount would pull the class out from under an animation already playing. It
 * is held by a state's lazy initializer rather than a ref the chat's shapes use (`useShapeCollapse`):
 * the same once-per-mount read, without reading a ref's `current` during render. MARKED IN AN
 * EFFECT, never during render: marking while rendering would claim the key before the first
 * appearance could rise, and the entrance would play for nobody — the chat's pair for the same reason
 * (`collapseState`'s `hasEntered` / `markEntered`).
 *
 * `key` names the CARD, not the component (`plan:<name>`, `darc:<name>`). It is the SEED of a rise,
 * not the claim: a card that arrives while both homes are mounted (the chat tab is kept mounted and
 * hidden) mounts in both in one commit, both reads run before either effect marks the key, and both
 * answer true. Which copy rises is decided when a rise PLAYS (`useRiseOnce`).
 *
 * Used by `useRiseOnce`, below.
 */
export function useFirstSight(key: string): boolean {
  // This mount's answer, read on its first render and held for its life; nothing ever sets it.
  const [firstSight] = useState(() => !drawn.has(key));

  useEffect(() => {
    drawn.add(key);
  }, [key]);

  return firstSight;
}

/**
 * A card root's ONE rise: `motion-safe:animate-shape-rise` on the first mount this page session draws
 * `key` (`useFirstSight`), and gone from the root the moment that rise ends.
 *
 * THE CLASS MUST NOT OUTLIVE THE RISE, because a mount is not the only thing that starts an animation:
 * a CSS animation restarts whenever its element goes from `display: none` to shown, and the chat tab —
 * the gutter's home — is hidden that way, never unmounted (`WorkspaceMain`). With the class held for
 * the whole mount, every return to the Chat tab replayed the rise of every gutter card (measured
 * 2026-09-26: 19 `vv-rise` animations running 80ms after each switch). So "rising" is state, seeded
 * from first sight and cleared on the root's own `animationend` — filtered to the root, so a pill's
 * count or a flow node's ring ending inside the card does not end it. Once cleared, a re-display has
 * nothing to restart.
 *
 * THE RISE IS CLAIMED WHEN IT PLAYS, NOT WHEN A MOUNT READS IT. A card that arrives while the Runner
 * tab is showing mounts in BOTH homes in one commit, and first sight answers true in both; a CSS
 * animation does not run under `display: none`, so the gutter copy kept its class and rose the moment
 * Chat was shown — the reader watched the card rise twice (measured 2026-09-26). So the root's own
 * `vv-rise` `animationstart` claims `key` in `risen`, and a copy whose rise starts after the key was
 * claimed cancels it on the spot and drops the class. A hidden copy's rise only starts when it is
 * displayed, so the home the reader saw first has always claimed it by then. Animation events are
 * dispatched before the frame paints, and the cancel is synchronous inside the handler, so the
 * cancelled copy paints no first keyframe.
 *
 * Under `prefers-reduced-motion: reduce` the class is inert (`motion-safe:`), no animation runs and so
 * none ends: the class stays and still does nothing.
 *
 * Used by `PlanCard` and `DeckFrame`: put the class and both handlers on the card's root.
 */
export function useRiseOnce(key: string): {
  className: string | undefined;
  onAnimationStart: (event: AnimationEvent<HTMLElement>) => void;
  onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
} {
  const firstSight = useFirstSight(key);
  // Whether the root is still to play, or is playing, its one rise: seeded from first sight and set
  // false once — when that rise ends, or when another copy of the card has already played it.
  const [rising, setRising] = useState(firstSight);
  const onAnimationStart = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.animationName !== 'vv-rise') return;
    if (!risen.has(key)) {
      risen.add(key);
      return;
    }
    const play = event.currentTarget.getAnimations()
      .find((animation) => animation instanceof CSSAnimation && animation.animationName === 'vv-rise');
    play?.cancel();
    setRising(false);
  }, [key]);
  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setRising(false);
  }, []);
  return { className: rising ? 'motion-safe:animate-shape-rise' : undefined, onAnimationStart, onAnimationEnd };
}
