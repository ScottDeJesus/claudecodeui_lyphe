import { drawBackground } from '@/modules/universe/utils/universeBackground';
import { drawClouds } from '@/modules/universe/utils/universeClouds';
import { drawComets, heavyStars } from '@/modules/universe/utils/universeComets';
import { isFile } from '@/modules/universe/utils/universeGraph';
import {
  drawEdges,
  drawGlow,
  drawStardust,
  drawTrails,
  makeFrame,
} from '@/modules/universe/utils/universeGraphPasses';
import { clear } from '@/modules/universe/utils/universeLayers';
import { bokehOf, coreOf, dopplerSwing, glowOf } from '@/modules/universe/utils/universeStarGeometry';
import { CORE_IRIS_ALPHA, CORE_IRIS_RADII, KIND_DIM, discAlphaOf } from '@/modules/universe/utils/universeStarsGL';
import { drawCores, drawFlares, drawSelectionRing } from '@/modules/universe/utils/universeStarlight';
import { bandedBrightness, colorForNode, glowColorOf, tokenOf } from '@/modules/universe/utils/universeTokens';
import { worldToScreen } from '@/modules/universe/utils/universeView';
import type { Cloud } from '@/modules/universe/utils/universeClouds';
import type { Frame } from '@/modules/universe/utils/universeGraphPasses';
import type { StarsGL } from '@/modules/universe/utils/universeStarsGL';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseSky } from '@/modules/universe/utils/universeSky';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseCamera, Viewport } from '@/modules/universe/utils/universeView';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import type { UniversePulses } from '@/modules/universe/utils/universePulses';

/**
 * ONE FRAME OF THE ESTATE SKY, CUT INTO THE LAYERS IT IS DRAWN ON.
 *
 * THE STACK IS THE Z ORDER, AND EVERY LAYER PAINTS ITS OWN SLICE OF IT. Bottom to top:
 *
 * | layer | passes | repainted when |
 * |---|---|---|
 * | sky | the wash, the milky way, the parallax fields, the twinklers | the camera moved, `dirtySky`, else every 4th frame |
 * | stars | edges, trails, dust, glow, the clouds when coarse, the stars | the camera moved, the intro, `dirtyStars`, a focus fade, else every 2nd frame (6 coarse, 3 under z 1) |
 * | gl | the glow and the disc of every star that fits a GPU point, in one draw | with the stars |
 * | live | comets, flares, the selection ring, the labels | every frame |
 * | input | nothing at all: the surface the pointer reads | never |
 *
 * EVERY CALL CLEARS BEFORE IT DRAWS, AND THAT IS WHAT MAKES SKIPPING FREE. On one surface a frame
 * painted over the last one, so a pass could be skipped only by leaving a hole in the picture; on
 * the stack a layer that is not repainted keeps the picture the last one left, and what is skipped
 * is the whole cost of redrawing it. The clear is `universeLayers`' and drops the transform with
 * it, so each layer starts in the box's own pixels rather than in whatever the last pass left.
 *
 * WHAT THIS FILE DOES NOT DECIDE. Which layers a frame owes is `universeRepaint`'s, and whether a
 * frame happens at all is `universeLoop`'s. This draws what it is handed, when it is told to.
 *
 * THE SKY AND THE VIEWPORT ARE THE OWNER'S. The sky is made once by the component that owns the
 * stack — it holds the tiles, the field and the sprite caches the clouds and the stars
 * all borrow — and it arrives here as an argument rather than being found through a singleton. The
 * viewport arrives the same way, and the frame this file builds from it is the one every pass
 * measures its `visible()` against.
 *
 * WHAT IS GATED, AND WHAT A GATE COSTS. A tuning at zero — trails, depth of field, lensing,
 * doppler, no edges, no labels — is read once, here, around the pass it silences, so the frame pays
 * for the work it will draw and never for the work it will not: an estate with lensing off never
 * walks the heavy-star list for a comet that would arrive straight. The tweaks object is read fresh
 * every frame and never cached, because it is the panel's live state.
 *
 * THE PALETTE ARRIVES, IT IS NOT READ. Asking the document for a custom property forces a style
 * recalculation and no frame may pay for one; the owner reads the tokens once per palette (see
 * `universeTokens`) and hands the same object in, which is also what makes a theme flip a repaint
 * rather than a per-node lookup. No colour is spelled out in this file either: every stroke and
 * every fill is the token the design system named, and a missing one resolves through `tokenOf`.
 *
 * WHAT THE FRAME SAYS. A star's brightness is how recently git saw it change, and the instant is
 * the crawler's own: every node carries `t`, its newest commit in epoch SECONDS, and the curve
 * converts the unit at the one place that knows it.
 */

/** The fonts the labels are set in — the two the design system's own display faces are named by. */
const CORE_FONT = 'italic 22px "Instrument Serif", Georgia, serif';
const BODY_FONT = '500 13px "Schibsted Grotesk", system-ui, sans-serif';
/** The body font's size in CSS pixels — the height a placed name's box is tested at. */
const BODY_FONT_PX = 13;
const DIM_FONT = '500 11.5px "Schibsted Grotesk", system-ui, sans-serif';
const FILE_FONT = '400 11.5px "Schibsted Grotesk", system-ui, sans-serif';
/** How far a label clears its star, in CSS pixels. */
const LABEL_GAP = 6;
const LABEL_GAP_BODY = 9;
const LABEL_GAP_CORE = 12;
/** The zoom a body's label has faded in by, its span, and the zoom a file's label starts at. */
const BODY_FADE_FROM = 0.2;
const BODY_FADE_SPAN = 0.25;
const FILE_LABEL_ZOOM = 1.7;
/** The zoom past which a directory stops being labelled, because its children's names rule. */
const DIR_LABEL_ZOOM = 1.1;
/** The most neighbours a focus may name. A hover names the node under the hand and the nodes it
 *  touches — and a database touches five hundred stars, a repo fifty, so a hand crossing one threw
 *  every name in the neighbourhood onto the sky at once (operator, 2026-09-17: "all of the titles
 *  pop up and it's illegible"). Past this many, only the focus itself is named. */
const LIT_LABELS_MAX = 24;
/** The zoom an integration folder's name starts to fade in at, and the span it fades over: absent
 *  at the fitted view (0.04 on the merged map), whole by a third of a power in — before a plain
 *  directory's name (`DIR_LABEL_ZOOM`), since the integrations are the reason a visitor zooms. */
const SYSTEM_LABEL_FROM = 0.22;
const SYSTEM_LABEL_SPAN = 0.28;

/**
 * The star layer's flares: one empty map, made once and handed to every frame the star layer
 * builds. Nothing on that layer draws a flare — the halo and the ring are the live layer's — so the
 * map is a constant rather than a per-frame allocation, and it says so at every call site.
 */
const NO_FLARES: Map<number, number> = new Map();

/**
 * The background, and the whole of it: the wash the world is drawn over, the milky way, the
 * parallax fields. It is the only pass that paints in the box's own pixels, which
 * is why the sky layer never carries the world transform.
 */
export function drawSky(
  ctx: CanvasRenderingContext2D,
  sky: UniverseSky,
  camera: UniverseCamera,
  tokens: UniverseTokens,
  tweaks: UniverseTweaks,
  now: number,
): void {
  clear(ctx, camera.w, camera.h, camera.dpr);
  drawBackground(ctx, sky, camera, tokens, tweaks.milkyWay, now);
}

/**
 * Everything that hangs between the background and the stars: the edges, their trails, the dust,
 * the glow each star casts, the clouds that stand in for the stars when the view is coarse, and the
 * stars themselves. All of it is inside the world transform, and none of it is a flare.
 *
 * WHICH PATH DRAWS THE STARS IS THE CALLER'S ANSWER, NOT THIS FILE'S. A renderer arrives here only
 * when the owner has one and the tweak asks for it; with one, the glow and the disc of every star a
 * GPU point can carry are one draw on the GL layer above, and the handful of stars too wide for a
 * point come back from that draw to be painted below exactly as they always were. With `null` the
 * two 2D passes run whole. This file reads no tweak for it, so there is one reader of that flag and
 * one answer to what the frame is drawn with.
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  sky: UniverseSky,
  graph: UniverseGraph,
  camera: UniverseCamera,
  view: Viewport,
  tokens: UniverseTokens,
  tweaks: UniverseTweaks,
  clouds: Map<number, Cloud>,
  now: number,
  gl: StarsGL | null,
): void {
  clear(ctx, camera.w, camera.h, camera.dpr);
  const frame = makeFrame(ctx, graph, camera, view, tokens, tweaks, now, NO_FLARES);
  worldTransform(ctx, view);

  if (tweaks.edges !== 'none') drawEdges(frame);
  if (tweaks.trails > 0) drawTrails(frame);
  drawStardust(frame);
  if (gl !== null) {
    const leftovers = gl.draw(graph, view, tokens, tweaks, now);
    if (graph.coarse) drawClouds(frame, clouds);
    drawLeftovers(frame, leftovers, sky, tweaks.depthOfField > 0);
    return;
  }
  drawGlow(frame, sky, tweaks.depthOfField > 0);
  // Coarse, no star is drawn at all — the files are sub-pixel. Each leaf directory blits the tile of
  // its own children's dust in their place, over the glow they were standing in.
  if (graph.coarse) drawClouds(frame, clouds);
  drawCores(frame);
}

/** The whole circle, in radians — the arcs below, and nothing else in this file. */
const TAU = 6.283;

/**
 * The stars the GPU refused: a glow wider than the device's point ceiling, which is the sun, a
 * galaxy, or a directory's haze on a small screen. They are painted here as the 2D star layer paints
 * every star it draws — the glow blitted additively, the sun's iris over it, the disc filled on top —
 * and every number is `universeStarGeometry`'s or one the two layers share from `universeStarsGL`'s
 * own exports, so a star the GPU could not carry is not a star the sky lost, nor one drawn to a
 * different strength. The list is short by construction and belongs to the layer that made it.
 */
function drawLeftovers(
  frame: Frame,
  nodes: UniverseGraphNode[],
  sky: UniverseSky,
  bokeh: boolean,
): void {
  if (nodes.length === 0) return;
  const { ctx, tokens, tweaks, now } = frame;
  const z = frame.view.z;
  const ink = tokenOf(tokens, '--ink');

  ctx.globalCompositeOperation = 'lighter';
  for (const node of nodes) {
    const glow = glowOf(node, now, 0);
    const color = glowColorOf(node, tokens);
    ctx.globalAlpha = glow.alpha;
    // The same pair of caches the glow pass blits from, chosen the same way: under six screen pixels
    // the quarter-size sprite is the same falloff at a quarter of the texels.
    ctx.drawImage(
      glow.radius * z < 6 ? sky.small(color) : sky.sprite(color),
      node.x - glow.radius,
      node.y - glow.radius,
      glow.radius * 2,
      glow.radius * 2,
    );
    if (bokeh && node.r * z >= 2) {
      const spread = bokehOf(node);
      if (spread !== null) {
        ctx.globalAlpha = spread.alpha;
        ctx.drawImage(sky.sprite(color), node.x - spread.radius, node.y - spread.radius, spread.radius * 2, spread.radius * 2);
      }
    }
    // The sun's own light, which the glow pass lays over everything a core casts.
    if (node.kind === 'core') {
      const iris = node.r * CORE_IRIS_RADII;
      ctx.globalAlpha = CORE_IRIS_ALPHA;
      ctx.drawImage(sky.sprite(ink), node.x - iris, node.y - iris, iris * 2, iris * 2);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  for (const node of nodes) {
    const disc = coreOf(node, now);
    const swing = dopplerSwing(node, tweaks.doppler);
    // The disc's alpha is the core pass's own rule, and the shade a document or a directory wears
    // under it, both read from `universeStarsGL` — the same two the GPU layer writes into a record.
    // A star the GPU refused is still star, and the two layers that can draw it must agree about it
    // to the last decimal, so neither of these numbers is restated here.
    ctx.globalAlpha = discAlphaOf(node, disc.alpha) * (KIND_DIM[node.kind] ?? 1);
    ctx.fillStyle = swing === null ? colorForNode(node, tokens, bandedBrightness(node, now, tweaks)) : tokenOf(tokens, swing);
    ctx.beginPath();
    ctx.arc(node.x, node.y, disc.radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * What is alive over the stars, and the only layer that is drawn every frame: the executions in
 * flight, the flares an edit left burning, the ring on the selection and the labels over all of it.
 * A moving thing on a layer that repaints on a cadence would step.
 */
export function drawLive(
  ctx: CanvasRenderingContext2D,
  sky: UniverseSky,
  graph: UniverseGraph,
  camera: UniverseCamera,
  view: Viewport,
  tokens: UniverseTokens,
  pulses: UniversePulses,
  tweaks: UniverseTweaks,
  now: number,
): void {
  clear(ctx, camera.w, camera.h, camera.dpr);
  // The flares, as a map the frame and the flare pass both read: a node with no entry is a node
  // that is not burning, which is nearly all of them nearly always.
  const flares = new Map<number, number>();
  for (const flare of pulses.liveFlares(now)) flares.set(flare.node, flare.value);
  const frame = makeFrame(ctx, graph, camera, view, tokens, tweaks, now, flares);
  worldTransform(ctx, view);

  // The heavy stars are collected only when something will bend around them: with lensing off this
  // frame's pulses travel straight, which is the default and costs nothing.
  const heavy = tweaks.lensing > 0 ? heavyStars(graph) : null;
  // Every light in flight is advanced, drawn or not: the flow tweak decides what reaches the
  // canvas, never whether a comet is still travelling. A pulse parked by the tweak would otherwise
  // hang mid-leg for as long as the tweak was off, and arrive stale the moment it came back.
  const inFlight = pulses.live(now);
  if (tweaks.flow) drawComets(frame, inFlight, heavy, tweaks.lensing, sky);
  drawFlares(frame, flares, sky);
  drawSelectionRing(frame);
  // The labels are placed in CSS pixels by the one world-to-screen mapping, so the world transform
  // is dropped first — drawn under it, every label would land at its own screen offset a second time.
  ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  drawLabels(frame, tweaks.labels);
  ctx.globalAlpha = 1;
}

/** The world under the camera's own mapping, in one place: both drawing layers set it, and the
 *  labels are the only pass that drops it again. */
function worldTransform(ctx: CanvasRenderingContext2D, view: Viewport): void {
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.z, view.z);
  ctx.translate(-view.x, -view.y);
}

/**
 * The labels, in screen space over everything. A root's name is always drawn; a directory's
 * appears as the view closes on it, or whenever the tweak says all of them; a directory hands its
 * name over to its children once they are the ones being read. A label only exists for a star the
 * caller marked as focused, hovered, or near the selection — and near it only while the focus has
 * `LIT_LABELS_MAX` neighbours or fewer — plus the sun, which is always named.
 */
function drawLabels(frame: Frame, mode: UniverseTweaks['labels']): void {
  if (mode === 'none') return;
  const { ctx, graph, tokens } = frame;
  const z = frame.view.z;
  const focus = graph.focus;
  // How much of the body labels' strength the zoom has earned: nothing at the fitted view, all of
  // it a quarter of a power in. The sun is exempt, because the sun is never not worth naming.
  const far = Math.max(0, Math.min(1, (z - BODY_FADE_FROM) / BODY_FADE_SPAN));
  // Whether the focus's neighbours are named at all: a small neighbourhood is a story, a hub's is a wall.
  // Counted as distinct partners: a pair joined by two lanes is one neighbour, not two.
  const nameLit = focus !== null && new Set(graph.nodes[focus]?.adj ?? []).size <= LIT_LABELS_MAX;
  const core = tokenOf(tokens, '--ink');
  const body = tokenOf(tokens, '--ink');
  const dim = tokenOf(tokens, '--ink-mid');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const integrations: { node: UniverseGraphNode; alpha: number }[] = [];
  for (const node of graph.bodies) {
    if (!frame.visible(node)) continue;
    const lit = nameLit && node.f > 0.85;
    const near = focus === node.id;
    if (node.kind === 'core') {
      // The sun is named whenever it is on screen: at the fitted view it is the one word that
      // tells a visitor what they are looking at.
      const alpha = node.f * Math.max(far, z < BODY_FADE_FROM ? 1 : 0);
      labelAt(frame, node, core, CORE_FONT, alpha, LABEL_GAP_CORE);
      continue;
    }
    if (node.kind === 'galaxy' || node.kind === 'endpoint') {
      // A root is the sky's map — a repo, a database — and is named at every zoom: at the fitted
      // view, where the rooms put the repos three hundred pixels from the sun, the names are what
      // tells a visitor which cloud is which.
      labelAt(frame, node, body, BODY_FONT, Math.max(0.35, node.f), LABEL_GAP_BODY);
      continue;
    }
    if (node.kind === 'system') {
      // An integration folder is named as the view closes on its repo — not at the fitted view,
      // where fifteen names would crowd one belt, and well before a plain directory's. The names
      // are placed after this walk, largest folder first, each skipped where it would print over
      // one already placed: the belt is fifteen names in a patch a hundred pixels across until the
      // view is most of a power in, and a name half over another is a name nobody can read.
      const shown = Math.max(0, Math.min(1, (z - SYSTEM_LABEL_FROM) / SYSTEM_LABEL_SPAN));
      const alpha = Math.max(shown, near || lit ? 1 : 0) * Math.max(0.35, node.f);
      if (alpha > 0.01) integrations.push({ node, alpha });
      continue;
    }
    if (node.kind === 'dir') {
      if (z > DIR_LABEL_ZOOM || near || lit) labelAt(frame, node, dim, DIM_FONT, node.f, LABEL_GAP);
    }
  }

  if (integrations.length > 0) {
    integrations.sort((a, b) => b.node.r - a.node.r);
    ctx.font = BODY_FONT;
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const { node, alpha } of integrations) {
      const at = worldToScreen(frame.camera, node, frame.camera.w, frame.camera.h);
      const half = ctx.measureText(node.label).width / 2;
      const top = at.y + node.r * z + LABEL_GAP_BODY;
      const box = { x0: at.x - half, y0: top, x1: at.x + half, y1: top + BODY_FONT_PX };
      if (placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
      placed.push(box);
      labelAt(frame, node, body, BODY_FONT, alpha, LABEL_GAP_BODY);
    }
  }

  // A FILE'S NAME IS THE ONE THING THAT IS NOT ALWAYS PAID FOR. Ten thousand of them on every frame
  // is a text layout per star, and almost none of them can be read: they are named when the tweak
  // asks for all of them, when the view has closed far enough in that a name means something, or
  // when a star is the one the reader chose. Only then is the active list walked for stars.
  if (mode !== 'all' && z <= FILE_LABEL_ZOOM && focus === null) return;
  for (const node of graph.act) {
    if (!isFile(node) || !frame.visible(node)) continue;
    const lit = nameLit && node.f > 0.85;
    const near = focus === node.id;
    if (mode === 'all' || z > FILE_LABEL_ZOOM || near || lit) {
      // A file's own name earns its strength with the zoom that brought it close enough to read.
      const earned = mode === 'all' || z > FILE_LABEL_ZOOM ? Math.max(0, Math.min(1, z - 1.2)) || 1 : 1;
      labelAt(frame, node, dim, FILE_FONT, node.f * earned, LABEL_GAP);
    }
  }
}

/** One label, placed under its star by the one mapping from world to screen. Only a label that is
 *  actually drawn asks for its position, which keeps the frame's allocations to the handful of
 *  names that reach the canvas rather than to every node in the graph. */
function labelAt(
  frame: Frame,
  node: UniverseGraphNode,
  color: string,
  font: string,
  alpha: number,
  gap: number,
): void {
  if (alpha <= 0.01) return;
  const at = worldToScreen(frame.camera, node, frame.camera.w, frame.camera.h);
  frame.ctx.globalAlpha = Math.min(1, alpha);
  frame.ctx.font = font;
  frame.ctx.fillStyle = color;
  frame.ctx.fillText(node.label, at.x, at.y + node.r * frame.camera.z + gap);
}
