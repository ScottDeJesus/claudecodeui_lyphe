import { bandedBrightness, colorForNode, tokenOf } from '@/modules/universe/utils/universeTokens';
import { coreOf, dopplerSwing, flareHalo, flareRing } from '@/modules/universe/utils/universeStarGeometry';
import type { Frame } from '@/modules/universe/utils/universeGraphPasses';
import type { UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseSky } from '@/modules/universe/utils/universeSky';

/**
 * THE STARS THEMSELVES — the disc each one is, the ring the selection wears, and the flare an edit
 * leaves burning.
 *
 * BATCHED, EXCEPT WHERE A STAR HAS SOMETHING TO SAY. Ten thousand stars drawn one `beginPath` at a
 * time is ten thousand draw calls a frame and a canvas that stutters; drawn into one path per kind,
 * brightness band and colour, the same ten thousand is a few dozen fills, and the frame is
 * affordable. What is drawn on its own is exactly what is still moving — a star being born, dimmed
 * by the depth, blurred off the focal plane — which is a handful of nodes at any moment.
 *
 * WHAT A STAR IS, AND IS NOT, IS `universeStarGeometry`'S. The disc's radius and the depth's alpha
 * come from `coreOf`, the colour it is swung to from `dopplerSwing`, and this file paints them. The
 * same answers are what the GPU star layer reads, so the two paths cannot drift.
 *
 * THE FLARE LIVES ON THE LIVE LAYER, AND THIS IS ITS ONE HOME. A burning star is not drawn any
 * differently here — a flaring node batches like any other, because nothing about the flare is on
 * this sheet. Its halo and its ring are `drawFlares` below, which the live layer calls every frame:
 * a flare is a thing that moves, and a thing that moves on a layer that repaints on a cadence would
 * step. A star layer that had to repaint for one edit would repaint ten thousand stars for it.
 *
 * THE RING IS THE ONE THING DRAWN OVER THE STARS. A selection is a question the visitor asked, so
 * it keeps the plainest ink the palette has and a width that survives the zoom in screen terms: the
 * line thins as the view closes only because the ring is drawn in world units.
 */

/** The ring: how far it clears the star, how much it breathes, and how long a breath takes. */
const RING_GAP = 5;
const RING_WAVE = 2;
const RING_PERIOD = 400;
const RING_ALPHA = 0.9;
const RING_WIDTH = 1.2;
const TAU = 6.283;

/**
 * The stars. A star that is settled, in focus, unblurred and unoccluded joins its batch; anything
 * else is drawn on its own, because it has something to say — a depth to dim, a focus to answer, a
 * birth to finish — and the depth alpha is quantised to the same three bands so a settled star
 * still batches with its neighbours whatever the camera is doing. The walk is the frame's ACTIVE
 * LIST — every body, plus the files of a body the camera can see — so a star no frame is simulating
 * costs this pass nothing at all.
 */
export function drawCores(frame: Frame): void {
  const { ctx, graph, now, tweaks } = frame;
  const doppler = tweaks.doppler;
  const batches = new Map<
    string,
    { path: Path2D; kind: UniverseGraphNode['kind']; alpha: number; color: string }
  >();
  ctx.globalCompositeOperation = 'source-over';

  for (const node of graph.act) {
    if (!frame.visible(node)) continue;
    const color = starColor(frame, node, doppler);
    const core = coreOf(node, now);
    const settled =
      node.f > 0.98 &&
      node.occ < 0.05 &&
      node.bl < 0.05 &&
      node.kind !== 'core' &&
      node.kind !== 'galaxy';
    if (settled) {
      const key = `${node.kind}|${core.alpha}|${color}`;
      let batch = batches.get(key);
      if (batch === undefined) {
        batch = { path: new Path2D(), kind: node.kind, alpha: core.alpha, color };
        batches.set(key, batch);
      }
      batch.path.moveTo(node.x + core.radius, node.y);
      batch.path.arc(node.x, node.y, core.radius, 0, TAU);
      continue;
    }
    // A star being born is at full strength; a star the depth has dimmed answers for it here.
    ctx.globalAlpha = Math.max(0.15, node.f) * Math.min(1, node.da) * (1 - 0.7 * node.bl);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, core.radius, 0, TAU);
    // Documents and directories are drawn a shade under full, as the export drew them.
    if (node.kind === 'docs') ctx.globalAlpha *= 0.8;
    else if (node.kind === 'dir') ctx.globalAlpha *= 0.9;
    ctx.fill();
  }

  for (const batch of batches.values()) {
    ctx.globalAlpha = batch.alpha;
    ctx.fillStyle = batch.color;
    if (batch.kind === 'docs') ctx.globalAlpha *= 0.8;
    else if (batch.kind === 'dir') ctx.globalAlpha *= 0.9;
    ctx.fill(batch.path);
  }
  ctx.globalAlpha = 1;
}

/**
 * Every burning flare, and the whole of what one looks like: the halo thrown over the star's own
 * glow, then the ring closing in as what is left of it goes out. Both are `universeStarGeometry`'s
 * numbers, and the two are drawn in two passes rather than one loop because the halo is additive
 * and the ring is not — a composite flip per flare would pay for a flare twice.
 *
 * It is called with the live flares by node index, the same map the frame carries: a star with no
 * entry is a star that is not burning, which is nearly all of them nearly always.
 */
export function drawFlares(frame: Frame, flares: Map<number, number>, sky: UniverseSky): void {
  if (flares.size === 0) return;
  const { ctx, graph, tweaks, tokens, now } = frame;
  const z = frame.view.z;

  ctx.globalCompositeOperation = 'lighter';
  for (const [id, flare] of flares) {
    const node = graph.nodes[id];
    if (node === undefined || flare <= 0 || !frame.visible(node)) continue;
    const halo = flareHalo(node, flare);
    // The halo is the star's own glow grown bright, so it wears the glow's colour rather than the
    // disc's: the two are the same light, and the flare is the same light at another strength.
    ctx.globalAlpha = halo.alpha;
    ctx.drawImage(
      sky.sprite(colorForNode(node, tokens, 1)),
      node.x - halo.radius,
      node.y - halo.radius,
      halo.radius * 2,
      halo.radius * 2,
    );
  }

  ctx.globalCompositeOperation = 'source-over';
  for (const [id, flare] of flares) {
    const node = graph.nodes[id];
    if (node === undefined || flare <= 0 || !frame.visible(node)) continue;
    const ring = flareRing(node, flare, now);
    ctx.globalAlpha = ring.alpha;
    ctx.strokeStyle = starColor(frame, node, tweaks.doppler);
    ctx.lineWidth = 1 / Math.sqrt(z);
    ctx.beginPath();
    ctx.arc(node.x, node.y, ring.radius, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The ring the focused node wears — the selection, or the node under the pointer, whichever the
 *  caller published as the frame's focus. */
export function drawSelectionRing(frame: Frame): void {
  const { ctx, graph, tokens, now } = frame;
  const focus = graph.focus;
  const node = focus === null ? undefined : graph.nodes[focus];
  if (node === undefined) return;
  ctx.globalAlpha = RING_ALPHA;
  ctx.strokeStyle = tokenOf(tokens, '--ink');
  ctx.lineWidth = RING_WIDTH / Math.sqrt(frame.view.z);
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.r + RING_GAP + RING_WAVE * Math.sin(now / RING_PERIOD), 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** The star's own colour, swung cool or warm by how it is moving through the depth, when the
 *  doppler tweak is on. Off, every star keeps its kind's colour at its own recency. */
function starColor(frame: Frame, node: UniverseGraphNode, doppler: number): string {
  const swing = dopplerSwing(node, doppler);
  const brightness = bandedBrightness(node, frame.now, frame.tweaks);
  return swing === null ? colorForNode(node, frame.tokens, brightness) : tokenOf(frame.tokens, swing);
}
