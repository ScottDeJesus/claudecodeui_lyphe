import { useEffect, useState } from 'react';

/** How long one count runs, start to settle. */
const DURATION_MS = 1400;

/**
 * `1 - (1 - p) ** 5`: the JS twin of Verve's entry curve, `cubic-bezier(.22,1,.36,1)` — the same
 * fast start and long soft landing the cards themselves arrive on, so a figure settles the way its
 * card does rather than on a second rhythm.
 */
function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 5;
}

/**
 * The last value DRAWN for each key, for this page session. Module-level on purpose: a card that
 * folds, pages away or is redrawn by a poll unmounts its figures, and the value it had reached is
 * what the next mount counts on from — so a figure counts from 0 exactly once, at its first sight,
 * and never replays a count it has already shown.
 */
const lastDrawn = new Map<string, number>();

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A figure that COUNTS to `target`: from 0 when `key` has never been drawn, and from wherever it
 * last stood on every change of `target` — a plan's total ticking up as a phase bills counts the
 * difference, not the whole figure again.
 *
 * It runs `DURATION_MS` on `requestAnimationFrame` along `easeOut`. Every frame writes
 * `lastDrawn`, so a count cut short by an unmount (whose frame is cancelled) resumes from the
 * value the reader last saw. Under `prefers-reduced-motion: reduce` it answers `target` at once
 * and nothing moves.
 *
 * `key` names the FIGURE, not the component: `plan:<name>:paid` is one count wherever that card
 * is drawn, so the tab and the gutter never count the same figure twice.
 *
 * Used by `SpendPills`, for a card's total and an arc deck's books.
 */
export function useCountUp(target: number, key: string): number {
  // The frame's current value, tagged with the key it was counted for: the rAF loop is the one
  // writer, and the tag stops a component handed a NEW key from drawing the old key's figure for
  // the render before its first frame.
  const [drawn, setDrawn] = useState(() => ({ key, value: lastDrawn.get(key) ?? 0 }));
  const reduce = reducedMotion();

  useEffect(() => {
    if (reduce) {
      lastDrawn.set(key, target);
      return undefined;
    }
    const from = lastDrawn.get(key) ?? 0;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      // A figure already standing at its target (a remount, a poll that changed nothing) settles in
      // one frame rather than repainting the same number for the whole duration.
      const progress = from === target ? 1 : Math.min(1, Math.max(0, (now - started) / DURATION_MS));
      const value = progress === 1 ? target : from + (target - from) * easeOut(progress);
      lastDrawn.set(key, value);
      setDrawn({ key, value });
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, key, reduce]);

  if (reduce) return target;
  return drawn.key === key ? drawn.value : (lastDrawn.get(key) ?? 0);
}
