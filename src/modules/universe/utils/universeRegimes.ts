import { isFileKind } from '@/modules/universe/utils/universeBirth';
import { SCREEN_PAD, viewportBounds } from '@/modules/universe/utils/universeView';
import type { UniverseGraph, UniverseGraphNode } from '@/modules/universe/utils/universeGraph';
import type { UniverseNode } from '@/shared/types';
import type { Viewport } from '@/modules/universe/utils/universeView';
import { hiddenKind } from '@/modules/universe/utils/universeTweaks';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * THE TWO REGIMES THE CAMERA PUTS THE SKY IN — who is coarse, and who is on the active list.
 *
 * TWO ANSWERS, ONE WALK OF THE BODIES. `coarse` says the zoom has shrunk every star under a pixel,
 * so files are neither simulated nor drawn and each leaf directory draws one cloud instead. `act` is
 * the list every display loop and every draw pass walks: every body, plus every file whose parent
 * body the camera can see. The rebuild READS all 10,103 nodes — every body, and behind it each of
 * its file children, whose drawn spread is the extent that body is marked by — but it TESTS almost
 * none of them: no node's visibility is asked and no distance measured, only a body's own four
 * comparisons decide whether its children come along. What the loops used to pay per node is what
 * this removes (0.174 ms a frame for the whole rebuild on the merged map).
 *
 * THE PAD IS ONE NUMBER AND THE BODY'S EXTENT IS ON TOP OF IT. `viewportBounds` gives the rectangle
 * the renderer draws against; a body is marked when it falls inside that rectangle grown by its own
 * extent, so a directory carrying its stars in from the edge does not take them with it. A file then
 * enters the list through its marked parent, which makes `act` a superset of what the renderer admits
 * by construction: a star that reaches the canvas was carried there by a parent that was marked.
 *
 * THE EXTENT IS MEASURED EVERY FRAME, NOT REMEMBERED FROM BIRTH. `fr` — the mean birth distance of a
 * body's file children — is the cloud the coarse view DRAWS (`universeClouds`), a property of the
 * tree. The cloud a frame has to COVER is not: the springs and the cross edges carry a settled star
 * far off its birth ring (measured p50 2.6x and p90 8.4x `fr` after 600 frames on the merged map),
 * and the parallax shear spreads a cloud further still the further the camera sits from it. A star
 * drawn inside the rectangle whose parent's birth extent never reached it would be in no list at all
 * — neither simulated nor drawn, for ever. So the mark measures the axis gaps the frame will actually
 * draw its stars at, in the same display units the rectangle is built from, once per frame: the
 * extent is the layout's, and the layout moves.
 *
 * EVERY PARENT IS IN THE INDEX, NOT ONLY EVERY BODY. Eight files on the merged map hang directly off
 * the sun, which is not a body — `families`, the wobble's index, stops there — so the regimes read
 * the `children` index `birthRegimes` builds, which has every parent in it.
 *
 * AFTER THIS CALL, EVERY DISPLAY LOOP WALKS `graph.act`. The relaxation is not one of them: it is
 * whole-graph by physics and is bounded by its own cadence instead (`universeForces`), which is what
 * keeps a frozen off-screen star from being frozen into the sky for ever.
 */

/** The zoom under which every star is sub-pixel, and files leave the simulation and the drawing. */
const COARSE_Z = 0.3;

/** The file kinds a body's `dk` is chosen between, in the order a tie is broken. */
const FILE_KINDS: readonly UniverseNode['k'][] = [
  'source',
  'config',
  'docs',
  'data-sql',
  'assets',
  'other',
];

/** The kind most of a body's file children carry, or `source` when it has none. */
function dominant(kinds: Map<UniverseNode['k'], number> | undefined): UniverseNode['k'] {
  if (kinds === undefined) return 'source';
  let best: UniverseNode['k'] = 'source';
  let most = 0;
  for (const kind of FILE_KINDS) {
    const count = kinds.get(kind) ?? 0;
    if (count > most) {
      most = count;
      best = kind;
    }
  }
  return best;
}

/**
 * The regime outputs a body is born with, the body list itself, and the children index both the
 * regimes and nothing else read — the one walk `buildGraph` makes over what `placeNodes` already
 * knows. Pure: it reads positions and kinds and touches no document, which is what lets a Node script
 * build a graph and a bench step it.
 *
 * `leaf` is a directory with no directory children, `fr` the mean birth distance of a body's own file
 * children, `dk` the kind most of them carry. Distances are read off the BIRTH positions, so the
 * extent is a property of the tree rather than of the frame the sky happens to be on.
 */
export function birthRegimes(byDepth: UniverseGraphNode[]): {
  bodies: UniverseGraphNode[];
  children: (UniverseGraphNode[] | undefined)[];
} {
  // The nodes by their own id — `byDepth` is sorted by depth, so its index is not an id, and the
  // parent a node names is one.
  const byId: (UniverseGraphNode | undefined)[] = [];
  const children: (UniverseGraphNode[] | undefined)[] = [];
  for (const n of byDepth) byId[n.id] = n;
  const dirChildren = new Uint8Array(byDepth.length);
  const kinds = new Map<number, Map<UniverseNode['k'], number>>();
  const reach = new Float64Array(byDepth.length);
  const carried = new Uint32Array(byDepth.length);
  for (const n of byDepth) {
    // The parent index, built on the way: a root names no parent and sits on no one's ring.
    if (n.p >= 0 && n.p < byDepth.length) {
      const list = children[n.p];
      if (list === undefined) children[n.p] = [n];
      else list.push(n);
    }
    const parent = byId[n.p];
    if (parent === undefined) continue;
    if (n.kind === 'dir' || n.kind === 'system') dirChildren[parent.id] = 1;
    if (!isFileKind(n.kind)) continue;
    let counts = kinds.get(parent.id);
    if (counts === undefined) {
      counts = new Map();
      kinds.set(parent.id, counts);
    }
    counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    reach[parent.id] += Math.hypot(n.px - parent.px, n.py - parent.py);
    carried[parent.id]++;
  }
  for (const n of byDepth) {
    n.leaf = (n.kind === 'dir' || n.kind === 'system') && dirChildren[n.id] === 0;
    n.fr = carried[n.id] > 0 ? reach[n.id] / carried[n.id] : 0;
    n.dk = dominant(kinds.get(n.id));
  }
  return { bodies: byDepth.filter((n) => !isFileKind(n.kind)), children };
}

/**
 * The mark a body carries this frame, by node id, ONE PER GRAPH. Held here rather than on the graph
 * because the regimes are a pure function of it, and keyed by graph rather than held module-wide for
 * the same reason `relaxTick` lives on the graph and `focusNear` on a WeakMap: a page with two skies
 * would otherwise answer one canvas's hit test from the other's marks. No allocation per frame after
 * the first — the mark is filled, never rebuilt, once the graph has been seen.
 */
const marks = new WeakMap<UniverseGraph, Uint8Array>();

/** The mark array for this graph, cleared and sized for it. */
function marksFor(graph: UniverseGraph): Uint8Array {
  const seen = marks.get(graph);
  if (seen !== undefined && seen.length >= graph.nodes.length) {
    seen.fill(0);
    return seen;
  }
  const fresh = new Uint8Array(graph.nodes.length);
  marks.set(graph, fresh);
  return fresh;
}

/**
 * This frame's regimes, from the viewport the caller is drawing. The active list is rebuilt in
 * place: the bodies first, in `byDepth` order, so a parent is stepped before its children by every
 * loop that follows; then, unless the sky is coarse, the files of every marked body.
 */
/** A node the files tweak hides this frame: neither in the active list nor drawn, so its `x`/`y` are
 *  frozen where the float pass last wrote them — every light pass asks this before it draws at them.
 *  Lives here, not on `universeGraph`, because `codeOnly` is written here and a value import back
 *  from there would cycle. */
export const isHidden = (graph: UniverseGraph, n: UniverseGraphNode): boolean =>
  graph.codeOnly && n.kind !== 'source' && isFileKind(n.kind);

export function updateRegimes(graph: UniverseGraph, view: Viewport, tweaks: UniverseTweaks): void {
  graph.coarse = view.z < COARSE_Z;
  graph.codeOnly = tweaks.files === 'code';
  const act = graph.act;
  const bodies = graph.bodies;
  act.length = 0;
  for (const body of bodies) act.push(body);
  if (graph.coarse) return;

  const marked = marksFor(graph);
  // The bare rectangle: the renderer's pad and the body's own extent are added per body below, so
  // nothing is allocated in the loop and nothing is measured against a rectangle that has not moved.
  const bounds = viewportBounds(view, 0);
  for (const body of bodies) {
    const kids = graph.children[body.id];
    if (kids === undefined) continue;
    // The extent the frame will draw at, per axis and on the same display positions `visible()`
    // reads, so the rectangle the renderer admits a star inside is covered by construction.
    let farX = 0;
    let farY = 0;
    for (const kid of kids) {
      if (!isFileKind(kid.kind) || hiddenKind(kid.kind, tweaks)) continue;
      const dx = Math.abs(kid.x - body.x);
      const dy = Math.abs(kid.y - body.y);
      if (dx > farX) farX = dx;
      if (dy > farY) farY = dy;
    }
    const padX = SCREEN_PAD + farX;
    const padY = SCREEN_PAD + farY;
    if (
      body.x > bounds.x0 - padX &&
      body.x < bounds.x1 + padX &&
      body.y > bounds.y0 - padY &&
      body.y < bounds.y1 + padY
    ) {
      marked[body.id] = 1;
      for (const kid of kids) if (isFileKind(kid.kind) && !hiddenKind(kid.kind, tweaks)) act.push(kid);
    }
  }
}

/**
 * Whether a node is on this frame's active list — what the pointer's hit test asks before it
 * measures a distance, since a star that is not simulated this frame is not a star a hand can be
 * on. A body is always carried; a file is carried only when its parent was marked, and never while
 * the sky is coarse.
 */
export function isActive(graph: UniverseGraph, node: UniverseGraphNode): boolean {
  if (!isFileKind(node.kind)) return true;
  if (graph.coarse) return false;
  if (isHidden(graph, node)) return false;
  const marked = marks.get(graph);
  return marked !== undefined && marked[node.p] === 1;
}
