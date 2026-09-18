import { isFile, isRing } from '@/modules/universe/utils/universeGraph';
import type { UniverseGraph } from '@/modules/universe/utils/universeGraph';

/**
 * THE FORCE RELAXATION — the export's `step()` from its temperature down to its integration, which
 * is what turns a phyllotaxis of nodes into a galaxy.
 *
 * THE GRID IS THE WHOLE REASON THIS IS AFFORDABLE. Repulsion is every pair within 120 units, and
 * every pair would be 10,100² at the merged map's size — a hundred million distances a frame. Nodes
 * are bucketed into 120-unit cells instead and each looks only at its eight neighbours, which is
 * exact because the cell is exactly the range forces act over: no pair closer than the cutoff can
 * be more than one cell apart.
 *
 * THE CELL IS THE CUTOFF, DELIBERATELY. Shrinking it to sort more finely would start missing
 * neighbours; growing it would only add candidates to reject. One constant, two jobs.
 *
 * A COLD FRAME COSTS NOTHING, AND A SETTLED ONE COSTS NOTHING TOO. The layout cools as it settles,
 * and below `ALPHA_REST` the whole relaxation is skipped — no grid cleared, no pair walked. The
 * floor the export kept under a sky that was still orbiting is withdrawn once nothing is moving
 * (see `advanceTemperature`): a drag or a gravity change reheats it, which is why dropping a star
 * visibly stirs its neighbourhood.
 */

/** The repulsion cell, in world units, and therefore the exact range of the repulsion. */
const GRID_CELL = 120;
const CUTOFF_SQUARED = GRID_CELL * GRID_CELL;
/** Cooling per frame, the floor it settles at while the layout is still moving, and the gate. */
const ALPHA_DECAY = 0.985;
const ALPHA_FLOOR = 0.03;
const ALPHA_REST = 0.01;
const ALPHA_DRAG = 0.35;
const DAMPING = 0.8;
const RING_PULL = 0.006;
const HOME_PULL = 0.0006;
/**
 * The most a cross link — an import, a co-change, an endpoint — may pull per frame, in the
 * units the springs add to velocity, before the temperature scales it. A spring's pull grows with
 * its stretch and a cross edge is stretched by the whole sky: a star three imports from three
 * other repos was being dragged hundreds of world units out of its own folder, which is the other
 * half of what put a stranger's star beside every star. The tree spring's pull back is `0.028` a
 * unit of stretch, so at this cap a link moves a star at most seven units off its rest, and a star
 * with the import lane's six and the co-change lane's eight is held within its folder's disc.
 */
const CROSS_CAP = 0.2;
/**
 * How hard two sibling subtrees push apart while their reaches overlap, per unit of overlap, and the
 * most they may push a frame. The pair repulsion above reaches 120 units and sees a body as a point;
 * a subtree is a disc a thousand units across, and two of them born a little too close would never
 * come apart on their own — so siblings repel by their `reach`, centre to centre. It is a lean, not a
 * guarantee: the orbit spreads subtrees into each other about as fast as a capped push parts them
 * (164 overlapping sibling pairs at birth, 207 at frame 1,800, none of them putting a star on
 * another folder's), so the layout's real defence is the birth placement, and this keeps it honest. The centre is LIVE:
 * the birth offset goes stale the moment the orbit turns a child (measured 1,000 units adrift by
 * frame 7,200 on the merged map, pushing pairs whose rooms were clear), so each relaxation re-measures
 * it from the leaves up as the reach-weighted centre of the subtree's own live centres, and the
 * orbit pass carries each one's children with it.
 */
const SIBLING_K = 0.02;
const SIBLING_CAP = 4;
/**
 * How fast the fastest node may still be moving, in world units a frame, for the sky to count as
 * settled and the floor to come out from under the temperature. A star is 5 to 20 units across and
 * the float pass alone swings a drawn star 2.6 units, so a step this small cannot be seen.
 */
const SETTLED_SPEED = 0.5;
/**
 * How many floor frames pass between two full relaxations. The floor means the sky is neither
 * settling, nor dragged, nor reheated, and what a step there is worth is small — quoted as the
 * excess over a frame that skipped it, mean per node of |Δpx| + |Δpy| across one frame, over two
 * 120-frame windows of the merged map at default tweaks, measured at a cadence of six: under 0.13
 * world units a frame on average and under 0.9 at its worst, against the 2.6 world units the drawn
 * position already moves its liveliest star by. One floor frame in ten pays for the whole-graph
 * pass: a relaxation costs ~30 ms a call on the merged map, and at folder zoom a cadence of six held
 * the step at 7.5-9.4 ms against its 8 ms target where ten holds it at 5.7-6.6.
 */
const RELAX_EVERY = 10;

/**
 * The frame's temperature. The layout runs hot while the graph settles and cools to a slow tide
 * while it is still moving; a drag reheats it, and so does a gravity change.
 *
 * THE FLOOR IS KEPT WHILE THE SKY IS STILL MOVING, AND UNDER THE DEFAULT ORBIT THAT IS FOR EVER —
 * MEASURED, NOT ASSUMED. With the orbit off the sky does cool: the peak step falls under
 * `SETTLED_SPEED` around frame 300, the floor comes out from under the temperature, the relaxation
 * ends and a frame drops from 32 ms to 5.5 ms. With the orbit ON — the default, 0.05 — it never
 * does. The springs in `relax` chase their rest lengths while the kinematic orbit above moves every
 * node every frame, so the two fight, the peak step stays above `SETTLED_SPEED`, the temperature
 * sits at the floor for ever, and the whole-graph relaxation ran on every frame for ever: 29 ms a
 * frame at the merged map's 10,100 nodes, nearly all of it recomputing the answer it already had.
 *
 * AND THE FLOOR'S HEIGHT IS THE SKY'S SIZE. What keeps the peak step up is the ellipse: `orb` squashes
 * every offset by `ob` as it turns, so a child's distance from its parent breathes by up to a fifth
 * of its rest length each orbit while the spring chases a fixed rest, and the step that chase takes
 * grows with the rest lengths. Measured on the merged map after 1,800 frames: 2.6-3.5 units at the
 * export's 1,670-unit radius, 5.1-5.8 at a 15,000-unit sky, 3.5-4.0 at the 9,200 shipped, 3.5-3.6
 * with every orbit made circular, and 0 with the orbit off — the sibling repulsion and the packing
 * constants move it by nothing beyond what they do to the rest lengths.
 *
 * SO THE CADENCE IS THE CURE, NOT A LOWER FLOOR (`relax`). At the floor the relaxation's own share
 * of the frame's drift — the excess over a frame that skipped it, over two 120-frame windows,
 * measured at a cadence of six — stays under 0.13 world units a frame on average and under 0.9 at
 * its worst, small beside the 2.6 the drawn position already moves its liveliest star by: one floor
 * frame in ten pays for the whole-graph pass and draws the picture the ten of them all draw. Above
 * the floor nothing is skipped: settling, a drag and a gravity change all still run every frame at
 * full temperature.
 *
 * THE RELAXATION STAYS WHOLE-GRAPH, BECAUSE ITS PHYSICS IS. Repulsion is every pair within
 * `GRID_CELL`, so no node may be dropped without changing the answer — the pass is bounded by its
 * cadence instead of by a narrower list. What a display pass walks is a separate question, and not
 * this file's.
 *
 * The export waited for its birth clock before cooling at all; the map arrives whole here, so it
 * cools from the first frame.
 */
export function advanceTemperature(graph: UniverseGraph, orbiting: boolean): number {
  if (graph.dragging !== null) graph.alpha = Math.max(graph.alpha, ALPHA_DRAG);
  else {
    const stirring = orbiting && graph.speed > SETTLED_SPEED;
    graph.alpha = Math.max(stirring ? ALPHA_FLOOR : 0, graph.alpha * ALPHA_DECAY);
  }
  return graph.alpha;
}

/** Repulsion over the spatial grid, the link springs, and the integration that moves every node. */
export function relax(graph: UniverseGraph, A: number): void {
  if (A <= ALPHA_REST) {
    graph.speed = 0;
    return;
  }
  // The cold path: at the floor the sky is neither settling, nor dragged, nor reheated, and a step
  // taken here moves a node under `SETTLED_SPEED` — so only one frame in `RELAX_EVERY` pays for the
  // whole-graph pass. The counter is on the graph rather than in this module, so two tabs opening a
  // sky each relax on their own frames. `graph.speed` is deliberately left alone on a skipped frame:
  // zeroing it would read to `advanceTemperature` as a settled sky, which drops the floor for good.
  if (A <= ALPHA_FLOOR + 1e-9) {
    graph.relaxTick++;
    if (graph.relaxTick % RELAX_EVERY !== 0) return;
  }
  const nodes = graph.nodes;
  const grid = graph.grid;

  grid.clear();
  for (const n of nodes) {
    const key = ((n.px / GRID_CELL) | 0) * 100000 + ((n.py / GRID_CELL) | 0);
    const cell = grid.get(key);
    if (cell) cell.push(n);
    else grid.set(key, [n]);
  }

  for (const n of nodes) {
    const gx = (n.px / GRID_CELL) | 0;
    const gy = (n.py / GRID_CELL) | 0;
    const nFile = isFile(n);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = grid.get((gx + dx) * 100000 + gy + dy);
        if (!cell) continue;
        for (const m of cell) {
          if (m.id <= n.id) continue;
          let ddx = n.px - m.px;
          let ddy = n.py - m.py;
          let d2 = ddx * ddx + ddy * ddy;
          if (d2 > CUTOFF_SQUARED) continue;
          if (d2 < 0.01) {
            // Two nodes on the same point would divide by zero: nudge them apart instead.
            ddx = 0.1;
            ddy = 0.1;
            d2 = 0.02;
          }
          const big = (nFile ? 1 : 3) * (isFile(m) ? 1 : 3) * (0.6 + (n.r + m.r) / 14);
          const f = Math.min(3.5, (2600 * big) / d2) * A;
          const d = Math.sqrt(d2);
          const fx = (ddx / d) * f;
          const fy = (ddy / d) * f;
          n.vx += fx;
          n.vy += fy;
          m.vx -= fx;
          m.vy -= fy;
        }
      }
    }
  }

  // A link is a spring at its rest length — the tree, an import, a co-change, an endpoint.
  // The stiffness is the export's table, already softened by `boundStiffness` for any hub too stiff
  // for this integration to hold; a cross link's pull is capped besides, so a relation is drawn as a
  // line and felt as a lean, never as a tow out of the folder.
  const cap = CROSS_CAP * A;
  for (const l of graph.links) {
    const a = nodes[l.a];
    const b = nodes[l.b];
    const dx = b.px - a.px;
    const dy = b.py - a.py;
    const d = Math.hypot(dx, dy) || 1;
    let s = (d - l.rest) * l.k * A;
    // A held node — a repo, a database — is where its ring puts it and nothing else: five hundred
    // capped links still sum to a tow (measured 2026-09-17: a hub pulled from its 11,000-unit ring to
    // 6,000 in 600 frames). So a cross link moves only the star end.
    let cross = false;
    if (l.kind !== 'tree') {
      cross = true;
      s = s > cap ? cap : s < -cap ? -cap : s;
    }
    const fx = (dx / d) * s;
    const fy = (dy / d) * s;
    if (!cross || !isRing(a)) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!cross || !isRing(b)) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Where each room is NOW: leaves up, so a parent reads its children's live centres. A file's
  // centre is itself; a body's is its own place and its children's centres, each weighed by the
  // room it takes.
  for (let i = graph.byDepth.length - 1; i >= 0; i--) {
    const n = graph.byDepth[i];
    if (isFile(n)) {
      n.lx = n.px;
      n.ly = n.py;
      continue;
    }
    let w = n.disc > 0 ? n.disc * n.disc : n.r * n.r;
    let sx = n.px * w;
    let sy = n.py * w;
    for (const c of graph.children[n.id] ?? []) {
      const cw = c.reach * c.reach;
      sx += c.lx * cw;
      sy += c.ly * cw;
      w += cw;
    }
    n.lx = sx / w;
    n.ly = sy / w;
  }

  // Two sibling subtrees that overlap by their reach are pushed apart as wholes — see `SIBLING_K`.
  for (const set of graph.siblings) {
    for (let i = 0; i < set.length; i++) {
      const a = set[i];
      for (let j = i + 1; j < set.length; j++) {
        const b = set[j];
        const dx = b.lx - a.lx;
        const dy = b.ly - a.ly;
        const room = a.reach + b.reach;
        const d = Math.hypot(dx, dy) || 1;
        if (d >= room) continue;
        const s = Math.min(SIBLING_CAP, (room - d) * SIBLING_K) * A;
        const fx = (dx / d) * s;
        const fy = (dy / d) * s;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // Pull-home: a held node is drawn to its ring, everything else to the root of its own tree — its
  // repo, never the sun, or every repo's stars would lean toward the centre by however far out the
  // repo stood. The sun and a node under the hand are pinned — vx and vy are cleared, so nothing
  // accumulates on them. The peak step the loop takes is the graph's speed, which the next frame's
  // temperature reads.
  let speed = 0;
  for (const n of nodes) {
    if (n.kind === 'core' || n.id === graph.dragging) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    if (isRing(n)) {
      n.vx += (n.tx - n.px) * RING_PULL * A;
      n.vy += (n.ty - n.py) * RING_PULL * A;
    } else {
      const home = nodes[n.root];
      n.vx -= (n.px - home.px) * HOME_PULL * A * graph.gv;
      n.vy -= (n.py - home.py) * HOME_PULL * A * graph.gv;
    }
    n.vx *= DAMPING;
    n.vy *= DAMPING;
    n.px += n.vx;
    n.py += n.vy;
    const step = Math.abs(n.vx) + Math.abs(n.vy);
    if (step > speed) speed = step;
  }
  graph.speed = speed;
}
