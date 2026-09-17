/**
 * THE LAYERS THE SKY IS DRAWN ON — the five elements React renders, and the bitmaps behind them.
 *
 * REACT OWNS THE ELEMENTS; THIS FILE OWNS THEIR BITMAPS. The stack is five surfaces in one box,
 * bottom to top: the sky, the stars, the GL layer Phase 5 will draw on, the live layer and the
 * input layer the pointer reads. Those elements are JSX in `UniverseCanvas` — the page must show
 * the tree React rendered, so nothing here makes one — and what is here is what a frame needs from
 * them: the drawing surfaces, however big the box is this second, and the one clear every layer
 * runs before it paints.
 *
 * WHY A LAYER IS CLEARED AT ALL, AND WHY THE CLEAR IS THIS FILE'S. On one canvas a frame painted
 * over the last one; on five, the layer being repainted has to be wiped first or last frame's stars
 * stay under this frame's. And the wipe has to be exact: `clearRect` is measured in the transform's
 * own units, so a clear issued while the camera's scale is set wipes a rectangle of the world and
 * leaves the corners holding the old sky. The transform goes back to the box's ratio first, which
 * is why the ratio arrives here as an argument rather than being read off the element.
 *
 * ONE BOX, FIVE BITMAPS. Every layer is sized from the INPUT layer's box — the one the pointer
 * reads and the one the ResizeObserver watches — so a resized window moves all five bitmaps in the
 * same instant, and no layer is ever a stretched copy of another. Sizing an element whose box is a
 * percentage of its container does not move that box, so this never feeds the observer.
 */

/** The five elements the stack is made of. `null` while React has not attached them yet. */
export type LayerRefs = {
  sky: HTMLCanvasElement | null;
  stars: HTMLCanvasElement | null;
  /** The GL layer: sized and stacked here, drawn on by Phase 5 and by nothing before it. */
  gl: HTMLCanvasElement | null;
  live: HTMLCanvasElement | null;
  /** The layer the hand is on — what `canvasRef` points at and the pointer effect attaches to. */
  input: HTMLCanvasElement | null;
};

/** The stack as a frame asks for it: three drawing surfaces, the GL element, and the one sizing. */
export type UniverseLayers = {
  sky: CanvasRenderingContext2D;
  stars: CanvasRenderingContext2D;
  live: CanvasRenderingContext2D;
  gl: HTMLCanvasElement;
  /** Every bitmap, identically, at the ratio a frame will draw at. */
  size(dpr: number): void;
};

/**
 * The stack's contexts, or `null` when an element is missing or refused a context — a canvas the
 * browser would not hand a 2D surface to is a sky that cannot be drawn, and the caller's loop has
 * nothing to do with it.
 */
export function createLayers(refs: LayerRefs): UniverseLayers | null {
  const { sky, stars, gl, live, input } = refs;
  if (sky === null || stars === null || gl === null || live === null || input === null) return null;
  const skyCtx = sky.getContext('2d');
  const starsCtx = stars.getContext('2d');
  const liveCtx = live.getContext('2d');
  if (skyCtx === null || starsCtx === null || liveCtx === null) return null;

  return {
    sky: skyCtx,
    stars: starsCtx,
    live: liveCtx,
    gl,

    size(dpr) {
      const rect = input.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      for (const layer of [sky, stars, gl, live, input]) {
        layer.width = w;
        layer.height = h;
      }
    },
  };
}

/**
 * The one clear, shared by every layer: the transform back to the box's own ratio, the alpha and
 * the blend mode back to their defaults — so a layer repainted after an additive pass starts from
 * nothing — and the whole CSS box wiped. `w` and `h` are that box in CSS pixels and `dpr` the
 * ratio `size` was last given; the wipe is the box under the ratio, which is exactly the bitmap.
 */
export function clear(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
}
