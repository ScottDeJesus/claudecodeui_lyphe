import { nebulaColorOf } from '@/modules/universe/utils/universeTokens';
import type { Frame } from '@/modules/universe/utils/universeGraphPasses';
import type { UniverseGraphNode } from '@/modules/universe/utils/universeGraph';

/**
 * THE NEBULA EACH GALAXY SITS IN — a faint haze in the repo's own hue, filling the room its folders
 * occupy, drawn UNDER everything else on the star layer.
 *
 * THE HAZE IS THE REPO'S OWN SHAPE, NOT A DISC. Every body of a repo — the galaxy and the folders
 * under it, down to `NEBULA_DEPTH` — lays one soft puff over the room it holds (`reach`, centred on
 * the room's LIVE centre, `lx`/`ly`, carried onto where the body is drawn). Where folders crowd, their puffs overlap and the haze thickens;
 * where the repo is thin, so is its colour. Nothing is baked: the bodies orbit, so a haze painted
 * once would drift off the stars it belongs to, and a puff per body is a few hundred blits.
 *
 * NEVER ADDITIVE. The clouds' own history is the warning (`universeClouds`): a flat additive wash
 * over the dense regions turned the fitted view 70% pure white. Every puff here is `source-over`
 * at a low alpha, so overlapping haze converges on the repo's HUE and can never sum past it — the
 * densest knot of folders is the most saturated the nebula gets, and it is still a colour.
 *
 * TWO DEPTHS, AND THAT IS THE PARALLAX. Each body is drawn twice: a wide, faint puff on a sheet
 * that hangs BEHIND the galaxy and a tighter one in the galaxy's own plane. The far sheet is placed
 * by pulling every point toward the camera's centre (`FAR_DEPTH`), which is exactly what a layer
 * farther away does under a pan — it slides less than the stars in front of it — so the haze has
 * volume without a second camera. At the centre of the view the two sheets coincide; toward the
 * edges they part, and they part more the faster the camera moves.
 *
 * THE PUFF IS LOBED, NOT ROUND. A radial gradient alone reads as a spotlight. Each sprite is one
 * broad falloff plus a handful of off-centre lobes from a fixed seed, in `PUFF_VARIANTS` shapes; a
 * body takes the variant its id picks and is drawn turned by its own phase, so no two folders wear
 * the same cloud and the whole never tiles.
 */

/** How deep under a galaxy a folder still lays haze. Deeper folders are inside puffs already drawn. */
const NEBULA_DEPTH = 3;
/** The far sheet: how far toward the view's centre its points are pulled, how much wider and fainter. */
const FAR_DEPTH = 0.86;
const FAR_SPREAD = 1.55;
const FAR_ALPHA = 0.55;
/** A puff's radius as a multiple of the room it covers, and the smallest room worth a puff at all. */
const PUFF_REACH = 1.35;
const MIN_REACH = 14;
/** The haze a single puff lays at full intensity: the galaxy's own broad wash, then a folder's. */
const GALAXY_ALPHA = 0.26;
const FOLDER_ALPHA = 0.12;
/** Under this many screen pixels across a puff is a smudge nobody sees, and is skipped. */
const MIN_SCREEN_PX = 24;

const PUFF_SIZE = 192;
const PUFF_VARIANTS = 4;
const PUFF_LOBES = 7;
const TAU = 6.283185307179586;

/** A small repeatable generator — the puffs must be the same clouds on every load. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One lobed puff in `color`: a broad falloff with a few softer knots off its centre. */
function bakePuff(color: string, variant: number): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = PUFF_SIZE;
  tile.height = PUFF_SIZE;
  const g = tile.getContext('2d');
  if (g === null) return tile;

  const half = PUFF_SIZE / 2;
  const blob = (x: number, y: number, radius: number, alpha: number): void => {
    const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.45, color);
    gradient.addColorStop(1, 'transparent');
    // The middle stop is the colour at full strength, so the falloff is shaped by the alpha below
    // and by the lobes overlapping — a gradient's own midpoint cannot carry an alpha in a token.
    g.globalAlpha = alpha;
    g.fillStyle = gradient;
    g.beginPath();
    g.arc(x, y, radius, 0, TAU);
    g.fill();
  };

  const rng = seeded(0x9e3779b9 ^ (variant * 0x85ebca6b));
  blob(half, half, half, 0.5);
  for (let i = 0; i < PUFF_LOBES; i++) {
    const angle = rng() * TAU;
    const distance = half * (0.12 + rng() * 0.42);
    const radius = half * (0.22 + rng() * 0.3);
    // Every lobe stays inside the tile: a lobe cut by the tile's edge is a straight line in the sky.
    const reach = Math.min(radius, half - distance);
    blob(half + Math.cos(angle) * distance, half + Math.sin(angle) * distance, reach, 0.22 + rng() * 0.2);
  }
  return tile;
}

/** The baked puffs, by colour then variant. A palette is seven hues, so this holds a few dozen tiles. */
const puffs = new Map<string, HTMLCanvasElement[]>();
function puffFor(color: string, variant: number): HTMLCanvasElement {
  let set = puffs.get(color);
  if (set === undefined) {
    set = [];
    puffs.set(color, set);
  }
  return (set[variant] ??= bakePuff(color, variant));
}

/** Which bodies lay haze: a galaxy, the sun (a repo like any other) and the folders under them —
 *  never an endpoint or a file. */
function laysHaze(node: UniverseGraphNode): boolean {
  if (node.kind === 'galaxy' || node.kind === 'core') return true;
  return (node.kind === 'dir' || node.kind === 'system') && node.depth <= NEBULA_DEPTH;
}

/**
 * Every galaxy's nebula, inside the world transform and before anything else the star layer draws.
 * `intensity` is the tweak, `0..1`; at zero the pass does nothing at all.
 */
export function drawNebulae(frame: Frame, intensity: number): void {
  if (intensity <= 0) return;
  const { ctx, graph, view } = frame;
  const halfW = view.w / (2 * view.z);
  const halfH = view.h / (2 * view.z);

  ctx.globalCompositeOperation = 'source-over';
  for (const node of graph.bodies) {
    if (!laysHaze(node) || node.reach < MIN_REACH) continue;
    const radius = node.reach * PUFF_REACH;
    if (radius * 2 * view.z < MIN_SCREEN_PX) continue;

    // `lx`/`ly` is a WORLD position measured from the resting place `px`/`py`, so the room's offset
    // is carried onto the DRAWN position: the haze floats, tilts and wobbles with its galaxy.
    const x = node.x + (node.lx - node.px);
    const y = node.y + (node.ly - node.py);
    const base = (node.p === -1 ? GALAXY_ALPHA : FOLDER_ALPHA) * intensity * node.f;
    if (base <= 0.002) continue;
    const puff = puffFor(nebulaColorOf(node), node.id % PUFF_VARIANTS);

    // Far sheet first, so the near one sits over it. Each is culled on its own reach: a galaxy's
    // haze is on screen long before, and long after, the galaxy's own point is.
    const farX = view.x + (x - view.x) * FAR_DEPTH;
    const farY = view.y + (y - view.y) * FAR_DEPTH;
    const farR = radius * FAR_SPREAD;
    if (Math.abs(farX - view.x) < halfW + farR && Math.abs(farY - view.y) < halfH + farR) {
      stamp(ctx, puff, farX, farY, farR, node.ph + 1.7, base * FAR_ALPHA);
    }
    if (Math.abs(x - view.x) < halfW + radius && Math.abs(y - view.y) < halfH + radius) {
      stamp(ctx, puff, x, y, radius, node.ph, base);
    }
  }
  ctx.globalAlpha = 1;
}

/** One puff, centred, turned and scaled — the turn is what keeps four variants from reading as four. */
function stamp(
  ctx: CanvasRenderingContext2D,
  puff: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  turn: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  ctx.globalAlpha = alpha;
  ctx.drawImage(puff, -radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}
