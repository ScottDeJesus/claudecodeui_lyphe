import { tokenOf } from '@/modules/universe/utils/universeTokens';
import { PULSE_TOKEN } from '@/modules/universe/utils/universePulses';
import type { Frame } from '@/modules/universe/utils/universeGraphPasses';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseSky } from '@/modules/universe/utils/universeSky';
import type { UniversePulse } from '@/modules/universe/utils/universePulses';

/**
 * THE LIGHT IN FLIGHT — an execution's pulse, drawn as a comet crossing the edges it really took.
 *
 * A PULSE IS ONE LEG, AND WHAT TRAVELS IT IS A COMET. The node the row resolved to, the endpoint it
 * terminates at, and the path the pulses module routed between them are what this pass walks: a
 * head at the live position, a tail reaching back along the travelled path, and the dust it sheds.
 * Nothing is invented here — a sky with no executions is a sky with no comets, which is the honest
 * reading of an idle estate.
 *
 * THE LENS BENDS LIGHT THAT PASSES BY MASS, AND NOTHING ELSE. A heavy star pulls a point of the
 * path toward itself by a falloff in the distance, by nothing at either end of the leg and by the
 * most in its middle — so a pulse leaves a star and arrives at a node straight, and only the travel
 * between them curves. That is what keeps a comet's two ends readable as the two things it connects.
 * The heavy list is every body of real mass — the sun, the galaxies, and any star whose radius has
 * earned it — because a lens made only of the four bodies would bend nothing at any normal zoom.
 *
 * NO GENERATOR. The export seeded a comet's dust off a random number and gave each pulse a random
 * seed as it was made. This build has exactly one source of noise — the starfield's own — so a
 * comet's dust is derived from the path it is walking instead: the same execution sheds the same
 * dust twice, which is the honest thing for a decoration that was never physical either way.
 */

/** How far back a tail reaches along the path, and how long one step of that walk may be. The
 *  export's own two numbers, and the reason a pulse is a comet rather than a rope to its origin. */
const TAIL_LENGTH = 220;
const TAIL_STEP = 22;
/** The head, and the point of plain ink at its centre. */
const HEAD_RADIUS = 9;
const HEAD_CORE = 0.35;
/** The dust: one speck every other collected point, thrown off the haze and sized by the depth. */
const DUST_EVERY = 6;
const DUST_THROW = 5;
const DUST_SIZE = 0.8;
/** The two tail strokes — a wide soft haze under a thin bright core, both tapering with the tail. */
const HAZE_ALPHA = 0.16;
const HAZE_WIDTH = 6;
const HAZE_BASE = 1;
const CORE_ALPHA = 0.6;
const CORE_WIDTH = 1.4;
const CORE_BASE = 0.3;
/** The lens: how close a heavy star bends a pulse, how hard it pulls, and the ceiling on the bend —
 *  the export's own 8100, 300, 900 and 14, kept because they are what makes light pass BY a sun
 *  rather than fall into it. */
const LENS_REACH_SQ = 8100;
const LENS_PULL = 300;
const LENS_FOCUS = 900;
const LENS_LIMIT = 14;
/** The depth a pulse's leg carries, as the shrink, the dim and the blur of a travelling light. */
const LEG_SHRINK = 0.25;
const LEG_DIM = 0.3;
const LEG_BLUR = 1.4;

/** The radius past which a star bends light — the export's own 5.5, which on the live map is the
 *  sun, the galaxies and 964 of the estate's largest files. */
const HEAVY_RADIUS = 5.5;

/** The heavy stars — the mass light bends around. Cached by the graph's identity: the list is the
 *  same for every frame of a given graph, and rebuilding it would be a walk of ten thousand nodes
 *  to answer a question that did not change. The caller asks for it only when something will bend.
 *
 *  A BODY IS ALWAYS HEAVY, AND SO IS A LARGE STAR: the export built this list from its kind and its
 *  radius (`core || hub || r >= 5.5`), and a lens made of the bodies alone bends nothing a visitor
 *  could see at the fitted view. */
let heavyHeld: { graph: UniverseGraph; list: number[] } | null = null;

export function heavyStars(graph: UniverseGraph): readonly number[] {
  if (heavyHeld !== null && heavyHeld.graph === graph) return heavyHeld.list;
  const list: number[] = [];
  for (const node of graph.nodes) {
    if (node.kind === 'core' || node.kind === 'galaxy' || node.r >= HEAVY_RADIUS) list.push(node.id);
  }
  heavyHeld = { graph, list };
  return list;
}

/**
 * The executions in flight, already advanced to this frame's instant by the scheduler — a pass that
 * aged them itself would be a pass that only ran when the drawing was on. `heavy` is the list to
 * bend around, or `null` when lensing is off, and a cheap bend it is: a frame with the tweak at zero
 * never enters the walk at all.
 */
export function drawComets(
  frame: Frame,
  inFlight: readonly UniversePulse[],
  heavy: readonly number[] | null,
  lensing: number,
  sky: UniverseSky,
): void {
  const { ctx, graph, tokens, bounds, tweaks } = frame;
  const z = frame.camera.z;
  const color = tokenOf(tokens, PULSE_TOKEN);
  const head = tokenOf(tokens, '--ink');
  const dof = tweaks.depthOfField;
  const focusZ = graph.focusZ;
  const dofAmt = graph.dofAmt;
  const perspective = tweaks.perspective;

  const bendAt = (side: UniverseGraphNode, other: UniverseGraphNode, t: number, x: number, y: number): [number, number] => {
    if (heavy === null || lensing === 0) return [x, y];
    const swing = Math.sin(Math.PI * t) * lensing;
    if (swing === 0) return [x, y];
    let ox = 0;
    let oy = 0;
    for (const id of heavy) {
      const mass = graph.nodes[id];
      if (mass === undefined || mass.id === side.id || mass.id === other.id) continue;
      const dx = mass.x - x;
      const dy = mass.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > LENS_REACH_SQ) continue;
      const pull = (LENS_PULL * mass.r * mass.r) / ((d2 + LENS_FOCUS) * Math.sqrt(d2 + 1));
      ox += dx * pull;
      oy += dy * pull;
    }
    const magnitude = Math.hypot(ox, oy);
    if (magnitude > LENS_LIMIT) {
      ox *= LENS_LIMIT / magnitude;
      oy *= LENS_LIMIT / magnitude;
    }
    return [x + ox * swing, y + oy * swing];
  };

  for (const pulse of inFlight) {
    const path = pulse.path;
    const from = graph.nodes[path[pulse.seg]];
    const to = graph.nodes[path[pulse.seg + 1]];
    if (from === undefined || to === undefined) continue;
    const lx = from.x + (to.x - from.x) * pulse.t;
    const ly = from.y + (to.y - from.y) * pulse.t;
    const [hx, hy] = bendAt(from, to, pulse.t, lx, ly);
    // Depth is interpolated along the leg: the light shrinks and dims as it travels away, and
    // softens when it is off the focal plane.
    const zt = from.zn + (to.zn - from.zn) * pulse.t;
    const dsT = Math.max(0.45, 1 + zt * LEG_SHRINK * (1 + perspective));
    const daT = Math.max(0.35, 1 + zt * LEG_DIM * (1 + perspective));
    const blT = dofAmt > 0.01 ? Math.min(1, Math.abs(zt - focusZ) * LEG_BLUR * dof) * dofAmt : 0;
    // A comet whose head is off screen is dropped, unless the path it is walking starts or ends
    // inside the view — a long leg between two visible nodes is a comet worth seeing leave.
    const onscreen = hx > bounds.x0 && hx < bounds.x1 && hy > bounds.y0 && hy < bounds.y1;
    if (!onscreen) {
      const first = graph.nodes[path[0] ?? -1];
      const last = graph.nodes[path[path.length - 1] ?? -1];
      const anchored = (first !== undefined && frame.visible(first)) || (last !== undefined && frame.visible(last));
      if (!anchored) continue;
    }

    // The tail: walk back along the path, budgeted in world units, bending each collected point the
    // way the head was bent so the tail hangs on the curve the light actually took.
    let px = lx;
    let py = ly;
    let budget = TAIL_LENGTH;
    let seg = pulse.seg;
    let t = pulse.t;
    const points = [hx, hy, 1];
    while (budget > 0 && seg >= 0) {
      const s = graph.nodes[path[seg]];
      const e = graph.nodes[path[seg + 1]];
      if (s === undefined || e === undefined) break;
      const len = Math.hypot(e.x - s.x, e.y - s.y) || 1;
      const back = t * len;
      const step = Math.min(back, budget, TAIL_STEP);
      const qx = px - ((e.x - s.x) / len) * step;
      const qy = py - ((e.y - s.y) / len) * step;
      const nt = t - step / len;
      const [cx, cy] = bendAt(s, e, nt, qx, qy);
      budget -= step;
      points.push(cx, cy, budget / TAIL_LENGTH);
      px = qx;
      py = qy;
      if (back <= step + 1e-6) {
        seg--;
        t = 1;
      } else {
        t = nt;
      }
    }

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    const weight = Math.min(1, daT) * (1 - 0.6 * blT);
    const scaleW = (dsT * (1 + 1.5 * blT)) / Math.sqrt(z);
    for (let i = 3; i < points.length; i += 3) {
      const k = points[i + 2] ?? 0;
      const k0 = points[i - 1] ?? 0;
      const x0 = points[i - 3] ?? 0;
      const y0 = points[i - 2] ?? 0;
      const x1 = points[i] ?? 0;
      const y1 = points[i + 1] ?? 0;
      ctx.globalAlpha = HAZE_ALPHA * k * k * weight;
      ctx.lineWidth = (HAZE_BASE + HAZE_WIDTH * k0) * scaleW;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalAlpha = CORE_ALPHA * Math.pow(k, 1.6) * weight;
      ctx.lineWidth = (CORE_BASE + CORE_WIDTH * k0) * scaleW;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    const seed = ((path[0] ?? 0) * 31 + path.length * 7) % 1000;
    for (let i = DUST_EVERY; i < points.length; i += DUST_EVERY) {
      const k = points[i + 2] ?? 0;
      const off = DUST_THROW * (1 - k);
      const jx = Math.sin(seed + i * 1.7) * off;
      const jy = Math.cos(seed * 1.3 + i * 2.1) * off;
      ctx.globalAlpha = 0.35 * k * weight;
      const size = DUST_SIZE * scaleW;
      ctx.fillRect((points[i] ?? 0) + jx - size, (points[i + 1] ?? 0) + jy - size, size * 2, size * 2);
    }
    // The head: the execution's own colour with a smaller point of plain ink inside it, so the light
    // has a centre rather than a smear.
    ctx.globalAlpha = 0.9 * Math.min(1, daT) * (1 - 0.45 * blT);
    const headR = HEAD_RADIUS * dsT * (1 + 2.2 * blT);
    ctx.drawImage(sky.sprite(color), hx - headR, hy - headR, headR * 2, headR * 2);
    ctx.globalAlpha = 0.95 * Math.min(1, daT) * (1 - 0.6 * blT);
    const coreR = headR * HEAD_CORE;
    ctx.drawImage(sky.sprite(head), hx - coreR, hy - coreR, coreR * 2, coreR * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
