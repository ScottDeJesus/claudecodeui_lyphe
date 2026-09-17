import { DEFAULT_TWEAKS } from '@/modules/universe/utils/universeTweaks';
import type { UniverseActivityRow } from '@/shared/types';

/**
 * FLARES AND PULSES — the estate's two kinds of light, and the whole of what the wire moves.
 *
 * The export lit its sky from a random number generator: `spawn()` invented `GET /jobs` traffic and
 * called it life, `pickSrc()` picked the files it passed through, and a random flash blinked a star
 * every couple of seconds so the canvas would look busy. NONE OF THAT IS PORTED. Every light here
 * comes from a row the estate actually produced — an edit makes its star flare, an execution sends
 * a pulse along the edges the graph really has — and a quiet estate is a dark sky, which is the
 * honest reading rather than a bug to paper over.
 *
 * A FLARE DECAYS TO EXACTLY ZERO, AND THEN IT IS GONE. The export kept a glow on every node that
 * had ever been reached (`n.glow *= 0.94`, asymptotic, never zero), so an old star stayed brighter
 * than the map said. Here a flare is an instant and a strength: the value falls linearly to zero at
 * two thousand four hundred milliseconds, `liveFlares` prunes what has arrived there, and the
 * renderer never walks a dead one.
 *
 * A PULSE ROUTES ON THE REAL GRAPH. A row names the node it resolved to; the light travels from
 * there to that node's endpoint when the graph carries an endpoint edge for it, and to its parent
 * body otherwise — the export's `route()` BFS, kept, now driven by rows instead of by `pickSrc()`
 * and `spawn()`. There is no call-and-response flip: an execution is one leg, not a round trip.
 *
 * ONE CLOCK. Every instant here is epoch MILLISECONDS, the unit the wire's rows carry, and the
 * caller's `now` must be the same clock. `applyRows` is the one entry point the canvas calls with
 * each websocket batch; `live` is the one the renderer calls each frame, and it advances every
 * pulse by the time since the last call — clamped, so a tab that was backgrounded resumes at the
 * pace a person was watching instead of teleporting every light to its destination.
 */

/** The node view the pulse machinery needs: where it falls back to, what it walks, and where it is
 *  drawn. Position is optional because a caller may hand over the graph's own nodes (which have it)
 *  or a bare index (which does not) — a segment of unknown length still advances. */
export type PulseNode = {
  p: number;
  adj: readonly number[];
  x?: number;
  y?: number;
};

/** What `createPulses` is handed: the nodes, and the links that say where an execution ends.
 *  `UniverseGraph` satisfies this as it stands. */
export type PulseGraph = {
  nodes: readonly PulseNode[];
  /** The graph's own edges: a star with an `endpoint` link routes along it, which is what makes a
   *  query end at the database rather than at the folder beside it. */
  links?: readonly { a: number; b: number; kind: string }[];
};

/** One pulse in flight: the path it walks and how far along it has come. */
export type UniversePulse = {
  /** Node indices, from where the execution started to where it terminates. */
  path: number[];
  /** The segment it is on, and how far along it — `t` is `0..1` and the exports's own convention. */
  seg: number;
  t: number;
};

/** One live flare: the star, and what is left of its light. */
export type UniverseFlare = { node: number; value: number };

export type UniversePulses = {
  /** How fast light travels, in world units a second over the export's own base. The owner writes
   *  `tweaks.pulseSpeed` here each frame; it is read as each pulse moves, never cached. */
  speed: number;
  /** An edit: this star's light, for `count` raw events at `at`. */
  flare(node: number, count: number, at: number): void;
  /** What is left of a star's flare at `now`, `0` once it has burned out. */
  flareAt(node: number, now: number): number;
  /** Every flare still above zero — what the renderer's glow pass walks. */
  liveFlares(now: number): UniverseFlare[];
  /** An execution: route from this star to its endpoint, or to its parent body. */
  pulse(node: number, at: number): void;
  /** Every pulse in flight, advanced to `now`. */
  live(now: number): readonly UniversePulse[];
  /** The canvas's one entry point: a websocket batch, and the instant it landed. */
  applyRows(rows: readonly UniverseActivityRow[], now: number): void;
};

/** How long a flare burns from full to nothing. Reaching exactly zero is the point. */
const FLARE_MS = 2400;
/** What one event lights, and what each further event in the same flare adds. */
const FLARE_FLOOR = 0.45;
const FLARE_PER_EVENT = 0.18;
/** How fast a pulse travels, in world units a second, before `speed` scales it. */
const BASE_SPEED = 330;
/** How many pulses may be in flight at once — a burst beyond this is dropped, as the export's own
 *  cap did, rather than costing a frame's worth of comet tails nobody could follow. */
const MAX_PULSES = 24;
/** The delta a frame may carry into the pulses, in seconds: a backgrounded tab returns with a gap
 *  of minutes, and a light that jumped its whole path would be a light nobody saw. */
const MAX_DELTA_S = 0.1;
/** The token an execution's light is drawn in — the info tone, because an execution is a machine
 *  answering rather than a fault. `--warn-ink` and `--danger` are not this lane's to spend. */
export const PULSE_TOKEN = '--info-ink';

/**
 * The estate's lights for one canvas. The graph is held, never copied: a pulse reads a node's live
 * position each time it moves, so a star that is orbiting carries its light with it.
 */
export function createPulses(graph: PulseGraph, speed: number = DEFAULT_TWEAKS.pulseSpeed): UniversePulses {
  const nodes = graph.nodes;
  const flares = new Map<number, { at: number; strength: number }>();
  const pulses: UniversePulse[] = [];
  /** Where each star's executions end, read off the graph's own endpoint links once. */
  const endpoints = new Map<number, number>();
  for (const link of graph.links ?? []) {
    if (link.kind !== 'endpoint') continue;
    if (!endpoints.has(link.a)) endpoints.set(link.a, link.b);
    if (!endpoints.has(link.b)) endpoints.set(link.b, link.a);
  }
  let lastAdvance = 0;
  /** The live travel rate, read as each pulse moves. Held here rather than on the returned object
   *  so `advance` reads it directly and the owner may write it from any frame. */
  let currentSpeed = speed;

  const known = (node: number): boolean => Number.isInteger(node) && node >= 0 && node < nodes.length;

  /** What is left of a flare at `now`, before the flare is thrown away. */
  const leftOf = (held: { at: number; strength: number }, now: number): number => {
    if (now - held.at >= FLARE_MS) return 0;
    return Math.max(0, 1 - (now - held.at) / FLARE_MS) * held.strength;
  };

  const destinationOf = (node: number): number | null => {
    const edged = endpoints.get(node);
    if (edged !== undefined) return edged;
    const parent = nodes[node].p;
    return parent >= 0 && parent < nodes.length ? parent : null;
  };

  /**
   * The BFS between two nodes, the export's `route()` with the birth clock taken out: the map
   * arrives whole, so every node is walkable from the first frame and there is nothing to wait for.
   */
  function route(from: number, to: number): number[] | null {
    if (from === to) return [from];
    const previous = new Map<number, number>([[from, -1]]);
    const queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const here = nodes[queue[i]];
      if (here === undefined) continue;
      for (const next of here.adj) {
        if (previous.has(next) || !known(next)) continue;
        previous.set(next, queue[i]);
        if (next !== to) {
          queue.push(next);
          continue;
        }
        const path = [to];
        for (let step = queue[i]; step >= 0; step = previous.get(step) ?? -1) path.push(step);
        return path.reverse();
      }
    }
    return null;
  }

  /** Several stops joined into one path — the export's `chain()`, with the same answer: `null`
   *  when any leg has no route at all. A row names two stops today, and this is what makes them
   *  one light; a leg that cannot be walked leaves the execution unlit rather than half-drawn. */
  function chain(stops: readonly number[]): number[] | null {
    const path: number[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = route(stops[i], stops[i + 1]);
      if (leg === null) return null;
      path.push(...(i === 0 ? leg : leg.slice(1)));
    }
    return path;
  }

  /** Walks one pulse forward by `dt` seconds, segment by segment, and reports whether it is spent.
   *  A path that leaves the node list — a stale map's row — is spent rather than walked off the end. */
  function advance(pulse: UniversePulse, dt: number): boolean {
    let move = BASE_SPEED * currentSpeed * dt;
    while (move > 0 && pulse.seg < pulse.path.length - 1) {
      const a = nodes[pulse.path[pulse.seg]];
      const b = nodes[pulse.path[pulse.seg + 1]];
      if (a === undefined || b === undefined) return true;
      const length = Math.hypot((b.x ?? 0) - (a.x ?? 0), (b.y ?? 0) - (a.y ?? 0)) || 1;
      const remaining = (1 - pulse.t) * length;
      if (move < remaining) {
        pulse.t += move / length;
        move = 0;
      } else {
        move -= remaining;
        pulse.seg++;
        pulse.t = 0;
      }
    }
    return pulse.seg >= pulse.path.length - 1;
  }

  const flare = (node: number, count: number, at: number): void => {
    if (!known(node)) return;
    const strength = Math.min(1, FLARE_FLOOR + FLARE_PER_EVENT * Math.max(1, count));
    const held = flares.get(node);
    // A second edit landing on a star that is still burning does not dim it: the flare keeps the
    // brighter of the new event and what the old one had left.
    const carried = held === undefined ? 0 : leftOf(held, at);
    flares.set(node, { at, strength: Math.max(strength, carried) });
  };

  const flareAt = (node: number, now: number): number => {
    const held = flares.get(node);
    if (held === undefined) return 0;
    const left = leftOf(held, now);
    if (left === 0) flares.delete(node);
    return left;
  };

  const liveFlares = (now: number): UniverseFlare[] => {
    const live: UniverseFlare[] = [];
    for (const [node, held] of flares) {
      const value = leftOf(held, now);
      if (value === 0) flares.delete(node);
      else live.push({ node, value });
    }
    return live;
  };

  /** `_at` is the instant the row carried: a pulse starts HERE, on the clock `live` will advance it
   *  by, so the instant is part of the entry point's shape and not of its arithmetic. */
  const pulse = (node: number, _at: number): void => {
    if (!known(node) || pulses.length >= MAX_PULSES) return;
    const destination = destinationOf(node);
    if (destination === null || destination === node) return;
    const path = chain([node, destination]);
    if (path === null || path.length < 2) return;
    pulses.push({ path, seg: 0, t: 0 });
  };

  const live = (now: number): readonly UniversePulse[] => {
    const dt = lastAdvance === 0 ? 0 : Math.min(MAX_DELTA_S, Math.max(0, (now - lastAdvance) / 1000));
    lastAdvance = now;
    let kept = 0;
    for (const pulse of pulses) {
      if (!advance(pulse, dt)) pulses[kept++] = pulse;
    }
    pulses.length = kept;
    return pulses;
  };

  const applyRows = (rows: readonly UniverseActivityRow[], now: number): void => {
    for (const row of rows) {
      if (!known(row.node)) continue;
      // A row stamped by a clock ahead of this browser's is drawn as fresh rather than as a light
      // from the future, which would be a flare nothing could ever decay.
      const at = Math.min(row.at, now);
      if (row.kind === 'edit') flare(row.node, row.count, at);
      else pulse(row.node, at);
    }
  };

  return {
    get speed(): number {
      return currentSpeed;
    },
    set speed(value: number) {
      currentSpeed = value;
    },
    flare,
    flareAt,
    liveFlares,
    pulse,
    live,
    applyRows,
  };
}
