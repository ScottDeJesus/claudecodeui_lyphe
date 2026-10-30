import { useEffect, useState } from 'react';

/**
 * How long the disc's geometry eases after its size changes: the kit's `--dur-move` (.35 s) and a margin, so the attribute outlives the
 * last frame of the ease. A deadline set by the change, never a clock that asks again.
 */
const EASING_MS = 400;

/**
 * Used by this module's CompanionFabView: whether the disc's size changed within the last `EASING_MS`, which is when CompanionFab.css
 * eases its width, height, left and top (the layer's `data-resizing`). The ease is scoped to a size change because left and top move for
 * other reasons too — the dock's cell arriving, a window resize — and those are as instant for her as for every other FAB, and as the
 * rect the kit reports, which the glide to a look is measured from, must never be one that is still on its way.
 */
export function useSizeEasing(size: number): boolean {
  // The size the last render drew, to know when it changed without an effect: the change is true in the render that finds it, so the
  // ease's attribute and the new size reach the page in one commit.
  const [drawn, setDrawn] = useState(size);
  // Whether a size change's ease is still running: set with the change, ended by the deadline below.
  const [easing, setEasing] = useState(false);
  if (size !== drawn) {
    setDrawn(size);
    setEasing(true);
  }

  useEffect(() => {
    if (!easing) return undefined;
    const deadline = window.setTimeout(() => setEasing(false), EASING_MS);
    return () => window.clearTimeout(deadline);
  }, [easing, drawn]);

  return easing;
}
