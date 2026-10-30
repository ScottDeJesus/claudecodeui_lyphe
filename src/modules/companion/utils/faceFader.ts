// The crossfade between two frames, in pure code. The page draws two canvases: `base` underneath and `over` on top at
// `alpha`. The fader is told, each step, which frame is wanted and how long a change to it takes; it answers what to draw.

/** What the page draws: `base` whole, and `over` (a frame index, or null for none) on top of it at `alpha` (0..1). */
type FaderDraw = { base: number; over: number | null; alpha: number };

/** One fader per engine. */
type Fader = {
  /** Moves toward `frame` over `fadeMs` (0 swaps at once) and answers the draw for `now`. The first frame ever shown appears with no fade. */
  show(frame: number, now: number, fadeMs: number): FaderDraw;
  /** Whether a crossfade is still under way at `now`. */
  fading(now: number): boolean;
  /** When the crossfade under way ends (ms), or null when there is none. */
  endsAt(): number | null;
};

/** Used by `faceEngine.ts`. */
export function createFader(): Fader {
  let base: number | null = null;
  let over: number | null = null;
  let startedAt = 0;
  let duration = 1;

  const progress = (now: number): number => Math.min(1, Math.max(0, (now - startedAt) / duration));

  return {
    show(frame, now, fadeMs) {
      if (base === null) base = frame;
      // No fade asked for (a hard swap, or reduced motion turned on): the wanted frame is shown whole at once, ending any fade under way.
      if (fadeMs <= 0) {
        base = frame;
        over = null;
        return { base, over: null, alpha: 0 };
      }
      if (over !== null && progress(now) >= 1) {
        base = over;
        over = null;
      }
      if (frame !== (over ?? base)) {
        if (over !== null && frame === base) {
          // Going back to the frame being left: run the fade the other way from where it stands, so nothing jumps.
          const done = progress(now);
          [base, over] = [over, base];
          startedAt = now - (1 - done) * duration;
        } else {
          // A third frame cuts in: the one more visible is kept as the ground. This steps by half a fade at most, and fades are 60 to 300 ms.
          if (over !== null) base = progress(now) >= 0.5 ? over : base;
          over = null;
          if (fadeMs > 0) {
            over = frame;
            startedAt = now;
            duration = fadeMs;
          } else {
            base = frame;
          }
        }
      }
      if (over === null) return { base, over: null, alpha: 0 };
      const alpha = progress(now);
      if (alpha >= 1) {
        base = over;
        over = null;
        return { base, over: null, alpha: 0 };
      }
      return { base, over, alpha };
    },
    fading: (now) => over !== null && progress(now) < 1,
    endsAt: () => (over === null ? null : startedAt + duration),
  };
}
