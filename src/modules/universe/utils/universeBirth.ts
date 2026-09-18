import type { UniverseNode } from '@/shared/types';
import type { UniverseGraphNode } from '@/modules/universe/utils/universeGraph';

/**
 * WHERE A NODE IS BORN — the seeds a star reads off its own history, and the room its subtree is given.
 *
 * WHAT THE REAL MAP DOES NOT CARRY, THE EXPORT'S SEEDS BECOME. The export's `rnd()` seeded orbit
 * phases, ellipse squash, retrograde directions and off-plane depth. A star reads the same seeds off
 * its OWN history — last change, churn, line count — through `seedFrom`, so the same tree in gives
 * the same sky out: deterministic, and decoration rather than a reading of the data. The birth
 * clock goes the other way and is gone: the map arrives complete, so every node is live on the
 * first frame and the export's staggering has nothing to stagger.
 *
 * A FOLDER IS GIVEN THE ROOM ITS SUBTREE NEEDS, MEASURED BOTTOM-UP. The export placed children on a
 * ring that shrank by a fixed 0.55 per depth whatever hung beneath them, and on the merged map that
 * made sibling subtrees interpenetrate: a folder's own stars reached 0.96 of its parent's ring, so
 * two sibling folders drew their clouds through each other, and measured after settling, 84% of the
 * stars had a star from ANOTHER folder as their nearest neighbour — the popcorn a zoom-in showed.
 * So every node now carries a `reach`, the radius of the disc its whole subtree fits in, computed
 * from the leaves up: a star's is its own radius with room to glow; a body's is the disc its files
 * pack into (by area, `DISC_PACK`) plus the annulus its child bodies pack into outside it (by area
 * again, `BODY_PACK` — a ring by arc was measured first and put the sky's edge 270,000 units out,
 * because a ring grows with the COUNT of siblings where a disc grows with the root of it). Files sit
 * in the inner disc and folders in the annulus, which is what keeps a folder's own stars out of its
 * child folders' clouds, and each child is born at the distance its spring will rest at.
 *
 * THE INTEGRATIONS ARE THE OUTER BELT OF THEIR OWN FOLDER. A directory the crawler marked `system` —
 * one per outside system under `extractors/` — is a body like any other, only drawn larger
 * (`SYSTEM_R`) and packed AFTER its plain siblings, so the integrations sit together on the outside
 * of the folder that holds them, a belt of their own, `SYSTEM_BELT` further out. The operator's word
 * (2026-09-17): these are what make the system functional, and they were reading as ordinary folders.
 *
 * THE SOURCES STAND OUTSIDE THE REPOS. A repo rings the sun, arc-packed by its reach. An endpoint —
 * a database, an MCP server — rings the sun on a second ring outside every repo, at the bearing of
 * the repo that named it. Their springs reach in from there to the stars that talk to them.
 *
 * IT READS THE MODEL AND IS READ BY IT. This file hands back seeds and positions and takes back only
 * the node type, so `universeGraph` may import it and it may never import `universeGraph`'s runtime
 * — one direction, and no cycle for the bundler to unwind.
 */

/** The spiral constant: consecutive children are this far around the parent, which never repeats. */
const GOLDEN_ANGLE = 2.39996;

/** A star's reach: its radius, with room for its glow and a gap to the next. */
const FILE_ROOM = 1.2;
const FILE_ROOM_PAD = 1.5;
/** The disc a body's files pack into, as a multiple of the area their reaches sum to. A sunflower
 *  packs about two thirds of a disc; at 1.0 the stars sit a little closer than that, which the
 *  operator asked for after a 1.5 that spread the sky to 15,000 units (2026-09-17). */
const DISC_PACK = 1.0;
/** The annulus a body's child bodies pack into, as a multiple of the area their reaches sum to. A
 *  little looser than the stars': a subtree is a disc of its own, and two of them meet at one point.
 *  Measured 2026-09-17 with the stars' 1.0: 1.1 gives a 9,100-unit sky with 23% of stars nearest a
 *  stranger and 8 overlapping pairs; 1.7 gave 15,000 / 13% / 0. The closer sky was chosen. */
const BODY_PACK = 1.1;
/** The least of its own disc a star may rest at, as a fraction: the innermost star of a sunflower would
 *  otherwise lap its siblings at a pace the orbit's Kepler factor turns absurd. */
const DISC_FLOOR = 0.25;
/** An endpoint is born at this radius and resized by `buildGraph` once its links are counted, since it
 *  has no lines to be sized by; this is what its room is measured at. */
const SOURCE_R = 30;
/** The dark left between the outermost repo and the endpoints' ring. */
const SOURCE_GAP = 120;
/** How far outside the farthest repo BODY the endpoints' ring must sit, in world units: a repo's name is
 *  drawn at the body, not at its room's edge, and at the fitted view of the merged map (zoom 0.03)
 *  this is some fifty pixels — under a label, but the fans keep the endpoints off the repo's own
 *  bearing. Was 2,800; the operator asked twice for closer. */
const LABEL_ROOM = 1500;
/** How much larger an integration folder is drawn than a plain directory of the same size, and the
 *  dark left between a folder's plain children and its belt of integrations. */
const SYSTEM_R = 1.8;
const SYSTEM_BELT = 60;
/** How much more room than its size an integration is given, so two of them never crowd. */
const SYSTEM_ROOM = 1.35;
/** The least bearing between two endpoints fanned about one repo, in radians: at the fitted view of
 *  the merged map (zoom 0.03, ring 8,100) that is some ninety pixels, a label's width — their
 *  reaches alone would fan them seven pixels apart, and 0.18 put three `mcp:` names in one blob. */
const FAN_MIN = 0.35;
/** How far the sky's radius reaches past the outermost ring, so the fitted view has a margin. */
const SKY_MARGIN = 60;

/** A body: a directory, a directory marked as an integration (`system`), or a repo. */
export const isBodyKind = (kind: UniverseNode['k']): boolean => kind === 'dir' || kind === 'system' || kind === 'galaxy';
/** A source: a machine the stars talk to — a database, an MCP server — a root that is not a repo. */
export const isSourceKind = (kind: UniverseNode['k']): boolean => kind === 'endpoint';
/** A star: a tracked file. A body, the sun and a source are not stars. */
export const isFileKind = (kind: UniverseNode['k']): boolean =>
  !isBodyKind(kind) && kind !== 'core' && !isSourceKind(kind);

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
 *  The room fields — `reach`, `disc`, `ring`, `held` — and the regime fields are born at their
 *  empty values here and written by `placeNodes` and `universeRegimes` in the same `buildGraph`
 *  call. They belong to the literal because they belong to the node: a node that exists is a node
 *  that can be measured, whatever the graph around it has worked out so far. */
export function makeNode(node: UniverseNode, id: number): UniverseGraphNode {
  const kind = node.k;
  const ring = isBodyKind(kind);
  const source = isSourceKind(kind);
  const oa = seedFrom(node, 1) * Math.PI * 2;
  const off = seedFrom(node, 9) < 0.55;
  const pz = off ? (seedFrom(node, 10) < 0.5 ? -1 : 1) * (0.1 + seedFrom(node, 11) * 0.22) : 0;
  return {
    id, label: node.n, kind, p: node.p, depth: 0, lines: node.l, t: node.t,
    r: source ? SOURCE_R : (kind === 'system' ? SYSTEM_R : 1) * (2.4 + Math.min(Math.sqrt(Math.max(node.l, 1)), 120) / 9),
    deg: 0, adj: [],
    x: 0, y: 0, px: 0, py: 0, ox: 0, oy: 0, vx: 0, vy: 0,
    zn: 0, vz: 0, pz, pzd: 0, pzn: 0,
    inc: (kind === 'galaxy' ? 0.44 : ring ? 0.8 : 1.15) * seedFrom(node, 2),
    ph: seedFrom(node, 3) * Math.PI * 2,
    occ: 0, ds: 1, da: 1, tk: 1, bl: 0, f: 1, ft: 1, glow: 0, wx: 0, wy: 0, tr: null,
    oa, oc: Math.cos(oa), os: Math.sin(oa),
    ob: ring ? 0.72 + seedFrom(node, 4) * 0.23 : 0.55 + seedFrom(node, 5) * 0.42,
    odir: isFileKind(kind) && seedFrom(node, 6) < 0.12 ? -1 : 1,
    okep: 1, orest: 1, prec: 0.04 + seedFrom(node, 7) * 0.16,
    ux: 0, uy: 0,
    // Where in its parent's room a node rests, as a fraction of the disc (a star) or the ring (a body):
    // `measureRoom` writes it with `orest`, the birth distance the tree spring then rests at, so a
    // sky is born where its springs will hold it.
    rk: 1,
    tx: 0, ty: 0,
    reach: 0, cx: 0, cy: 0, lx: 0, ly: 0, disc: 0, ring: 0, held: 0, root: id, cluster: 0,
    leaf: false, fr: 0, dk: 'source',
  };
}

/**
 * The room a node's subtree needs, from the leaves up, and where each child is born inside it. Writes
 * `reach`, `cx`/`cy`, `disc` and `ring` on every body and `orest` (the birth distance, which is also
 * the tree spring's rest) on every child; hands back each child's birth bearing, which only the
 * placement reads.
 *
 * A body's files fill an inner disc by ordinal — a sunflower, each star at the radius that gives the
 * disc uniform density, the golden angle apart — and its child bodies fill the annulus outside it, a
 * sunflower again but weighted by area, the small subtrees nearest the parent and the large ones out
 * where the circumference is, each held clear of the files inside — and the integrations last of all,
 * a belt beyond the plain folders. THE ROOM IS THE DISC THAT ENCLOSES
 * ALL OF THAT, AND ITS CENTRE NEED NOT BE THE BODY: a folder whose one child folder holds nearly
 * everything has its room centred between the two, so the room grows by the files' disc per level
 * of nesting, not by a doubling — measured with the body pinned at the centre, an eight-deep chain
 * put cloudcli's room at 8,100 units for 1,233 files. `cx`/`cy` is where the centre sits from the
 * body, in world units, and a parent packs the CENTRES.
 */
function measureRoom(nodes: UniverseGraphNode[], children: number[][]): Float64Array {
  const bearing = new Float64Array(nodes.length);
  /** Whether an integration sits anywhere beneath a body — written as the walk passes it, so a rule
   *  naming a folder two deep still carries its whole line of parents to the belt. */
  const holds = new Uint8Array(nodes.length);
  const deepestFirst = [...nodes].sort((a, b) => b.depth - a.depth);
  for (const n of deepestFirst) {
    if ((n.kind === 'system' || holds[n.id] === 1) && n.p >= 0 && n.p < nodes.length) holds[n.p] = 1;
    if (isFileKind(n.kind)) {
      n.reach = n.r * FILE_ROOM + FILE_ROOM_PAD;
      continue;
    }
    if (isSourceKind(n.kind)) {
      n.reach = n.r * 3;
      continue;
    }
    const files: UniverseGraphNode[] = [];
    const bodies: UniverseGraphNode[] = [];
    for (const id of children[n.id]) (isBodyKind(nodes[id].kind) ? bodies : files).push(nodes[id]);

    let sumSq = 0;
    let maxFile = 0;
    for (const f of files) {
      sumSq += f.reach * f.reach;
      if (f.reach > maxFile) maxFile = f.reach;
    }
    const disc = files.length > 0 ? Math.max(Math.sqrt(DISC_PACK * sumSq), 2 * maxFile, n.r * 2 + maxFile) : 0;
    files.forEach((f, ordinal) => {
      f.rk = Math.max(DISC_FLOOR, Math.sqrt((ordinal + 0.5) / files.length));
      f.orest = disc * f.rk;
      bearing[f.id] = n.oa + ordinal * GOLDEN_ANGLE;
    });

    // Plain folders first, small to large; the integrations after them — and a folder that HOLDS
    // integrations (`extractors/`, `outbound/`) with them — so the estate's reach into its platforms
    // takes the outer belt of the repo, an area of its own.
    const outer = (c: UniverseGraphNode): boolean => c.kind === 'system' || holds[c.id] === 1;
    const rank = (c: UniverseGraphNode): number => (outer(c) ? 1 : 0);
    bodies.sort((a, b) => rank(a) - rank(b) || a.reach - b.reach);
    let bodyArea = 0;
    for (const b of bodies) bodyArea += b.reach * b.reach;
    const inner = disc > 0 ? disc + maxFile : n.r * 3;
    const belt = bodies.some(outer) && bodies.some((c) => !outer(c)) ? SYSTEM_BELT : 0;
    const ring = bodies.length > 0 ? Math.sqrt(inner * inner + BODY_PACK * bodyArea) + belt : 0;
    // The enclosing box of the files' disc and every child's room, as the children are placed by
    // their CENTRES; the room is the disc on that box's centre that reaches every edge.
    let x0 = -inner;
    let y0 = -inner;
    let x1 = inner;
    let y1 = inner;
    const placed: { b: UniverseGraphNode; x: number; y: number }[] = [];
    let taken = 0;
    bodies.forEach((b, ordinal) => {
      const mid = Math.sqrt(inner * inner + BODY_PACK * (taken + (b.reach * b.reach) / 2)) + (outer(b) ? belt : 0);
      taken += b.reach * b.reach;
      const at = Math.max(mid, inner + b.reach);
      const angle = n.oa + ordinal * GOLDEN_ANGLE;
      const x = Math.cos(angle) * at;
      const y = Math.sin(angle) * at;
      placed.push({ b, x, y });
      if (x - b.reach < x0) x0 = x - b.reach;
      if (y - b.reach < y0) y0 = y - b.reach;
      if (x + b.reach > x1) x1 = x + b.reach;
      if (y + b.reach > y1) y1 = y + b.reach;
    });
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let reach = Math.max(n.r * 3, Math.hypot(cx, cy) + inner);
    for (const { b, x, y } of placed) {
      const far = Math.hypot(x - cx, y - cy) + b.reach;
      if (far > reach) reach = far;
      // The child's centre is at (x, y); the child itself sits its own offset back from there.
      const bx = x - b.cx;
      const by = y - b.cy;
      b.orest = Math.hypot(bx, by) || 1;
      b.rk = b.orest / (ring || 1);
      bearing[b.id] = Math.atan2(by, bx);
    }
    n.disc = disc;
    n.ring = ring;
    n.cx = cx;
    n.cy = cy;
    n.reach = n.kind === 'system' ? reach * SYSTEM_ROOM : reach;
  }
  return bearing;
}

/**
 * Every node's starting place, and the child index built on the way — which the graph keeps for its
 * families — with the sky's radius. The sun is the centre; the repos ring it, evenly, on a ring wide
 * enough that neighbours clear each other; the sources ring them. Everything else is born where
 * `measureRoom` put it inside its parent's room.
 */
export function placeNodes(
  nodes: UniverseGraphNode[],
  core: UniverseGraphNode | undefined,
): { children: number[][]; radius: number } {
  const children: number[][] = nodes.map(() => []);
  // An empty map has no sun to ring: the server answers a host whose crawl has never run with no
  // nodes at all, and that is an empty sky, not a throw out of the first frame.
  if (core === undefined) return { children, radius: 0 };
  for (const n of nodes) if (n.p >= 0 && n.p < nodes.length) children[n.p].push(n.id);
  // Parents precede their children in the crawler's order, so one pass gives every depth and root.
  for (const n of nodes) {
    if (n.p >= 0 && n.p < nodes.length) {
      n.depth = nodes[n.p].depth + 1;
      n.root = nodes[n.p].root;
      n.cluster = nodes[n.p].cluster;
    }
  }
  const bearing = measureRoom(nodes, children);

  // THE ROOTS. The repos share one ring around the sun, evenly spaced, the ring wide enough that the
  // sun's own room and every neighbouring pair clear; a source stands outside them, an endpoint at
  // the bearing of the repo that named it — the nearest repo before it in the map's order, which is
  // how the crawler lays a repo's endpoints.
  const roots = nodes.filter((n) => n.p < 0 || n.p >= nodes.length);
  // Largest room first: the repo with the most sources hanging off it takes the top of the sky, where
  // nothing of the panel's own chrome sits over the canvas.
  const repos = roots.filter((n) => isBodyKind(n.kind)).sort((a, b) => b.reach - a.reach);
  const endpoints = roots.filter((n) => n.kind === 'endpoint');
  let repoArea = 0;
  let repoReach = 0;
  let neighbours = 0;
  for (let i = 0; i < repos.length; i++) {
    const g = repos[i];
    repoArea += g.reach * g.reach;
    if (g.reach > repoReach) repoReach = g.reach;
    const next = repos[(i + 1) % repos.length];
    if (repos.length > 1 && g.reach + next.reach > neighbours) neighbours = g.reach + next.reach;
  }
  const chord = repos.length > 1 ? neighbours / (2 * Math.sin(Math.PI / repos.length)) : 0;
  // The sun's own room may be centred off the sun; what a repo must clear is its far edge from the origin.
  const coreRoom = core.reach + Math.hypot(core.cx, core.cy);
  const repoRing = Math.max(Math.sqrt(coreRoom * coreRoom + BODY_PACK * repoArea), coreRoom + repoReach, chord);
  const angleOf = new Map<number, number>();
  // Each repo takes a palette slot by its ordinal, the sun the one past them, and every node below
  // inherits — written before the children are walked, since they read it off their parent.
  repos.forEach((g, index) => {
    g.cluster = index;
  });
  core.cluster = repos.length;
  for (const n of nodes) if (n.p >= 0 && n.p < nodes.length) n.cluster = nodes[n.p].cluster;
  repos.forEach((g, index) => {
    const angle = -Math.PI / 2 + (index / repos.length) * Math.PI * 2;
    angleOf.set(g.id, angle);
    // The repo's ROOM is on the ring; the repo itself sits its own offset back from that centre, and
    // is held there.
    g.px = Math.cos(angle) * repoRing - g.cx;
    g.py = Math.sin(angle) * repoRing - g.cy;
    g.held = Math.hypot(g.px, g.py) || 1;
    g.rk = 1;
    g.orest = g.held;
  });
  angleOf.set(core.id, Math.PI / 2);
  let sourceReach = 0;
  for (const n of roots) if (isSourceKind(n.kind) && n.reach > sourceReach) sourceReach = n.reach;
  let farthestBody = 0;
  for (const g of repos) farthestBody = Math.max(farthestBody, Math.hypot(g.px, g.py));
  const endpointRing = Math.max(repoRing + repoReach, coreRoom, farthestBody + LABEL_ROOM) + SOURCE_GAP + sourceReach;
  const ownerOf = new Map<number, number>();
  const fanned = new Map<number, number>();
  let owner = core.id;
  for (const n of nodes) {
    if (n.p >= 0) continue;
    if (n.kind === 'galaxy' || n.kind === 'core') owner = n.id;
    else if (n.kind === 'endpoint') {
      ownerOf.set(n.id, owner);
      fanned.set(owner, (fanned.get(owner) ?? 0) + 1);
    }
  }
  const step = Math.max(FAN_MIN, (3 * sourceReach) / (endpointRing || 1));
  const seen = new Map<number, number>();
  for (const e of endpoints) {
    const at = ownerOf.get(e.id) ?? core.id;
    const index = seen.get(at) ?? 0;
    seen.set(at, index + 1);
    // An odd fan about a repo is shifted half a step, so no endpoint sits on the repo's own bearing
    // (an even one already straddles it); the sun's fan is centred, since the sun is at the origin
    // and nowhere near its ring.
    const shift = at === core.id || (fanned.get(at) ?? 1) % 2 === 0 ? 0 : 0.5;
    const angle = (angleOf.get(at) ?? -Math.PI / 2) + (index - ((fanned.get(at) ?? 1) - 1) / 2 + shift) * step;
    e.held = endpointRing;
    e.orest = endpointRing;
    e.px = Math.cos(angle) * endpointRing;
    e.py = Math.sin(angle) * endpointRing;
  }
  const outermost = endpoints.length > 0 ? endpointRing : endpointRing - SOURCE_GAP - sourceReach;
  const radius = outermost + sourceReach + SKY_MARGIN;

  // EVERYTHING ELSE is born where its parent's room put it, once the parent itself is placed.
  for (const n of nodes) {
    if (n.p < 0 || n.p >= nodes.length) continue;
    const parent = nodes[n.p];
    n.px = parent.px + Math.cos(bearing[n.id]) * n.orest;
    n.py = parent.py + Math.sin(bearing[n.id]) * n.orest;
    if (isBodyKind(n.kind) && n.depth <= 1) n.held = n.orest;
  }

  // The ring direction a held node starts on, which the spring then holds it to: a repo, a source,
  // and a body one below a repo — the same set `isRing` names, spelled here so the file stays a leaf.
  for (const n of nodes) {
    n.x = n.px;
    n.y = n.py;
    n.lx = n.px + n.cx;
    n.ly = n.py + n.cy;
    if (n.held <= 0) continue;
    const anchor = n.p >= 0 ? nodes[n.p] : core;
    const dx = n.px - anchor.px;
    const dy = n.py - anchor.py;
    const len = Math.hypot(dx, dy) || 1;
    n.ux = dx / len;
    n.uy = dy / len;
  }

  return { children, radius };
}
