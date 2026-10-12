import { useEffect, useRef, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/** How long a count runs from the number on screen to its new target. */
const COUNT_MS = 1400;

/** Ease-out cubic, `1 − (1 − k)³`: a quick start and a long soft landing, so the last digits arrive slowly. */
function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/**
 * A whole number that COUNTS to `target`: the number itself when the caller mounts, so a visit to the tab
 * never opens on a fraction of it, and on each change of `target` a count from the number last drawn to
 * the new one over 1.4 s, easing out, one step a frame. A target that changes mid-count counts on from
 * where the eye is, not from where the last count began. With motion reduced it answers `target` at once.
 *
 * Used by `CerberusHeader` for the "N of M checks passing" count.
 */
export function useCountTo(target: number): number {
  const hostWindow = useHostWindow();
  const reduce = hostWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The number drawn this frame. Essential: the frame loop below is its only writer, and the count in
  // motion is exactly what the screen shows between two targets.
  const [drawn, setDrawn] = useState(target);
  // The same number, mirrored for the effect: a change of target begins its count from it, and reading
  // the state there would re-arm the loop on every frame it writes. Written only beside `setDrawn`, so
  // the two never disagree, which is what lets motion be allowed again later without a stale number.
  const drawnRef = useRef(target);

  useEffect(() => {
    const from = drawnRef.current;
    if (from === target) return undefined;
    const started = hostWindow.performance.now();
    let frame = hostWindow.requestAnimationFrame(function step(now: number) {
      // Motion reduced is the same loop finishing on its first frame, so the state keeps up with the
      // target while the hook answers it directly.
      const progress = reduce ? 1 : Math.min(1, Math.max(0, (now - started) / COUNT_MS));
      const value = progress === 1 ? target : Math.round(from + (target - from) * easeOutCubic(progress));
      drawnRef.current = value;
      setDrawn(value);
      if (progress < 1) frame = hostWindow.requestAnimationFrame(step);
    });
    return () => hostWindow.cancelAnimationFrame(frame);
  }, [target, reduce, hostWindow]);

  return reduce ? target : drawn;
}
