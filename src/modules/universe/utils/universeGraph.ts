import type { UniverseMap, UniverseNode } from '@/shared/types';
import { birthRegimes } from '@/modules/universe/utils/universeRegimes';
import {
  isBodyKind,
  isFileKind,
  makeNode,
  placeNodes,
  ringFor,
  seedFrom,
} from '@/modules/universe/utils/universeBirth';

/**
 * THE GRAPH THE SKY DRAWS — every node, every link, and how stiff the springs between them may be.
 * Built once from the map, never rebuilt: a tweak moves the frame, never the graph.
 *
 * WHERE A NODE IS BORN IS NOT THIS FILE'S. The seeds a star reads off its own history, the ring ladder
 * and the placement are `universeBirth` — where the export's `rnd()` went, and why the same tree gives
 * the same sky every load. What is here is the assembled model: the links, the stiffness bound, gravity.
 *
 * WHAT A NODE IS BEYOND ITS KIND IS BORN IN THE SAME CALL. The regime outputs — `leaf`, `fr`, `dk` —
 * and the body list the regimes mark come from `universeRegimes`, derived from the tree the placement
 * above just made: read here once, never recomputed, because only a new map makes a new tree.
 *
 * THE KEYS ARE THE CRAWLER'S. `id` is the index in `nodes`, `p.id` the parent's and `adj` holds
 * indices: that is the vocabulary the map, the activity rows and the pulses all speak.
 */

export type UniverseGraphNode = {
  id: number;
  /** The crawler's basename — what the renderer labels and the panel names. */
  label: string;
  kind: UniverseNode['k'];
  /** Parent node index, `-1` for a root: the sun, a galaxy, an endpoint. */
  p: number;
  depth: number;
  lines: number;
  /** The instant git last saw this node change, epoch SECONDS — the crawler's own unit, carried
   *  through untouched, and the one input the brightness curve reads. */
  t: number;
  /** Star radius, from the file's line count. */
  r: number;
  deg: number;
  adj: number[];
  /** Drawn position — resting position plus float, parallax and wobble — then the resting position
   * the physics moves, last frame's for the orbit to read, and the accumulated velocity. */
  x: number; y: number;
  px: number; py: number;
  ox: number; oy: number;
  vx: number; vy: number;
  /** Depth from the orbital tilt, its smoothed radial velocity, and the parallax offset. */
  zn: number; vz: number;
  pz: number; pzd: number; pzn: number;
  /** Tilt, phase and occupancy, then the per-frame display factors: scale, alpha, twinkle, blur. */
  inc: number; ph: number; occ: number;
  ds: number; da: number; tk: number; bl: number;
  /** Focus factor, glow, and the barycentre wobble offset. */
  f: number; ft: number; glow: number;
  wx: number; wy: number;
  /** Trail samples, `[x, y, x, y, …]`, or `null` when trails are off. */
  tr: number[] | null;
  /** The orbit: its turning angle and its cosine/sine, ellipse squash, direction, tilt. */
  oa: number; oc: number; os: number;
  ob: number; odir: number;
  okep: number; orest: number; prec: number;
  /** The ring a body is held on around its anchor: its direction, radius factor, and the target. */
  ux: number; uy: number;
  rk: number; tx: number; ty: number;
  /** THE REGIME OUTPUTS, born once and never recomputed: `leaf` (no directory children), `fr` (the
   *  mean birth distance of its own file children — zero when it carries none) and `dk` (their mode). */
  leaf: boolean; fr: number; dk: UniverseNode['k'];
};

export type UniverseGraphLink = {
  a: number; b: number;
  /** Current rest length, the rest at unit gravity, and the spring constant. */
  rest: number; rest0: number; k: number;
  kind: 'tree' | 'import' | 'cochange' | 'endpoint';
};

export type UniverseGraph = {
  nodes: UniverseGraphNode[];
  links: UniverseGraphLink[];
  /** Parents before children — every pass that reads a parent's live position walks this order. */
  byDepth: UniverseGraphNode[];
  /** Bodies held on a ring: a root around the sun, a depth-one body around its root. */
  hubs: UniverseGraphNode[];
  /** Every non-file node in `byDepth` order, born once: the regimes mark these, never a file. */
  bodies: UniverseGraphNode[];
  /** This frame's active list, rebuilt in place by `universeRegimes`; every display loop walks it. */
  act: UniverseGraphNode[];
  /** The zoom is under `COARSE_Z`: every star is sub-pixel, so files are neither simulated nor drawn. */
  coarse: boolean;
  /** Every body with its direct children — what the wobble sums and the transits test. */
  families: { p: UniverseGraphNode; kids: UniverseGraphNode[] }[];
  /** Every node's direct children by parent id, what the regimes measure a body's extent over and
   *  admit its files from. Not `families`: eight files on the merged map hang off the sun itself. */
  children: (UniverseGraphNode[] | undefined)[];
  core: UniverseGraphNode;
  /** The galaxy's reach in world units, and the same divided by 290. */
  radius: number; scale: number;
  /** The camera's live world position, written by the caller — the parallax origin. */
  camX: number; camY: number;
  /** The node the depth of field focuses on (the selection, else the hover), and its depth. */
  focus: number | null;
  focusZ: number; dofAmt: number;
  /** The frame's temperature and the gravity it is running under. */
  alpha: number; gv: number;
  /** The frame's clock and the last trail sample. */
  lastNow: number; lastTrail: number;
  /** The fastest node the last relaxation moved, in world units a frame; zero once nothing moves. */
  speed: number;
  /** Floor frames the relaxation has counted past. `universeForces` owns the cadence and reads this;
   *  it lives on the graph so two skies never relax on each other's frames. */
  relaxTick: number;
  /** The node the hand is dragging, or `null` — the frame runs hot while it is set. */
  dragging: number | null;
  /** Which decorative passes ran last frame, so a switch-off can clear what one of them left. */
  wobbleOn: boolean; dopplerOn: boolean; transitsOn: boolean;
  /** The repulsion grid, kept across frames so a 10,000-node walk allocates nothing. */
  grid: Map<number, UniverseGraphNode[]>;
};

/** What `buildGraph` is handed: the map's nodes and edges. Node indices are already global and a root
 *  says so with `p < 0`, so the map's `repos` list has nothing left to tell anyone and is not taken. */
export type UniverseGraphSource = {
  nodes: UniverseNode[];
  edges: UniverseMap['edges'];
};

/** How far apart two nodes joined only by an import, a co-change or an endpoint edge settle. */
const CROSS_REST = 170;
const EDGE_KINDS = ['tree', 'import', 'cochange', 'endpoint'] as const;

export const isBody = (n: UniverseGraphNode): boolean => isBodyKind(n.kind);
export const isFile = (n: UniverseGraphNode): boolean => isFileKind(n.kind);
/** A body held on a ring by a spring: the sun's children, and the roots that orbit the sun. */
export const isRing = (n: UniverseGraphNode): boolean => isBody(n) && n.depth <= 1;

/** Keplerian step: advance an offset along the node's own ellipse. Faster near periapsis, slower far
 *  out; families further from their parent turn slower overall. Some files run retrograde. */
export function orb(n: UniverseGraphNode, dx: number, dy: number, th: number): [number, number] {
  const ux = dx * n.oc + dy * n.os;
  const uy = (-dx * n.os + dy * n.oc) / n.ob;
  const rc = Math.hypot(ux, uy) || 1;
  const r = Math.hypot(dx, dy) || 1;
  const spd = Math.min(3, (rc / r) * (rc / r)) * n.okep * n.odir;
  const a = th * spd;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const vx = ux * c - uy * s;
  const vy = (ux * s + uy * c) * n.ob;
  return [vx * n.oc - vy * n.os, vx * n.os + vy * n.oc];
}

/** The node a ring body circles: its parent, or the sun when it is a root. */
export const anchorOf = (graph: UniverseGraph, n: UniverseGraphNode): UniverseGraphNode =>
  n.p >= 0 ? graph.nodes[n.p] : graph.core;

/** Where a ring body is held this frame: its ring around its anchor, whose live position it follows —
 *  so a galaxy carries its own subtree with it as the sun turns. */
export function ringTarget(graph: UniverseGraph, h: UniverseGraphNode): void {
  const anchor = anchorOf(graph, h);
  const reach = ringFor(graph.radius, h.depth) / Math.pow(graph.gv, 0.45);
  h.tx = anchor.px + h.ux * reach * h.rk;
  h.ty = anchor.py + h.uy * reach * h.rk;
}

/** The graph, once. Nodes come whole from the map; positions are born in `universeBirth`. */
export function buildGraph(source: UniverseGraphSource): UniverseGraph {
  const nodes = source.nodes.map(makeNode);
  const scale = Math.sqrt(nodes.length / 320);
  const radius = 290 * scale;
  const core = nodes.find((n) => n.kind === 'core') ?? nodes[0];
  const childIds = placeNodes(nodes, core, radius);

  const links: UniverseGraphLink[] = [];
  const stiffness: Record<UniverseGraphLink['kind'], number> = {
    tree: 0.028,
    import: 0.004,
    cochange: 0.012,
    endpoint: 0.02,
  };
  for (const kind of EDGE_KINDS) {
    for (const [a, b] of source.edges[kind] ?? []) {
      if (a >= nodes.length || b >= nodes.length) continue;
      const child = nodes[b];
      let rest = kind === 'tree' ? ringFor(radius, child.depth) : CROSS_REST;
      if (kind === 'tree') {
        // A body is held on its own ring; a star hangs where its own history puts it — the export's
        // companion-star branch has no counterpart here, because the real map has no binaries.
        const kk = isBody(child) ? child.rk : 0.45 + seedFrom(source.nodes[b], 12) * 1.3;
        rest *= kk;
        child.okep = Math.pow(kk, -1.5);
        child.orest = rest;
      }
      links.push({ a, b, rest, rest0: rest, k: stiffness[kind], kind });
      nodes[a].deg++;
      nodes[b].deg++;
      nodes[a].adj.push(b);
      nodes[b].adj.push(a);
    }
  }

  boundStiffness(nodes, links);

  const byDepth = [...nodes].sort((a, b) => a.depth - b.depth);
  // The regime outputs every node is born with — `leaf`, `fr`, `dk` — the body list the regimes walk,
  // and the children index they admit files from: `universeRegimes` owns it and touches no document.
  const { bodies, children } = birthRegimes(byDepth);

  const graph: UniverseGraph = {
    nodes,
    links,
    byDepth,
    hubs: nodes.filter((n) => isRing(n) && n !== core),
    families: nodes
      .map((p) => ({ p, kids: childIds[p.id].map((id) => nodes[id]) }))
      .filter((f) => f.kids.length > 0 && isBody(f.p)),
    children,
    bodies,
    act: [],
    coarse: false,
    core,
    radius,
    scale,
    camX: 0,
    camY: 0,
    focus: null,
    focusZ: 0,
    dofAmt: 0,
    alpha: 1,
    // Born at zero, NOT at the 1 the birth call below hands in, so that call is not skipped as a
    // no-change: it is what writes every ring target and every spring rest on the first frame.
    gv: 0,
    lastNow: 0,
    lastTrail: 0,
    speed: 0,
    // The relax cadence's counter; `universeForces` owns it and advances it on a floor frame.
    relaxTick: 0,
    dragging: null,
    wobbleOn: false,
    dopplerOn: false,
    transitsOn: false,
    grid: new Map(),
  };
  applyGravity(graph, 1);
  return graph;
}

/**
 * THE STIFFNESS A NODE MAY CARRY, and why the export's table sometimes carries more than the
 * integration can hold.
 *
 * `relax` integrates explicitly — `v = (v + F) * 0.8` then `p += v`. For a spring of stiffness K
 * that recursion has eigenvalues with determinant 0.8 and trace `1.8 - 0.8K`, so it stays bounded
 * only while `|1.8 - 0.8K| <= 1.8`, i.e. `K <= 4.5`; past that a node does not settle, it flips sign
 * and grows every frame. `K` here is a node's TOTAL incident stiffness, and the export's table
 * (tree 0.028, import 0.004, co-change 0.012, endpoint 0.02) was tuned on a synthetic tree whose
 * busiest node carried a handful of links. The real map has hubs — a directory in 412 links, an
 * endpoint in 513 — and their totals reach 11.5, five times a single spring's limit; on the merged
 * map that one node threw the whole galaxy outward within fifty frames.
 *
 * THE LIMIT IS HALF THE DERIVATION, deliberately. A spring network's stiffest mode can be up to
 * twice a node's own total (`sum_j k_ij` bounds the Laplacian's largest eigenvalue at twice itself),
 * so holding every node's total under 2 keeps the stiffest mode under the 4.5 the integrator has,
 * with room. Only the links of a node that is over are softened, and all of them by the same factor,
 * so the node still pulls its neighbours with one force — a graph whose hubs are ordinary is
 * untouched, link for link, exactly as the export built it.
 */
const EULER_LIMIT = 2;
/** What a gravity change reheats the layout to, so the new shape is reached. */
export const GRAVITY_REHEAT = 0.5;

function boundStiffness(nodes: UniverseGraphNode[], links: UniverseGraphLink[]): void {
  const total: number[] = nodes.map(() => 0);
  for (const l of links) {
    total[l.a] += l.k;
    total[l.b] += l.k;
  }
  const slack = (i: number): number => (total[i] > EULER_LIMIT ? EULER_LIMIT / total[i] : 1);
  for (const l of links) {
    const factor = Math.min(slack(l.a), slack(l.b));
    if (factor < 1) l.k *= factor;
  }
}

/** The export's `applyGravity()`: what the gravity tweak does to every ring and spring rest. */
export function applyGravity(graph: UniverseGraph, gravity: number): void {
  // The tweak is handed in every frame, and the answer only changes when the number does: re-walking
  // 28,000 links to rewrite rest lengths the last call already wrote, and every hub's ring target
  // with them, is the whole cost of this function on a frame that changes nothing.
  if (gravity === graph.gv) return;
  // A gravity change moves every ring target and every spring's rest length at once, so the layout
  // is reheated to reach the new shape — without it a gravity slider would do nothing at all on a
  // sky whose relaxation has already stopped. The export's own reheat value.
  graph.alpha = Math.max(graph.alpha, GRAVITY_REHEAT);
  graph.gv = gravity;
  for (const h of graph.hubs) ringTarget(graph, h);
  for (const l of graph.links) l.rest = l.rest0 / Math.pow(gravity, 0.3);
}
