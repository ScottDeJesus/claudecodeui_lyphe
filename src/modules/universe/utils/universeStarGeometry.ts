import type { UniverseGraphNode } from '@/modules/universe/utils/universeGraph';

/**
 * WHAT A STAR LOOKS LIKE — the size and the strength of every light the sky draws, as numbers.
 *
 * ONE HOME, TWO READERS. The 2D passes ask this file what a star's disc, its glow and its flare
 * come to; the GPU star layer (Phase 5) asks it the same questions and writes the answers into a
 * buffer. Both draw the same sky, so the arithmetic that decides how big a light is and how bright
 * may exist exactly once — a second copy would be a second sky the moment one of them was tuned.
 *
 * NOTHING HERE KNOWS HOW TO PAINT. No drawing surface, no frame, no palette: every function takes a
 * node and the numbers a frame would have handed it — the clock, a flare's remaining strength, the
 * doppler tweak — and returns numbers. That is what lets a Node script import it, and what makes a
 * change here provably a change to a formula rather than to a pass.
 *
 * THE DISPLAY FACTORS ARE THE LAYOUT'S, NOT THIS FILE'S. `ds`, `da`, `tk` and `bl` are written by
 * `stepLayout` each frame — the depth's shrink and dim, the twinkle, the blur of a star off the
 * focal plane — and they are read here exactly as the passes read them: the layout moves a star,
 * and every light hanging off it is scaled by the same factors whichever path draws it.
 *
 * WHAT CHANGED ON THE WAY IN, AND WHAT DID NOT. The disc, the glow, the bokeh, the flare's ring and
 * the colour swing are byte-for-byte the formulas the two passes carried. One thing changed, and the
 * plan names it: the glow no longer grows for a flare — `drawGlow` passes `0` for every star — and
 * the flare's halo, which the single canvas had no equivalent of, is drawn from the numbers below on
 * the live layer, which is the one place a flare's look now lives.
 */

/** The glow an order of magnitude over a star's own radius, by what the node is. */
const GLOW_MULT: Record<string, number> = { core: 8, galaxy: 5.5, dir: 4, endpoint: 4, docs: 2.4 };
const GLOW_MULT_DEFAULT = 3.2;
/** What the glow is drawn at, before the focus and depth factors narrow it. */
const GLOW_ALPHA: Record<string, number> = { core: 0.7, galaxy: 0.55, dir: 0.35 };
const GLOW_ALPHA_DEFAULT = 0.4;
/** The bokeh an out-of-focus star spreads into, at its deepest — and how blurred it must be first. */
const BOKEH_ALPHA = 0.6;
const BOKEH_BLUR = 0.15;
/** How far a star's own disc is pulled in while it is off the focal plane. */
const BLUR_SHRINK = 0.55;
/** The flare: how far its halo reaches over the glow it still wears, how bright it is, and the ring
 *  that grows as what is left of the flare goes out. */
const FLARE_HALO_MULT = 1.3;
const FLARE_HALO_ALPHA = 0.5;
const FLARE_RING = 30;
const FLARE_RING_GAP = 2;
const FLARE_ALPHA = 0.7;
/** How long a glow and a disc take to breathe once, in milliseconds. */
const BREATH_MS = 1100;
/** The screen size, in pixels, under which a star is dust rather than a disc. */
const DUST_PX = 1.5;

/**
 * The one of the tables below a pass reads for itself: the glow pass tests a sprite's world size
 * through its kind's own reach — over a couple of pixels it blits a cache, under it draws nothing —
 * so the reach travels with the shape it decides rather than being copied beside it.
 */
export { GLOW_MULT, GLOW_MULT_DEFAULT };

/** How large a light is drawn and how strong it is: what every function here answers with. */
export type StarShape = { radius: number; alpha: number };

/**
 * The glow around a star — the sprite blit that makes it read as a light rather than a disc. The
 * flare multiplies it exactly as the glow pass used to: a star burning from an edit is wider and
 * brighter, and passes `0` for every star that is not.
 */
export function glowOf(node: UniverseGraphNode, now: number, flare: number): StarShape {
  const mult = GLOW_MULT[node.kind] ?? GLOW_MULT_DEFAULT;
  const radius =
    mult * node.r * (1 + 0.08 * Math.sin(now / BREATH_MS + node.ph)) * (1 + flare * 1.3) * node.ds * node.tk;
  const alpha = Math.min(
    1,
    (GLOW_ALPHA[node.kind] ?? GLOW_ALPHA_DEFAULT) * node.f * (1 + flare) * node.da * node.tk,
  );
  return { radius, alpha };
}

/**
 * The soft disc a star spreads into when it is off the focal plane, or `null` for a star the depth
 * of field left sharp. The caller decides whether anything is drawn at all — the pass draws no
 * bokeh for a sprite under a couple of pixels, because a blur nothing can see is a blit for nothing.
 */
export function bokehOf(node: UniverseGraphNode): StarShape | null {
  if (node.bl <= BOKEH_BLUR) return null;
  const radius = node.r * node.ds * (1.2 + 3 * node.bl);
  const alpha = Math.min(1, BOKEH_ALPHA * node.bl * Math.max(0.15, node.f));
  return { radius, alpha };
}

/**
 * The star's own disc: its radius, which takes in as the star goes off the focal plane, and the
 * depth's alpha — the three bands a settled star is quantised into so neighbours batch together.
 * Documents and directories are drawn a shade under full, which the frame that fills the disc
 * applies to both this and its own blend, so the two paths answer with the same light.
 */
export function coreOf(node: UniverseGraphNode, now: number): StarShape {
  const radius =
    node.r * (1 + 0.05 * Math.sin(now / BREATH_MS + node.ph)) * node.ds * node.tk * (1 - BLUR_SHRINK * node.bl);
  const alpha = node.da > 0.9 ? 1 : node.da > 0.65 ? 0.78 : 0.55;
  return { radius, alpha };
}

/**
 * The halo a flare throws — an edit's own light, laid over the glow the star is already wearing.
 * Its reach is the glow's own reach scaled by what is left of the flare, so the halo and the glow
 * under it are the same shape at two strengths rather than two different lights.
 */
export function flareHalo(node: UniverseGraphNode, flare: number): StarShape {
  const mult = GLOW_MULT[node.kind] ?? GLOW_MULT_DEFAULT;
  const radius = mult * node.r * node.ds * flare * FLARE_HALO_MULT;
  return { radius, alpha: FLARE_HALO_ALPHA * flare * node.f };
}

/**
 * The ring a burning flare wears, clearing the star by a gap and closing in as the flare goes out.
 * Its radius is the DISC's own, breath and all: the ring rings the star, so the two must widen and
 * narrow together, and a ring built on a radius without the breath would sit up to five per cent
 * narrower than the disc it is drawn around, in lockstep with neither.
 */
export function flareRing(node: UniverseGraphNode, flare: number, now: number): StarShape {
  const disc =
    node.r * (1 + 0.05 * Math.sin(now / BREATH_MS + node.ph)) * node.ds * node.tk * (1 - BLUR_SHRINK * node.bl);
  return { radius: disc + FLARE_RING_GAP + FLARE_RING * (1 - flare), alpha: flare * FLARE_ALPHA * node.f };
}

/**
 * The token a star's colour is swung to while the doppler tweak is on and the star is crossing the
 * depth faster than the eye can follow — cool toward the reader, warm away from them — or `null`
 * for a star whose own kind's colour is what it wears. The frame resolves the name; this file never
 * reads a palette.
 */
export function dopplerSwing(node: UniverseGraphNode, doppler: number): '--info-ink' | '--warn-ink' | null {
  const slide = node.vz * doppler;
  return slide > 1 ? '--info-ink' : slide < -1 ? '--warn-ink' : null;
}

/**
 * Whether a star has shrunk to dust at this zoom — under a pixel and a half across, so it reads as
 * a speck in the grain rather than as a body with a disc. The GPU layer draws these as points and
 * the 2D passes leave them to the stardust; both ask here so the two agree on which stars they are.
 */
export function isDustRegime(node: UniverseGraphNode, z: number): boolean {
  return node.r * z < DUST_PX;
}
