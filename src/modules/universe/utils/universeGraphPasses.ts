import { bandedBrightness, colorForNode, tokenOf } from '@/modules/universe/utils/universeTokens';
import { isFile } from '@/modules/universe/utils/universeGraph';
import {
  GLOW_MULT,
  GLOW_MULT_DEFAULT,
  bokehOf,
  glowOf,
} from '@/modules/universe/utils/universeStarGeometry';
import { SCREEN_PAD, viewportBounds } from '@/modules/universe/utils/universeView';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseSky } from '@/modules/universe/utils/universeSky';
import type { UniverseCamera, Viewport } from '@/modules/universe/utils/universeView';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * THE STRATA UNDER THE STARS — the edges between them, the trails they leave and the dust they
 * carry, and the glow each one casts. Everything here is inside the world transform, so a pass may
 * work in world units and never touches the canvas' scale. The stars themselves, and the selection
 * ring over them, are `universeStarlight`.
 *
 * WHAT IS BATCHED, AND WHY IT HAS TO BE. Ten thousand edges drawn one `stroke` at a time, and their
 * nodes the same, is a canvas that stutters; an edge that has settled — both its ends fully focused
 * — is collected into ONE path per kind and stroked once, and the dust likewise into one path per
 * kind and colour. What is left on its own is what has something to say: the neighbourhood of a
 * selection, an edge still fading in. A glow cannot be batched at all, since each is a sprite blit,
 * so the pass skips anything whose sprite would land under a couple of pixels across — and blits
 * anything small from the quarter-size sprite cache rather than the large one.
 *
 * WHAT A PASS MAY READ, AND WHAT IT MAY NOT. The frame's clock, the display fields the layout
 * wrote (`ds`, `da`, `tk`, `bl`, `f`, `occ`) and the live flares are all this file may draw from —
 * a pass never samples a tweak it was not handed, never rebuilds a graph and never reads the
 * document. What a star LOOKS like is not here either: `universeStarGeometry` answers the disc,
 * the glow and the bokeh, and both the passes below and the GPU layer read it there.
 *
 * WHAT A PASS WALKS, AND WHAT IT MEASURES AGAINST. `makeFrame` is the one frame builder: it turns
 * the viewport the owner hands in into the frame's two rectangles — the view itself, and the view
 * grown by `SCREEN_PAD`, which is what `visible()` admits a node inside. The passes below walk
 * `graph.act` — the bodies, plus the files of a body the camera can see — rather than every node in
 * the estate. Edges are the exception, because a link follows the model rather than the camera: when
 * the sky is coarse a link whose two ends are both files is dropped, since both ends are points no
 * frame is drawing.
 */

/** One frame, as every pass receives it: the canvas, the model, and the frame's own measurements. */
export type Frame = {
  ctx: CanvasRenderingContext2D;
  graph: UniverseGraph;
  /** The owner's camera — the passes that project to the screen (a label's position, a comet's
   *  zoom) still need it, and the canvas' own transform is set from it before the world is drawn. */
  camera: UniverseCamera;
  /** The camera's geometry as the frame's own rectangle: what the bounds and `visible()` are built
   *  from, and the zoom a pass reads when it means the viewport rather than the projection. */
  view: Viewport;
  tokens: UniverseTokens;
  tweaks: UniverseTweaks;
  /** The frame's clock, in epoch milliseconds — the same clock the flares are stamped on. */
  now: number;
  /** The live flares by node index, empty on a quiet sky — and empty by construction on the star
   *  layer, which draws no flare and hands the frame one shared empty map for the whole of its life. */
  flares: Map<number, number>;
  /** Which nodes `SCREEN_PAD` inside the viewport, padded so a glow may spill in from off-screen. */
  visible(node: UniverseGraphNode): boolean;
  /** The viewport's world bounds, UNPADDED — what a pass tests a point it is carrying against. */
  bounds: { x0: number; y0: number; x1: number; y1: number };
};

/** How bright an edge is drawn, by kind: the tree is the galaxy's skeleton, a cross edge is a
 *  hint. A highlighted edge is drawn at the accent instead, and much brighter. */
const EDGE_ALPHA: Record<string, number> = { tree: 0.17, import: 0.09, cochange: 0.09, endpoint: 0.09 };
const EDGE_HOT_ALPHA = 0.4;
const EDGE_WIDTH = 0.9;
const EDGE_HOT_WIDTH = 1.4;
/** The dash a cross edge carries, in world units, and the accent a highlighted one is drawn in. */
const EDGE_DASH = [2, 5];
const EDGE_HOT_TOKEN = '--accent';
const EDGE_TOKEN = '--ink-muted';

/** The four alpha bands a trail is stroked in, faintest first — a tail that fades to nothing. */
const TRAIL_BANDS = [0.05, 0.11, 0.19, 0.3];
/** How far a trail sways as it hangs — the export's own amplitude for a file's tail. */
const TRAIL_SWAY = 2.6;
const TRAIL_WIDTH = 0.8;
/** The kinds a trail may hang off, in the order the passes run. A body never trails. */
const TRAIL_KINDS = ['source', 'config', 'docs', 'data-sql', 'assets', 'other'] as const;

/** The dust: how many specks ride each star, how far out, and how fast they shimmer. */
const DUST_MIN = 3;
const DUST_SPREAD = 4;
const DUST_INNER = 4;
const DUST_OUTER = 26;
const DUST_ALPHA = 0.42;
const DUST_RATE = 0.0016;

/** The golden angle, for the dust's own ladder — a fixed spread rather than a random one. */
const GOLDEN_ANGLE = 2.39996;

const fract = (value: number): number => value - Math.floor(value);

/**
 * ONE FRAME, BUILT ONCE — the canvas, the model and the frame's own measurements in one object, so
 * every pass measures the sky against the same rectangle. The rectangle is `viewportBounds`'s, the
 * one arithmetic the regimes build the active list from too: a pass that draws a star and a regime
 * that carries it are answering about the same world.
 *
 * THE FRAME CARRIES TWO RECTANGLES, AND THE PAD IS THE DIFFERENCE. `bounds` is the viewport itself,
 * unpadded — what the comet pass tests a head against, deliberately loose, so a leg leaving the view
 * is drawn on its way out. `visible()` is that rectangle grown by the one `SCREEN_PAD`, which is what
 * a pass draws inside: a glow may spill in from off-screen, and a star crossing the edge is drawn
 * before its centre is on the canvas. The regimes marked the active list with the same pad, so a
 * node `visible()` admits is a node some frame simulated.
 */
export function makeFrame(
  ctx: CanvasRenderingContext2D,
  graph: UniverseGraph,
  camera: UniverseCamera,
  view: Viewport,
  tokens: UniverseTokens,
  tweaks: UniverseTweaks,
  now: number,
  flares: Map<number, number>,
): Frame {
  const bounds = viewportBounds(view, 0);
  const visible = (node: UniverseGraphNode): boolean =>
    node.x > bounds.x0 - SCREEN_PAD &&
    node.x < bounds.x1 + SCREEN_PAD &&
    node.y > bounds.y0 - SCREEN_PAD &&
    node.y < bounds.y1 + SCREEN_PAD;
  return { ctx, graph, camera, view, tokens, tweaks, now, flares, visible, bounds };
}

/**
 * The edges of the tree, and the cross edges between packages.
 *
 * A SETTLED EDGE IS BATCHED, where settled means both ends are fully focused — what is left
 * unbatched is the neighbourhood of a selection, which is exactly what has to be drawn hot. The
 * batch is one path per kind, because the dash and the alpha are the kind's; the stroke happens
 * once, at the end, for each kind that collected anything.
 */
export function drawEdges(frame: Frame): void {
  const { ctx, graph, tokens, tweaks } = frame;
  const z = frame.view.z;
  const mode = tweaks.edges;
  const focus = graph.focus;
  const focused = focus === null ? undefined : graph.nodes[focus];
  const near = focused === undefined ? null : new Set<number>([focused.id, ...focused.adj]);
  const batches = new Map<string, Path2D>();
  const ink = tokenOf(tokens, EDGE_TOKEN);
  const hot = tokenOf(tokens, EDGE_HOT_TOKEN);
  const width = EDGE_WIDTH / Math.sqrt(z);

  ctx.lineCap = 'round';
  for (const link of graph.links) {
    const a = graph.nodes[link.a];
    const b = graph.nodes[link.b];
    if (a === undefined || b === undefined) continue;
    // Coarse, a link between two files is a line between two points the frame neither simulates nor
    // draws — under a pixel, and at the fitted view there are thousands of them. The tree links stay:
    // they are what holds the shapes a visitor is actually looking at together.
    if (graph.coarse && isFile(a) && isFile(b)) continue;
    if (!frame.visible(a) && !frame.visible(b)) continue;
    const touched = near !== null && near.has(link.a) && near.has(link.b);
    if (!touched && mode !== 'all' && mode !== link.kind) continue;
    const focusFactor = Math.min(a.f, b.f);
    if (!touched && focusFactor > 0.98) {
      // The whole layer in one path: a settled edge is drawn in the kind's own ink, and the
      // stroke below is what gives it its alpha, its dash and its width.
      const path = batches.get(link.kind) ?? batches.set(link.kind, new Path2D()).get(link.kind);
      if (path === undefined) continue;
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
      continue;
    }
    ctx.strokeStyle = touched ? hot : ink;
    ctx.globalAlpha = (EDGE_ALPHA[link.kind] ?? EDGE_ALPHA.import) * focusFactor + (touched ? EDGE_HOT_ALPHA : 0);
    ctx.lineWidth = (touched ? EDGE_HOT_WIDTH : EDGE_WIDTH) / Math.sqrt(z);
    ctx.setLineDash(link.kind === 'tree' ? [] : [EDGE_DASH[0] / z, EDGE_DASH[1] / z]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  for (const [kind, path] of batches) {
    ctx.globalAlpha = EDGE_ALPHA[kind] ?? EDGE_ALPHA.import;
    ctx.setLineDash(kind === 'tree' ? [] : [EDGE_DASH[0] / z, EDGE_DASH[1] / z]);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/**
 * The trails a star leaves — sampled by the layout on a fixed cadence, drawn here as four alpha
 * bands so the tail fades to nothing. Off-plane stars drift with the camera, the same parallax
 * their own position carries, so a trail hangs behind the star rather than beside it.
 */
export function drawTrails(frame: Frame): void {
  const { ctx, graph, tokens, tweaks } = frame;
  const z = frame.view.z;
  const parallax = tweaks.parallax;
  const view = frame.view;
  ctx.lineWidth = TRAIL_WIDTH / Math.sqrt(z);
  ctx.lineJoin = 'round';

  for (const kind of TRAIL_KINDS) {
    const bands = TRAIL_BANDS.map(() => new Path2D());
    let any = false;
    for (const node of graph.act) {
      const trail = node.tr;
      if (node.kind !== kind || trail === null || trail.length < 4 || node.f < 0.5) continue;
      if (!frame.visible(node)) continue;
      const drift = node.pzd * parallax;
      const fx = TRAIL_SWAY * Math.sin(frame.now / 5200 + node.ph);
      const fy = TRAIL_SWAY * Math.cos(frame.now / 6300 + node.ph * 1.3);
      any = true;
      const points = trail.length / 2;
      let previous = -1;
      for (let i = 0; i < points; i++) {
        const band = Math.min(TRAIL_BANDS.length - 1, Math.floor((i / points) * TRAIL_BANDS.length));
        const px = (trail[i * 2] ?? 0) + fx + ((trail[i * 2] ?? 0) - view.x) * drift;
        const py = (trail[i * 2 + 1] ?? 0) + fy + ((trail[i * 2 + 1] ?? 0) - view.y) * drift;
        // A sample joins the band its age falls in, and the seam is bridged into the band behind
        // it, so the four strokes stack into one unbroken tail rather than four broken ones.
        if (band !== previous) {
          bands[band].moveTo(px, py);
          if (previous >= 0) bands[previous].lineTo(px, py);
        } else {
          bands[band].lineTo(px, py);
        }
        previous = band;
      }
      // The newest sample is the star's own shoulder: the tail ends where the star is now.
      bands[TRAIL_BANDS.length - 1].lineTo(node.x, node.y);
    }
    if (!any) continue;
    ctx.strokeStyle = colorForNode({ kind }, tokens, 1);
    bands.forEach((path, band) => {
      ctx.globalAlpha = TRAIL_BANDS[band];
      ctx.stroke(path);
    });
  }
  ctx.globalAlpha = 1;
}

/**
 * The dust riding each star — a few faint specks, in the star's own colour, shimmering on their
 * own clock. Batched by kind and brightness band for the same reason the stars are: the specks are
 * decoration, and a star that cannot be seen from the camera's place does not pay for them.
 */
export function drawStardust(frame: Frame): void {
  const { ctx, graph, tokens, tweaks, now } = frame;
  const z = frame.view.z;
  const size = Math.max(0.45, 0.85 / Math.sqrt(z));
  const batches = new Map<string, { path: Path2D; color: string }>();

  for (const node of graph.act) {
    if (!isFile(node) || node.f < 0.5 || !frame.visible(node)) continue;
    const color = colorForNode(node, tokens, bandedBrightness(node, now, tweaks));
    const key = `${node.kind}|${color}`;
    let batch = batches.get(key);
    if (batch === undefined) {
      batch = { path: new Path2D(), color };
      batches.set(key, batch);
    }
    const specks = DUST_MIN + (node.id % DUST_SPREAD);
    for (let i = 0; i < specks; i++) {
      const angle = node.ph + i * GOLDEN_ANGLE;
      const reach = DUST_INNER + fract(node.oa + i * 0.37) * DUST_OUTER * (0.8 + node.r / 5);
      const twinkle = size * (0.55 + 0.45 * Math.sin(now * DUST_RATE + angle));
      batch.path.rect(
        node.x + Math.cos(angle) * reach - twinkle,
        node.y + Math.sin(angle) * reach - twinkle,
        twinkle * 2,
        twinkle * 2,
      );
    }
  }

  ctx.globalAlpha = DUST_ALPHA;
  for (const batch of batches.values()) {
    ctx.fillStyle = batch.color;
    ctx.fill(batch.path);
  }
  ctx.globalAlpha = 1;
}

/**
 * The glow around every visible star — the sprite blit that makes a star read as a light rather
 * than a disc. Drawn additively, and skipped whole for a file whose sprite would be under a couple
 * of pixels across, which is what keeps ten thousand of them affordable.
 *
 * THE FLARE IS NOT HERE. A burning star used to widen and brighten its own glow; it no longer does,
 * because a flare is not the star layer's to draw — it is a live layer's, and `drawFlares` in
 * `universeStarlight` is its one home. A star that flared under this pass would drag the whole
 * sheet of stars onto the live layer's cadence to move one ring.
 *
 * AND A SMALL SPRITE IS BLITTED SMALL. Under six screen pixels a glow is drawn from the quarter-size
 * cache: the 128 px tile would be sixteen times the texels for a picture narrower than a thumb, and
 * the sampler has nothing to resolve there anyway.
 */
export function drawGlow(frame: Frame, sky: UniverseSky, bokeh: boolean): void {
  const { ctx, graph, tokens, now } = frame;
  const z = frame.view.z;
  const ink = tokenOf(tokens, '--ink');
  ctx.globalCompositeOperation = 'lighter';

  for (const node of graph.act) {
    if (!frame.visible(node)) continue;
    const mult = GLOW_MULT[node.kind] ?? GLOW_MULT_DEFAULT;
    if (isFile(node) && node.r * mult * z < 2.5) continue;
    const glow = glowOf(node, now, 0);
    const color = colorForNode(node, tokens, 1);
    ctx.globalAlpha = glow.alpha;
    const sprite = glow.radius * z < 6 ? sky.small(color) : sky.sprite(color);
    ctx.drawImage(sprite, node.x - glow.radius, node.y - glow.radius, glow.radius * 2, glow.radius * 2);
    // An out-of-focus star spreads into a soft disc of its own colour — but only where the disc is
    // a disc: under a couple of pixels the spread is the sprite's own falloff, drawn twice.
    if (bokeh && node.r * z >= 2) {
      const disc = bokehOf(node);
      if (disc !== null) {
        ctx.globalAlpha = disc.alpha;
        ctx.drawImage(sky.sprite(color), node.x - disc.radius, node.y - disc.radius, disc.radius * 2, disc.radius * 2);
      }
    }
    // The sun gets a bright core of the plainest ink, so it reads as the centre of everything.
    if (node.kind === 'core') {
      ctx.globalAlpha = 0.9;
      const core = node.r * 2.6;
      ctx.drawImage(sky.sprite(ink), node.x - core, node.y - core, core * 2, core * 2);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
