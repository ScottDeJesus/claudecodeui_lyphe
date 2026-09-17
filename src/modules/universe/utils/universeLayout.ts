import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import { advanceTemperature, relax } from '@/modules/universe/utils/universeForces';
import {
  anchorOf,
  applyGravity,
  isBody,
  isFile,
  orb,
  ringTarget,
} from '@/modules/universe/utils/universeGraph';
import { updateRegimes } from '@/modules/universe/utils/universeRegimes';
import type { UniverseGraph } from '@/modules/universe/utils/universeGraph';
import type { Viewport } from '@/modules/universe/utils/universeView';

// The layout's public surface, unchanged by the split: this file is still where a caller asks for
// the graph and for a frame of it. The graph itself lives in `universeGraph`, the relaxation in
// `universeForces` — cut by cohesion, so the model, the forces and the frame each change together.
export { applyGravity, buildGraph } from '@/modules/universe/utils/universeGraph';
export type {
  UniverseGraphLink,
  UniverseGraphNode,
  UniverseGraphSource,
} from '@/modules/universe/utils/universeGraph';

/**
 * ONE FRAME OF THE SKY — the port of the export's `step()`: the orbit, the temperature, the forces
 * (`universeForces`), the wobble, the depth, the float, the transits, the display factors and the
 * trails.
 *
 * THE TWEAKS ARE READ HERE, EVERY FRAME, AND NEVER HELD. Moving a slider changes the next frame's
 * motion and nothing else: no graph is rebuilt, no position is reseeded, no loop is restarted.
 *
 * A ZERO IS NOT A PASS RUNNING AT ZERO STRENGTH. Wobble, doppler, transits, depth of field and
 * trails each sit behind their own tweak, and when it is off the loop is not entered and the fields
 * it would write are not written — the default frame pays for none of them. Each of those passes is
 * its own loop for exactly that reason: a branch inside a loop that must run anyway is a skipped
 * field, but it is still a node walked.
 *
 * THE DELTA IS CLAMPED. A tab that was backgrounded returns with a delta of minutes; a quarter of
 * an orbit in one frame would fling every body outward through the physics, so the clock is capped
 * at 100 ms and the sky resumes at the pace a person was watching.
 *
 * AND ONE THING A HAND NEEDS WITHOUT A FRAME: `dragTo`, the inverse of the float pass, so a pointer
 * handler can put a node where the pointer is instead of a parallax offset away from it.
 *
 * THE CAMERA ARRIVES AS A VIEWPORT, AND A FRAME WALKS THE ACTIVE LIST. `view` is the whole of what
 * this file reads off the camera, and `updateRegimes` turns it into the frame's two answers before
 * any loop runs: whether the sky is coarse, and which nodes are active. Every DISPLAY loop below —
 * the orbit, the depth, the doppler, the float, the display factors and the trails — walks
 * `graph.act`: every body, plus the files of a body the camera can see, bodies first in `byDepth`
 * order so a parent is always stepped before its children. On `graph.nodes` what is left is the
 * switch-off clears, which run once when a pass goes off and reset fields that belong to the graph
 * rather than to the frame. The relaxation is not an active-list pass either: it is whole-graph by
 * physics, and `coarse` is what bounds it instead, by skipping the call outright — never by handing
 * it a zero.
 *
 * THE FOCUS FACTOR IS WRITTEN BY THE PASS THAT ALREADY WALKS THE LIST. A star outside the focus's
 * neighbourhood is dimmed toward `DIM_FOCUS`, and which stars those are is a property of the pivot,
 * not of the frame — so the neighbourhood is a Set, held per graph and rebuilt only when the focus
 * moves, and the float pass writes the target on the nodes it is walking anyway. A pivot change
 * therefore costs the pivot's own neighbourhood and no walk of the estate: the ten thousand stars
 * off screen are not written, and they need not be, since the factor is read only where it is
 * written.
 */

/** Orbital advance per millisecond of orbit rate — the export's 2.6e-5. */
const ORBIT_RATE = 2.6e-5;
/** How hard the barycentre wobble tugs a parent toward its heavy children. */
const WOBBLE = 0.7;
/** The delta a frame may carry into the simulation, in milliseconds. */
const MAX_DELTA_MS = 100;
/** The temperature a sky leaving the coarse regime is re-warmed to — the floor `universeForces`
 *  holds under a still-moving layout. It has to sit above that file's `ALPHA_REST`, or `relax` takes
 *  the early return and the sky never moves again, and at or under its `ALPHA_FLOOR`, or the resume
 *  is a frame of birth heat rather than the cadence's tide. The three numbers move together: a floor
 *  above this leaves a zoom-in a hair cool, a floor below it brings the 30 ms frames back. It cannot
 *  be imported — the floor is private to a file this phase must not touch — so it is named here for
 *  what it does. */
const RESUME_HEAT = 0.03;
/** What a star outside the focus's own neighbourhood is dimmed to while a focus stands. The
 *  export's own value, and the only reason the graph carries a focus factor per node. */
const DIM_FOCUS = 0.1;

/** The focus's neighbourhood — the pivot and its neighbours — per graph, and the pivot it was built
 *  for. One Set per pivot change rather than one per frame, and the graph it belongs to is the key,
 *  so two skies never dim each other's stars. */
const focusNear = new WeakMap<UniverseGraph, { pivot: number | null; near: Set<number> | null }>();

function neighboursOf(graph: UniverseGraph): Set<number> | null {
  const hit = focusNear.get(graph);
  if (hit !== undefined && hit.pivot === graph.focus) return hit.near;
  const near =
    graph.focus === null ? null : new Set([graph.focus, ...(graph.nodes[graph.focus]?.adj ?? [])]);
  focusNear.set(graph, { pivot: graph.focus, near });
  return near;
}

export function stepLayout(
  graph: UniverseGraph,
  now: number,
  tweaks: UniverseTweaks,
  view: Viewport,
): void {
  // An empty map builds a graph with no nodes at all — and so no sun. The guard is here so a project
  // with nothing in it draws an empty sky rather than throwing out of a frame, sixty times a second.
  if (graph.nodes.length === 0) return;
  const dtms = Math.min(MAX_DELTA_MS, Math.max(0, now - graph.lastNow));
  graph.lastNow = now;
  // The regime the LAST frame was in, read before this frame's call overwrites it: leaving the
  // coarse regime is the one transition the temperature below cares about.
  const wasCoarse = graph.coarse;
  // The frame's regimes, from the camera it is drawn for, before any loop below reads a list.
  updateRegimes(graph, view);
  // The parallax origin is the camera's own world position, taken from the viewport here: the float
  // pass slides every star against it and `dragTo` is its inverse. The owner writes the same two
  // fields before it calls in, because a drag is solved before this runs and must not lag a frame.
  graph.camX = view.x;
  graph.camY = view.y;
  applyGravity(graph, tweaks.gravity);

  // orbit — nested elliptical orbits: packages around the core, folders around packages, files
  // around folders. Every body has its own ellipse and pace; the weak physics below untangles them.
  const w = tweaks.orbit * ORBIT_RATE * dtms;
  if (w) {
    for (const n of graph.act) {
      n.ox = n.px;
      n.oy = n.py;
    }
    for (const n of graph.act) {
      if (n.kind === 'core' || n.id === graph.dragging) continue;
      const parent = anchorOf(graph, n);
      // The export's ladder, generalised: a ring body turns slowest, a folder twice that, a star
      // three times — an inner star laps its outer siblings, which is what makes the motion alive.
      const th = w * (isFile(n) ? 3 : n.depth > 1 ? 2 : 1);
      // apsidal precession: the ellipse itself slowly turns, so no orbit ever repeats exactly.
      if (tweaks.precession) {
        n.oa += th * n.prec * tweaks.precession;
        n.oc = Math.cos(n.oa);
        n.os = Math.sin(n.oa);
      }
      const [dx, dy] = orb(n, n.ox - parent.ox, n.oy - parent.oy, th);
      n.px = parent.px + dx;
      n.py = parent.py + dy;
    }
    // The ring bodies also turn their ring: the spring below chases this target, so a body's orbit
    // is its Kepler wobble around a ring that is itself going round.
    for (const h of graph.hubs) {
      const [ux, uy] = orb(h, h.ux, h.uy, w);
      h.ux = ux;
      h.uy = uy;
      ringTarget(graph, h);
    }
  }

  // The temperature is advanced every frame, coarse included — that is what a coarse spell spends:
  // a coarse frame is the fitted view's 0.4 ms, so a few seconds at that zoom run the birth heat
  // down to rest. What coarse skips is the relaxation itself, because at that zoom a step moves a
  // star under a pixel and the picture is the same — never by handing it a zero instead.
  // THE ONE THING THE SKIPPED CALL TAKES WITH IT. `relax` is also the only thing that raises
  // `graph.speed`, and the floor the temperature holds under a still-moving layout is held only
  // while `speed` is above `SETTLED_SPEED`. A sky that spent the coarse spell cold then calls
  // `relax` with an A at or under `ALPHA_REST`, which returns at `universeForces.ts:90` with `speed`
  // zeroed — and no later frame can bring back either one, so the relaxation is over and the sky
  // stays in its birth phyllotaxis for the rest of the session. So the frame that LEAVES the coarse
  // regime re-warms a temperature under the floor to it, the way `applyGravity` re-warms one to
  // reach a new shape: from the floor the relaxation takes its step on the cadence (`RELAX_EVERY`
  // frames in), that step raises `speed` past `SETTLED_SPEED`, and the floor is held again — the
  // settling resumes as a tide, which is what a reviewer measured settling a cold layout (713,800
  // units of travel over 360 frames), rather than as a storm of birth-heat frames. It is the one
  // frame: a sky already warm is left alone, and from the next frame on the temperature is the
  // relaxation's own again, so a sky whose orbit is off spends the one tide and ends.
  const heat = advanceTemperature(graph, w !== 0);
  if (!graph.coarse) {
    if (wasCoarse && heat < RESUME_HEAT) graph.alpha = RESUME_HEAT;
    relax(graph, graph.alpha);
  }

  // barycentre wobble — a parent is tugged toward its heavy children (display only, mass ∝ r²).
  // Off, the offsets it wrote are cleared once and then never touched again: `wx` and `wy` are zero
  // from birth, zero again the frame the tweak goes off, and no frame pays for the loop.
  const wobble = tweaks.wobble * WOBBLE;
  if (wobble) {
    graph.wobbleOn = true;
    for (const family of graph.families) {
      const p = family.p;
      let sx = 0;
      let sy = 0;
      let sm = 0;
      for (const m of family.kids) {
        const mm = m.r * m.r;
        sx += mm * (m.px - p.px);
        sy += mm * (m.py - p.py);
        sm += mm;
      }
      const mass = sm + 5 * p.r * p.r;
      p.wx = (-wobble * sx) / mass;
      p.wy = (-wobble * sy) / mass;
    }
  } else if (graph.wobbleOn) {
    graph.wobbleOn = false;
    for (const n of graph.nodes) {
      n.wx = 0;
      n.wy = 0;
    }
  }

  // depth — each orbit is tilted about its major axis, so the minor-axis part of a child's offset is
  // really a rise toward the viewer. Children inherit half their parent's depth. This is NOT
  // decoration: the parallax, the perspective scale, the transits and the focus all read it, so it
  // is computed whether or not any of them is drawn.
  const inclination = tweaks.inclination;
  for (const n of graph.act) {
    if (n.kind === 'core') continue;
    const parent = anchorOf(graph, n);
    const dx = n.px - parent.px;
    const dy = n.py - parent.py;
    const uy = -dx * n.os + dy * n.oc;
    const zn = inclination
      ? Math.max(-1.5, Math.min(1.5, (uy * Math.tan(n.inc * inclination)) / (n.orest || 1)))
      : 0;
    n.zn = zn + (parent.zn || 0) * 0.5;
    n.pzd = parent.pzd + n.pz + zn * 0.3;
  }

  // doppler — radial velocity, smoothed, which the renderer tints blue while a star rises toward
  // the viewer and red as it sinks away. Its own loop, entered only when that tint is switched on,
  // and the two fields it owns are cleared once when it is switched off again.
  if (tweaks.doppler) {
    graph.dopplerOn = true;
    for (const n of graph.act) {
      if (n.kind === 'core') continue;
      const instance = ((n.zn - n.pzn) * 1e5) / Math.max(8, dtms);
      n.pzn = n.zn;
      n.vz += (instance - n.vz) * 0.08;
    }
  } else if (graph.dopplerOn) {
    graph.dopplerOn = false;
    for (const n of graph.nodes) {
      n.vz = 0;
      n.pzn = 0;
    }
  }

  // gentle float — a smooth offset on top of the resting position, never a force. Off-plane stars
  // also get a parallax shift relative to the camera: nearer ones slide further, farther ones lag.
  // What this pass adds is what `dragTo` has to take back off, or a star at depth lags the hand.
  const parallax = tweaks.parallax;
  // The focus's own answer, asked once for the frame rather than once per node: a star in the
  // pivot's neighbourhood is lit toward 1, every other star toward the dim. Written here, on the
  // nodes this pass draws — the estate off screen is neither written nor read.
  const near = neighboursOf(graph);
  for (const n of graph.act) {
    const amp = n.kind === 'core' ? 0 : isBody(n) ? 1.2 : 2.6;
    const k = n.pzd * parallax;
    n.x = n.px + amp * Math.sin(now / 5200 + n.ph) + (n.px - graph.camX) * k + n.wx;
    n.y = n.py + amp * Math.cos(now / 6300 + n.ph * 1.3) + (n.py - graph.camY) * k + n.wy;
    n.ft = near === null || near.has(n.id) ? 1 : DIM_FOCUS;
    n.f += (n.ft - n.f) * 0.12;
    n.glow *= 0.94;
  }
  graph.core.f += (graph.core.ft - graph.core.f) * 0.12;
  graph.core.glow *= 0.94;

  // transits — within a family, a body clearly nearer the viewer passing over a farther one dims
  // it. Its own loop behind its own flag, so an off pass writes no occupancy anywhere. This pass
  // owns `occ` outright: it clears every family member before it raises any of them, so a body that
  // was dimmed on one frame and not reached on the next goes clear, and switching off clears once.
  if (tweaks.transits) {
    graph.transitsOn = true;
    for (const family of graph.families) {
      family.p.occ = 0;
      for (const k of family.kids) k.occ = 0;
    }
    for (const family of graph.families) {
      const kids = family.kids;
      const p = family.p;
      for (let i = 0; i < kids.length; i++) {
        const a = kids[i];
        for (let j = i + 1; j <= kids.length; j++) {
          const b = j === kids.length ? p : kids[j];
          const dz = a.zn - b.zn;
          if (dz < 0.45 && dz > -0.45) continue;
          const near = dz > 0 ? a : b;
          const far = dz > 0 ? b : a;
          const R = (near.r + far.r) * 1.1;
          const dx = near.x - far.x;
          const dy = near.y - far.y;
          if (dx > R || dx < -R || dy > R || dy < -R) continue;
          const d = Math.hypot(dx, dy);
          if (d < R) far.occ = Math.max(far.occ, (1 - d / R) * Math.min(1, (Math.abs(dz) - 0.45) / 0.6));
        }
      }
    }
  } else if (graph.transitsOn) {
    graph.transitsOn = false;
    for (const n of graph.nodes) n.occ = 0;
  }

  // per-frame display factors: perspective scale and dimming by depth, scintillation for small far
  // stars, transit dimming, and depth of field — the focus sits at the selected (or hovered) star's
  // depth and everything off that plane softens. The blur is written only while the tweak is on;
  // switching it off clears it once, so a sky left focused does not keep a soft frame it no longer
  // draws.
  const twinkle = tweaks.twinkle;
  const perspective = tweaks.perspective;
  const dof = tweaks.depthOfField;
  const blurring = dof > 0;
  if (blurring) {
    const focus = graph.focus === null ? null : graph.nodes[graph.focus];
    if (focus) {
      graph.focusZ += (focus.zn - graph.focusZ) * 0.1;
      graph.dofAmt += (1 - graph.dofAmt) * 0.08;
    } else graph.dofAmt *= 0.92;
  } else if (graph.dofAmt !== 0) {
    graph.dofAmt = 0;
    for (const n of graph.nodes) n.bl = 0;
  }
  for (const n of graph.act) {
    const zn = n.zn;
    n.ds = Math.max(0.45, 1 + zn * 0.25 * (1 + perspective));
    n.tk =
      twinkle && n.kind !== 'core' && !isBody(n)
        ? 1 +
          twinkle *
            (0.12 + 0.14 * Math.max(0, -zn)) *
            Math.min(1.6, 5 / n.r) *
            Math.sin(now * 0.011 + n.ph * 7) *
            Math.sin(now * 0.0067 + n.ph * 3)
        : 1;
    n.da = Math.max(0.3, 1 + zn * 0.3 * (1 + perspective)) * (1 - 0.75 * n.occ);
    if (blurring) {
      n.bl = graph.dofAmt > 0.01 ? Math.min(1, Math.abs(zn - graph.focusZ) * 1.4 * dof) * graph.dofAmt : 0;
    }
  }

  // trails — sample rest positions on a fixed cadence; 40 points span the configured window. Off,
  // the samples collected before it was switched off are dropped once, and then never touched.
  if (tweaks.trails > 0) {
    const interval = Math.max(100, (tweaks.trails * 1000) / 40);
    if (now - graph.lastTrail > interval) {
      graph.lastTrail = now;
      for (const n of graph.act) {
        if (n.kind === 'core' || isBody(n)) continue;
        const trail = n.tr ?? (n.tr = []);
        trail.push(n.px, n.py);
        if (trail.length > 80) trail.splice(0, 2);
      }
    }
  } else if (graph.lastTrail !== -1) {
    graph.lastTrail = -1;
    for (const n of graph.nodes) n.tr = null;
  }
}

/**
 * PUT A NODE UNDER A WORLD POINT — the export's drag inverse, and the reason a star dragged at depth
 * sits under the hand rather than beside it.
 *
 * The float pass draws a node at `p + (p - cam) * k`, so the point the hand is on, in world units, is
 * not the resting position: solving that for `p` gives `(world + cam * k) / (1 + k)`. Velocity is
 * cleared at the same time — a node held by a hand has no momentum of its own, which is the same
 * thing the relaxation's own pin does to it while `dragging` is set.
 */
export function dragTo(
  graph: UniverseGraph,
  id: number,
  worldX: number,
  worldY: number,
  parallax: number,
): void {
  const n = graph.nodes[id];
  if (n === undefined) return;
  const k = n.pzd * parallax;
  n.px = (worldX + graph.camX * k) / (1 + k);
  n.py = (worldY + graph.camY * k) / (1 + k);
  n.vx = 0;
  n.vy = 0;
}
