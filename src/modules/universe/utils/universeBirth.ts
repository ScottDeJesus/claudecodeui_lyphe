import type { UniverseNode } from '@/shared/types';
import type { UniverseGraphNode } from '@/modules/universe/utils/universeGraph';

/**
 * WHERE A NODE IS BORN — the seeds a star reads off its own history, and the ring it is placed on.
 *
 * WHAT THE REAL MAP DOES NOT CARRY, THE EXPORT'S SEEDS BECOME. The export's `rnd()` seeded orbit
 * phases, ellipse squash, retrograde directions and off-plane depth. A star reads the same seeds off
 * its OWN history — last change, churn, line count — through `seedFrom`, so the same tree in gives
 * the same sky out: deterministic, and decoration rather than a reading of the data. The birth
 * clock goes the other way and is gone: the map arrives complete, so every node is live on the
 * first frame and the export's staggering has nothing to stagger.
 *
 * WHERE A NODE IS BORN. The map carries no coordinates, so a child is placed on a phyllotaxis ring
 * around its parent — the golden angle apart, its distance from the ring ladder below — and the
 * springs then pull the real tree into shape. The ladder is the export's three-hop galaxy (the
 * ring, 0.41 of it, then the stars) generalised to a real tree six deep.
 *
 * IT READS THE MODEL AND IS READ BY IT. This file hands back seeds and positions and takes back only
 * the node type, so `universeGraph` may import it and it may never import `universeGraph`'s runtime
 * — one direction, and no cycle for the bundler to unwind.
 */

/** The spiral constant: consecutive siblings are this far around the parent, which never repeats. */
const GOLDEN_ANGLE = 2.39996;

export const isBodyKind = (kind: UniverseNode['k']): boolean => kind === 'dir' || kind === 'galaxy';
/** A star: a tracked file. A body (a directory or a galaxy) and an endpoint are not stars. */
export const isFileKind = (kind: UniverseNode['k']): boolean =>
  !isBodyKind(kind) && kind !== 'core' && kind !== 'endpoint';

/** The radius the children of a node at `depth` are born on, and held on, in world units. */
export const ringFor = (radius: number, depth: number): number =>
  radius * Math.pow(0.55, Math.max(depth, 1));

/**
 * A stable value in `[0, 1)` read off a star's own history. The map carries no phase, so this is
 * where the export's `rnd()` seeds went: same fields in, same value out, for ever.
 */
export function seedFrom(node: UniverseNode, salt: number): number {
  let h = (node.t % 100003) ^ ((node.c + 1) * 2654435761) ^ ((node.l + 1) * 40503);
  h = Math.imul(h ^ (h >>> 15) ^ (salt * 2246822519), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The export's `mk()`: one node with its orbit, its ring and its display factors seeded. The
 *  crawler's last-change instant is carried through as it stands, because the star's brightness is
 *  read from it and the unit (epoch seconds) belongs to whoever wrote it.
 *
 *  The three regime fields are born at their empty values here — no leaf, no extent, no kind — and
 *  `universeRegimes` writes what the tree says into them in the same `buildGraph` call. They belong
 *  to the literal because they belong to the node: a node that exists is a node that can be marked
 *  and measured, whatever the graph around it has worked out so far. */
export function makeNode(node: UniverseNode, id: number): UniverseGraphNode {
  const kind = node.k;
  const ring = isBodyKind(kind);
  const oa = seedFrom(node, 1) * Math.PI * 2;
  const off = seedFrom(node, 9) < 0.55;
  const pz = off ? (seedFrom(node, 10) < 0.5 ? -1 : 1) * (0.1 + seedFrom(node, 11) * 0.22) : 0;
  return {
    id, label: node.n, kind, p: node.p, depth: 0, lines: node.l, t: node.t,
    r: 2.4 + Math.min(Math.sqrt(Math.max(node.l, 1)), 120) / 9,
    deg: 0, adj: [],
    x: 0, y: 0, px: 0, py: 0, ox: 0, oy: 0, vx: 0, vy: 0,
    zn: 0, vz: 0, pz, pzd: 0, pzn: 0,
    inc: (kind === 'galaxy' ? 0.44 : kind === 'dir' ? 0.8 : 1.15) * seedFrom(node, 2),
    ph: seedFrom(node, 3) * Math.PI * 2,
    occ: 0, ds: 1, da: 1, tk: 1, bl: 0, f: 1, ft: 1, glow: 0, wx: 0, wy: 0, tr: null,
    oa, oc: Math.cos(oa), os: Math.sin(oa),
    ob: ring ? 0.72 + seedFrom(node, 4) * 0.23 : 0.55 + seedFrom(node, 5) * 0.42,
    odir: isFileKind(kind) && seedFrom(node, 6) < 0.12 ? -1 : 1,
    okep: 1, orest: 1, prec: 0.04 + seedFrom(node, 7) * 0.16,
    ux: 0, uy: 0, rk: 0.7 + seedFrom(node, 8) * 0.7, tx: 0, ty: 0,
    leaf: false, fr: 0, dk: 'source',
  };
}

/**
 * Every node's starting place, and the child index built on the way — which the graph keeps for its
 * families. A root never sits on another node's ring: the sun is the centre and the galaxies ring
 * it, each at its own angle so no two roots overlap. Everything else hangs on its parent's
 * phyllotaxis ring, further out the deeper it is, and a sibling's own ordinal spreads it around.
 */
export function placeNodes(
  nodes: UniverseGraphNode[],
  core: UniverseGraphNode,
  radius: number,
): number[][] {
  const children: number[][] = nodes.map(() => []);
  for (const n of nodes) if (n.p >= 0 && n.p < nodes.length) children[n.p].push(n.id);
  const roots = nodes.filter((n) => n.p < 0 || n.p >= nodes.length);

  nodes.forEach((n, index) => {
    const root = roots.indexOf(n);
    if (root >= 0) {
      const angle = -Math.PI / 2 + (root / roots.length) * Math.PI * 2;
      const away = n.kind === 'core' ? 0 : n.kind === 'endpoint' ? 0.72 : 0.55;
      n.depth = 0;
      n.px = Math.cos(angle) * radius * away;
      n.py = Math.sin(angle) * radius * away;
    } else {
      const parent = nodes[n.p];
      const count = children[n.p].length;
      const ordinal = children[n.p].indexOf(index);
      n.depth = parent.depth + 1;
      const angle = parent.oa + ordinal * GOLDEN_ANGLE;
      const away = ringFor(radius, n.depth) * (0.55 + 0.45 * Math.sqrt((ordinal + 1) / (count + 1)));
      n.px = parent.px + Math.cos(angle) * away;
      n.py = parent.py + Math.sin(angle) * away;
    }
    n.x = n.px;
    n.y = n.py;
    // The ring direction the body starts on, which the spring then holds it to: a body at depth one
    // or less is on a ring — the same test `isRing` makes, spelled here so the file stays a leaf.
    if (isBodyKind(n.kind) && n.depth <= 1) {
      const anchor = n.p >= 0 ? nodes[n.p] : core;
      const dx = n.px - anchor.px;
      const dy = n.py - anchor.py;
      const len = Math.hypot(dx, dy) || 1;
      n.ux = dx / len;
      n.uy = dy / len;
    }
  });

  return children;
}
