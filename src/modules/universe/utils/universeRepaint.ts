import type { Viewport } from '@/modules/universe/utils/universeView';

/**
 * WHICH LAYER A FRAME OWES — the cadence the stack repaints on, and nothing else.
 *
 * THE BOUNDARY WITH `universeLoop` IS THE WHOLE OF THIS FILE'S SHAPE. The loop decides WHETHER a
 * frame happens, and it knows nothing of the graph, of the stack or of the box; this decides which
 * layer that frame repaints, given the camera, the dirty flags and the regime the zoom is in. The
 * two are callable apart: a script may step a camera through this with no loop and no page, and the
 * loop may be driven by a test with no cadence behind it.
 *
 * WHY A CADENCE AT ALL. Three of the four points of the picture do not move every frame. The sky
 * slides only as far as the camera does; a settled estate's stars are held by the same springs they
 * were held by a frame ago; and what a frame at sixty a second is really paying for is repainting
 * ten thousand of them because one comet moved. So the star layer repaints when something has
 * changed — the camera moved, the intro is running, a focus fade is mid-flight, the layer was
 * marked dirty — and otherwise on a fixed every-nth-frame cadence that coarsens as the sky does:
 * six frames at the fitted view where every star is sub-pixel, three under a zoom of one, two
 * above it. The live layer is not this file's business at all: it repaints every frame, because
 * comets, flares and labels are the things that move.
 *
 * WHAT "THE CAMERA MOVED" MEANS. The handoff's own test, in screen terms rather than world ones: a
 * quarter of a pixel of pan, or two tenths of a percent of zoom. The key the test measures against
 * is the camera of the last repaint, and it is rewritten only when the test passes — so a slow
 * drift accumulates across frames instead of repainting for a movement nothing could see.
 *
 * AND A LAYER MARKED DIRTY IS REPAINTED WHATEVER THE CADENCE SAYS. A tweak that switched a pass
 * off, a palette that flipped, a new map, a resized box: each leaves the last frame's picture on a
 * layer that would otherwise wait its turn, and each is a one-off rather than a rate.
 */

/** The frames between repaints of a still sky. The sky slides only as far as the camera does, so its
 *  cadence is fixed; the star layer's is a function of the regime, because what ten thousand stars
 *  cost to redraw is what the zoom has already decided they are worth drawing. */
const skyEvery = 4;
const starEveryCoarse = 6;
const starEveryMid = 3;
const starEveryNear = 2;
/** The zoom above which the star layer is worth drawing every other frame. */
const NEAR_Z = 1;
const starEvery = (coarse: boolean, z: number): number =>
  coarse ? starEveryCoarse : z < NEAR_Z ? starEveryMid : starEveryNear;
/** How far the camera must move to count, on screen: a quarter pixel, and two tenths of a percent. */
const MOVE_PX = 0.25;
const ZOOM_EPS = 0.002;
/** How long a focus change keeps the star layer at full rate — the fade it is drawing. */
const FADE_MS = 600;

/** What a frame tells the cadence about itself. */
export type RepaintState = {
  /** The camera's geometry this frame — where it is, and how far in. */
  view: Viewport;
  /** Every star is sub-pixel: the sky's coarsest regime, and its cheapest cadence. */
  coarse: boolean;
  /** The opening is still running: the stars are arriving and the camera is still easing. */
  intro: boolean;
  /** The instant a focus fade is over, or `0` while none has been asked for. */
  fadeUntil: number;
};

/** What the frame owes: the background pass, the star pass, or neither. */
export type RepaintPlan = { sky: boolean; stars: boolean };

export type UniverseRepaint = {
  /** Which layers this frame repaints. Called once a frame, and it keeps the frame's own count. */
  shouldRepaint(now: number, state: RepaintState): RepaintPlan;
  /** Something changed that the last frame's picture does not show. */
  markDirty(layer: 'sky' | 'stars'): void;
  /**
   * The instant a fade beginning at `now` is over — what the next frames pass back as their
   * `fadeUntil`. It is answered rather than remembered because the deadline outlives any one frame
   * and belongs to whoever asked for the fade; this file owns only how long one lasts.
   */
  markFade(now: number): number;
};

export function createRepaint(): UniverseRepaint {
  /** Frames since this cadence was made — the still cadences are counted on it, not on a clock. */
  let frames = 0;
  /** The camera of the last star repaint. `NaN` until one: the first frame is owed both layers. */
  let atX = Number.NaN;
  let atY = Number.NaN;
  let atZ = Number.NaN;
  let dirtySky = true;
  let dirtyStars = true;

  const moved = (view: Viewport): boolean => {
    if (Number.isNaN(atZ)) return true;
    const dx = Math.abs(view.x - atX) * view.z;
    const dy = Math.abs(view.y - atY) * view.z;
    const dz = Math.abs(view.z / atZ - 1);
    return dx > MOVE_PX || dy > MOVE_PX || dz > ZOOM_EPS;
  };

  const shouldRepaint = (now: number, state: RepaintState): RepaintPlan => {
    frames += 1;
    const walked = moved(state.view);
    // The key is rewritten only when the test passed, so a drift too small to see adds up across
    // frames rather than repainting ten thousand stars for a movement under the threshold.
    if (walked) {
      atX = state.view.x;
      atY = state.view.y;
      atZ = state.view.z;
    }
    const stars =
      walked || state.intro || dirtyStars || now < state.fadeUntil
      || frames % starEvery(state.coarse, state.view.z) === 0;
    const sky = walked || dirtySky || frames % skyEvery === 0;
    dirtyStars = false;
    dirtySky = false;
    return { sky, stars };
  };

  return {
    shouldRepaint,
    markDirty(layer) {
      if (layer === 'sky') dirtySky = true;
      else dirtyStars = true;
    },
    markFade(now) {
      return now + FADE_MS;
    },
  };
}
