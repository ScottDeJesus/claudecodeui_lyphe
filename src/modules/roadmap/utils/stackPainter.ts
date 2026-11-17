import type { RoadmapStackFrame, RoadmapStackRest, RoadmapStackTarget, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';

// THE ROADMAP'S STACK, PAINTED. One canvas, and everything that happens on it: where each ring stands, how
// its walls are drawn, how the ring in front turns under a hand, and what a press lands on. It holds no React
// and reads no store: `stack/RoadmapStack` hands it the laid-out tiers (`utils/stackLayout`) and the pointer's
// and keyboard's events, calls `frame` once per animation frame, and says in words what `frame` reports.
//
// THE FORM. Each milestone is a ring. The one in front stands open: every feature of it a wall on the rim, as
// tall as it is far along its path and as solid as it is built, a storey for each task. What is reached lies
// under it, closed into a band, a step lower each: the stack grows from the ground as features ship. What is to
// come hangs over the middle on a mast, smaller and higher the further ahead. Down is done, up is next.
//
// STATE IS FORM, never colour alone: a design's frame is dashed, a build held for its Start is dotted, a paused
// one wears two bars, a parked one is ruled across inside a whole edge, a running task's storey crawls. Colour
// only says the three things that ask for the operator: the accent for a word he owes, the positive colour for
// what shipped while he was away, the danger colour for what is blocked or stalled.
//
// SMALL, AND STANDING. Where its owner gives it a place to rest (`setRest`), the stack is one small circle there
// until it is stood up (`setStanding`): seen from straight above, holding only the features of the ring in front
// that are in flight, shipped or parked, each an arc of the circle, sharing it evenly. Standing up is one move
// in an order (`view`): it grows and tips back while the arcs slide to their own places on the rim; as it tips the
// arcs give way to the walls that were under them; last, everything the circle did not hold comes in — the
// features not yet begun, the rings under and over, the floor. Laid down, the same in reverse.

const TAU = Math.PI * 2;

/** How far each ring leans back, and how much of a wall's height shows at that lean: the eye is about 37 degrees up. */
const TILT = 0.6;
const RISE = 0.8;

/** How far in from the rim the epics' threads lie on the floor of the ring in front, as a share of its radius. */
const EPIC_RHO = 0.69;

/** How wide an arc of the small circle is drawn across the rim, in pixels: half inside it, half outside. */
const ARC_BAND = 10;

/** How long the stack takes to stand up from its circle, and to lie back down, in seconds. */
const STAND_S = 0.85;
const FOLD_S = 0.65;

type Rgb = readonly [number, number, number];
type Colors = { ink: Rgb; body: Rgb; muted: Rgb; accent: Rgb; ground: Rgb; danger: Rgb; done: Rgb };
type Point = readonly [number, number];

/** Where the stack stands in the canvas: the middle of the ring in front, its radius, a full wall's height, a closed ring's band and the step between two of them. */
type Stance = { cx: number; cy: number; radius: number; wall: number; band: number; step: number };

/** Where one ring stands by how far it is from the one in front: how open its walls are, its radius as a share, its height, and a closed wall's height. */
type Place = { away: number; open: number; rho: number; lift: number; flat: number };

/** A ring's own turn: where it is, how fast it is still going after a flick, and where it is headed when it has somewhere to settle. */
type Turn = { rot: number; speed: number; target: number | null };

/** A wall's eased figures, kept by the feature's name across pictures: its height, its fill, the flash of the moment it shipped, and the word it last had. */
type Motion = { frame: number; fill: number; flash: number; word: string };

type Spark = { x: number; y: number; vx: number; vy: number; age: number; size: number; color: Rgb };

/** What a point on the canvas lands on. */
type Hit =
  | { on: 'wall'; wall: RoadmapStackWall }
  | { on: 'epic'; name: string }
  | { on: 'tier'; tier: number }
  | { on: 'ring' };

type Drag = { angle: number; x: number; y: number; moved: number; hit: Hit; at: number; speed: number; touch: boolean };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, share: number) => from + (to - from) * share;
const smooth = (share: number) => share * share * (3 - 2 * share);
const inOut = (share: number) => (share < 0.5 ? 4 * share * share * share : 1 - Math.pow(-2 * share + 2, 3) / 2);
/** An angle folded into (-π, π], so the nearer way round is always the one taken. */
const fold = (angle: number) => {
  let folded = (angle + Math.PI) % TAU;
  if (folded < 0) folded += TAU;
  return folded - Math.PI;
};
const paint = (color: Rgb, alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${clamp(alpha, 0, 1).toFixed(3)})`;

/** The room kept under the stack's foot for the pointer and the words that say what it points at, in pixels. */
const READING_ROOM = 98;

const FALLBACK: Colors = {
  ink: [255, 255, 255], body: [238, 241, 244], muted: [149, 157, 166], accent: [242, 166, 90],
  ground: [8, 9, 11], danger: [255, 123, 107], done: [111, 214, 171],
};

/**
 * The stack's painter over one canvas. Every method is cheap to call per event; `frame` is the one that draws.
 *
 * Used by `stack/RoadmapStack`, which owns the canvas element and its events.
 */
export function createStackPainter(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  let tiers: RoadmapStackTier[] = [];
  let width = 0;
  let height = 0;
  let ratio = 1;
  let stance: Stance = { cx: 0, cy: 0, radius: 100, wall: 20, band: 9, step: 13 };
  // The stance it has standing in the whole canvas; `stance` is on the way between its rest and this while it stands up.
  let full = stance;
  // Where it rests as one small circle (null: it always stands), whether it is asked to stand, and how far up it is, 0 to 1.
  let rest: RoadmapStackRest | null = null;
  let standing = true;
  let grown = 1;
  // The parts of standing up, each 0 to 1 (`view`): grown and tipped, arcs in their places, arcs showing, walls showing, the rest showing.
  let tipped = 1;
  let slid = 1;
  let arcs = 0;
  let wallsIn = 1;
  let othersIn = 1;
  // The lean now: 1 and 0 seen from straight above, `TILT` and `RISE` standing.
  let tilt = TILT;
  let rise = RISE;
  // The small circle lit, under a pointer or the keyboard's focus.
  let peek = false;
  // The feature that keeps the foot of the small circle, by name: the others share the circle round from it.
  let anchorName: string | null = null;
  // Where each wall of the ring in front is drawn while the stack is not fully up: on the way between its share of the small circle and its own place.
  const spots = new Map<string, { at: number; width: number }>();
  let colors = FALLBACK;
  let font = 'ui-monospace, monospace';
  // The ring in front, and the same figure eased, so a change of ring is a move and not a cut.
  let front = 0;
  let frontEased = 0;
  let facing: RoadmapStackWall | null = null;
  // The ring a mouse is over, and the ring a finger chose with its first tap (-1 for none).
  let hover = -1;
  let chosen = -1;
  let drag: Drag | null = null;
  let sparks: Spark[] = [];
  let lastAt = 0;
  let arrived = false;
  let wheelAt = 0;
  let still = false;
  const turns = new Map<string, Turn>();
  const motions = new Map<string, Motion>();
  // The walls of the ring in front as they were last drawn, for a press to land on.
  const wallPaths = new Map<RoadmapStackWall, Path2D>();

  const turnOf = (tier: RoadmapStackTier): Turn => {
    let turn = turns.get(tier.milestone.name);
    if (!turn) {
      turn = { rot: -tier.span / 2, speed: 0, target: null };
      turns.set(tier.milestone.name, turn);
    }
    return turn;
  };
  const shown = () => (chosen >= 0 ? chosen : hover);

  /** Where a ring stands by how far it is from the one in front. */
  const placeOf = (index: number): Place => {
    const away = index - frontEased;
    const near = Math.abs(away);
    return {
      away,
      open: near >= 1 ? 0 : smooth(1 - near),
      rho: away <= 0 ? 1 : away < 1 ? 1 - 0.62 * smooth(away) : 0.38 * Math.pow(0.72, away - 1),
      lift: away <= 0 ? away * stance.step : away < 1 ? stance.radius * 0.16 * smooth(away) : stance.radius * (0.16 + 0.15 * (away - 1)),
      flat: away < 0 ? stance.band : lerp(stance.band, 3, clamp(away, 0, 1)),
    };
  };

  /** A point on a ring: `angle` round it, `up` above its floor, `inward` a share of its radius (1 is the rim). */
  const pointOn = (tier: RoadmapStackTier, place: Place, angle: number, up = 0, inward = 1): Point => {
    const reach = stance.radius * place.rho * inward;
    const turned = angle + turnOf(tier).rot;
    // Seen from straight above a wall's height does not show: it is a line on the rim.
    return [stance.cx + reach * Math.sin(turned), stance.cy + reach * tilt * Math.cos(turned) - (place.lift + up) * rise];
  };
  /** 1 at the front of a ring, where the pointer is; -1 at the back. */
  const depthOf = (tier: RoadmapStackTier, angle: number) => Math.cos(angle + turnOf(tier).rot);

  const wallPath = (tier: RoadmapStackTier, place: Place, from: number, to: number, low: number, high: number) => {
    const path = new Path2D();
    const steps = Math.max(2, Math.ceil((to - from) / 0.035));
    for (let i = 0; i <= steps; i += 1) {
      const point = pointOn(tier, place, lerp(from, to, i / steps), high);
      if (i === 0) path.moveTo(point[0], point[1]);
      else path.lineTo(point[0], point[1]);
    }
    for (let i = steps; i >= 0; i -= 1) {
      const point = pointOn(tier, place, lerp(from, to, i / steps), low);
      path.lineTo(point[0], point[1]);
    }
    path.closePath();
    return path;
  };
  const edgePath = (tier: RoadmapStackTier, place: Place, from: number, to: number, up: number, inward = 1) => {
    const path = new Path2D();
    const steps = Math.max(2, Math.ceil((to - from) / 0.035));
    for (let i = 0; i <= steps; i += 1) {
      const point = pointOn(tier, place, lerp(from, to, i / steps), up, inward);
      if (i === 0) path.moveTo(point[0], point[1]);
      else path.lineTo(point[0], point[1]);
    }
    return path;
  };

  /** Where standing up has got to: every part of it from `grown`, the lean, and the stance on the way from the rest to the full one. */
  const view = () => {
    if (rest === null) {
      tipped = 1; slid = 1; arcs = 0; wallsIn = 1; othersIn = 1; tilt = TILT; rise = RISE;
      stance = full;
      return;
    }
    tipped = inOut(grown);
    slid = inOut(clamp(grown / 0.62, 0, 1));
    arcs = 1 - smooth(clamp((grown - 0.3) / 0.45, 0, 1));
    wallsIn = smooth(clamp(grown / 0.4, 0, 1));
    othersIn = smooth(clamp((grown - 0.5) / 0.5, 0, 1));
    const lean = lerp(Math.PI / 2, Math.asin(TILT), tipped);
    tilt = Math.sin(lean);
    rise = Math.cos(lean);
    stance = { cx: lerp(rest.cx, full.cx, tipped), cy: lerp(rest.cy, full.cy, tipped), radius: lerp(rest.radius, full.radius, tipped), wall: full.wall, band: full.band, step: full.step };
  };

  /** What the small circle holds of a ring: its features in flight, the ones shipped, and what is parked, set aside but in sight. */
  const onCircle = (wall: RoadmapStackWall) => wall.feature.word === 'in flight' || wall.feature.word === 'shipped' || wall.feature.step === 'parked';

  /**
   * Where the walls of the ring in front are drawn while the stack is not fully up. Small, the ones the circle holds share it
   * evenly, in their own order, the one nearest the front keeping the foot; standing, each is where it belongs on the rim.
   */
  const spread = () => {
    spots.clear();
    const tier = tiers[front];
    if (!tier || grown >= 1) return;
    const rot = turnOf(tier).rot;
    const held = tier.walls.filter(onCircle);
    const count = held.length;
    if (count === 0) return;
    let anchor = held.find((wall) => wall.feature.name === anchorName);
    if (!anchor) {
      anchor = held.reduce((best, wall) => (Math.abs(fold(wall.at + rot)) < Math.abs(fold(best.at + rot)) ? wall : best), held[0]);
      anchorName = anchor.feature.name;
    }
    const anchorAt = held.indexOf(anchor);
    const anchorTurn = fold(anchor.at + rot);
    const share = TAU / count;
    for (const [index, wall] of held.entries()) {
      let steps = index - anchorAt;
      if (steps > count / 2) steps -= count;
      if (steps <= -count / 2) steps += count;
      let round = wall.at - anchor.at;
      if (steps > 0 && round < 0) round += TAU;
      if (steps < 0 && round > 0) round -= TAU;
      spots.set(wall.feature.name, { at: wall.at + (steps * share - (anchorTurn + round)) * (1 - slid), width: lerp(share, wall.width, slid) });
    }
  };

  /** The stack in the canvas it has: the ring in front as wide as fits, room over it for a full wall and under it for the closed rings and the words. */
  const fit = () => {
    const reach = Math.min(width / 2 - (width < 700 ? 14 : 40), 380);
    const band = clamp(reach * 0.03, 7, 11);
    const step = band + 4;
    const under = Math.max(0, tiers.length - 1) * step * RISE;
    // Under the foot: the pointer, then three lines of words (`stack/RoadmapStack`'s reading).
    const room = height - 14 - READING_ROOM - under;
    const radius = clamp(Math.min(reach, room / (2 * TILT + 0.27 * RISE)), 70, 380);
    const wall = clamp(radius * 0.2, 18, 72);
    const spare = Math.max(0, (room - 2 * radius * TILT - wall * 1.16 * RISE) / 2);
    full = { cx: width / 2, cy: 14 + wall * 1.16 * RISE + radius * TILT + spare, radius, wall, band, step };
    view();
  };

  const nearestWall = (tier: RoadmapStackTier): RoadmapStackWall | null => {
    const rot = turnOf(tier).rot;
    let best: RoadmapStackWall | null = null;
    for (const wall of tier.walls) if (best === null || Math.abs(fold(wall.at + rot)) < Math.abs(fold(best.at + rot))) best = wall;
    return best;
  };
  const turnTo = (tier: RoadmapStackTier, wall: RoadmapStackWall) => {
    const turn = turnOf(tier);
    turn.target = turn.rot - fold(wall.at + turn.rot);
    turn.speed = 0;
  };
  const settle = (tier: RoadmapStackTier) => {
    const wall = nearestWall(tier);
    if (wall) turnTo(tier, wall);
  };
  const goTier = (index: number) => {
    const next = clamp(index, 0, Math.max(0, tiers.length - 1));
    hover = -1;
    chosen = -1;
    if (next === front || tiers.length === 0) return;
    front = next;
    settle(tiers[front]);
  };
  const angleAt = (x: number, y: number) => Math.atan2((x - stance.cx) / stance.radius, (y - stance.cy) / (stance.radius * tilt));

  /** What a point lands on: a wall of the ring in front, a closed ring under it or a hoop over it, an epic's thread, or the ring itself. */
  const hitAt = (x: number, y: number): Hit | null => {
    const tier = tiers[front];
    if (!tier) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const byDepth = [...tier.walls].sort((a, b) => depthOf(tier, b.at) - depthOf(tier, a.at));
    for (const wall of byDepth) {
      const path = wallPaths.get(wall);
      if (path && ctx.isPointInPath(path, x, y)) return { on: 'wall', wall };
    }
    // A ring under the one in front: the bands below its front edge, a step each.
    const across = (x - stance.cx) / stance.radius;
    if (Math.abs(across) < 1) {
      const below = y - (stance.cy + stance.radius * tilt * Math.sqrt(1 - across * across));
      const steps = Math.ceil((below - 1) / (stance.step * rise));
      if (below > 1 && steps >= 1 && front - steps >= 0) return { on: 'tier', tier: front - steps };
    }
    // A ring over it: the small ones above the middle, the topmost first; anywhere inside one is that one.
    for (let index = tiers.length - 1; index > front; index -= 1) {
      const place = placeOf(index);
      const reach = Math.hypot((x - stance.cx) / stance.radius, (y - (stance.cy - place.lift * rise)) / (stance.radius * tilt));
      if (reach <= place.rho + 0.04) return { on: 'tier', tier: index };
    }
    const rho = Math.hypot(across, (y - stance.cy) / (stance.radius * tilt));
    const angle = fold(angleAt(x, y) - turnOf(tier).rot);
    if (rho > 0.84 && rho < 1.14) {
      const wall = tier.walls.find((item) => Math.abs(fold(angle - item.at)) <= item.width / 2);
      return wall ? { on: 'wall', wall } : { on: 'ring' };
    }
    if (rho > 0.6 && rho <= 0.84) {
      const epic = tier.epics.find((item) => Math.abs(fold(angle - (item.from + item.to) / 2)) <= (item.to - item.from) / 2);
      if (epic) return { on: 'epic', name: epic.epic.name };
    }
    return rho < 1.2 ? { on: 'ring' } : null;
  };

  /**
   * Parked is its own look: a block ruled across with slanting lines inside a whole edge. Nothing about it moves. `up` and
   * `inward` are the block's two edges: a wall runs from the floor up at the rim, an arc of the small circle across the rim.
   */
  const rule = (tier: RoadmapStackTier, place: Place, from: number, to: number, up: readonly [number, number], inward: readonly [number, number], alpha: number, clip: Path2D) => {
    if (alpha < 0.02) return;
    const reach = stance.radius * place.rho;
    const gap = 6.5 / reach;
    const slant = (inward[0] === inward[1] ? up[1] - up[0] : (inward[1] - inward[0]) * reach) / reach;
    ctx.save();
    ctx.clip(clip);
    ctx.strokeStyle = paint(colors.ink, 0.6 * alpha);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let angle = from - slant; angle < to; angle += gap) {
      const low = pointOn(tier, place, angle, up[0], inward[0]);
      const top = pointOn(tier, place, angle + slant, up[1], inward[1]);
      ctx.moveTo(low[0], low[1]);
      ctx.lineTo(top[0], top[1]);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawWall = (tier: RoadmapStackTier, place: Place, wall: RoadmapStackWall, seconds: number) => {
    const { feature } = wall;
    const motion = motions.get(feature.name);
    if (!motion) return;
    const open = place.open;
    // Not fully up, a wall the small circle holds is on its way from its arc, and comes in as the circle tips; every other wall comes in last.
    const spot = spots.get(feature.name);
    const shows = grown >= 1 ? 1 : spot ? wallsIn : othersIn;
    if (shows < 0.02) return;
    const at = spot?.at ?? wall.at;
    const span = spot?.width ?? wall.width;
    const depth = depthOf(tier, at);
    const isFront = depth >= 0;
    const isFacing = wall === facing && open > 0.9 && grown >= 1;
    const from = at - span / 2 + 0.011 / place.rho;
    const to = at + span / 2 - 0.011 / place.rho;
    const tasks = feature.tasks.length;
    const bareIdea = feature.word === 'idea' && wall.tone === null;
    const high = lerp(bareIdea ? Math.min(place.flat, 3) : place.flat, stance.wall * motion.frame, open);
    // Nearer walls are lit, further ones stand back; a closed ring is quieter than the one in front.
    const lit = lerp(place.away < 0 ? 0.3 : 0.4, 1, (depth + 1) / 2) * lerp(place.away < 0 ? 0.62 : 0.7, 1, open) * (isFacing ? 1 : 0.88) * shows;
    const line = wall.tone === 'danger' ? colors.danger : wall.tone === 'warn' ? colors.accent : colors.body;

    if (open > 0.5 && grown >= 1) wallPaths.set(wall, wallPath(tier, place, from, to, 0, Math.max(high, 7)));
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    // An idea is a mark on the floor and nothing more.
    if (bareIdea && open > 0.5) {
      ctx.strokeStyle = paint(colors.muted, 0.7 * lit);
      ctx.lineWidth = 1.5;
      ctx.stroke(edgePath(tier, place, from, to, 0));
      return;
    }

    const frame = wallPath(tier, place, from, to, 0, high);
    const fill = lerp(feature.word === 'shipped' ? 1 : motion.fill, motion.fill, open);
    const moving = feature.step === 'building' || feature.step === 'starting';
    // What is built of it: solid, a storey for each task done.
    if (fill > 0.004) {
      ctx.fillStyle = paint(colors.ink, (isFront ? 0.9 : 0.42) * lit * (feature.word === 'shipped' || moving ? 1 : 0.62));
      ctx.fill(wallPath(tier, place, from, to, 0, high * fill));
    }
    if (wall.tone === 'warn') {
      ctx.fillStyle = paint(colors.accent, lerp(0.5, 0.16, open) * lit);
      ctx.fill(frame);
    }
    // The storey being built now crawls: the one thing on a wall that moves while nothing has changed.
    if (feature.step === 'building' && tasks > 0 && motion.fill < 0.999 && open > 0.3) {
      const low = high * motion.fill;
      const top = Math.min(high, low + high / tasks);
      ctx.fillStyle = paint(colors.ink, 0.16 * lit * open);
      ctx.fill(wallPath(tier, place, from, to, low, top));
      ctx.strokeStyle = paint(colors.ink, 0.95 * lit * open);
      ctx.lineWidth = 1.25;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = still ? 0 : -seconds * 16;
      ctx.stroke(edgePath(tier, place, from, to, top));
      ctx.setLineDash([]);
    }
    // Its frame: how tall it will stand. A design is dashed; a build held or waiting is dotted; what is parked is ruled across, in a whole edge.
    const parked = feature.step === 'parked';
    if (parked && high > 5) rule(tier, place, from, to, [0, high], [1, 1], lit, frame);
    ctx.strokeStyle = paint(parked ? colors.ink : line, (wall.tone !== null || parked ? 0.95 : 0.5) * lit);
    ctx.lineWidth = isFacing || parked ? 1.5 : 1;
    const waits = feature.step === 'queued' || feature.step === 'waiting' || feature.step === 'starting';
    ctx.setLineDash(open < 0.5 || parked ? [] : feature.word === 'designing' ? [3, 3] : waits ? [1, 3] : []);
    ctx.stroke(frame);
    ctx.setLineDash([]);
    // Its storeys, where there is room to read them.
    const across = Math.abs(pointOn(tier, place, to)[0] - pointOn(tier, place, from)[0]);
    if (open > 0.6 && tasks > 1 && high / tasks >= 3.6 && feature.word !== 'designing' && across > 13) {
      for (let storey = 1; storey < tasks; storey += 1) {
        const built = storey / tasks <= motion.fill + 0.001;
        ctx.strokeStyle = built ? paint(colors.ground, 0.85 * open) : paint(colors.body, 0.22 * lit * open);
        ctx.lineWidth = 1;
        ctx.stroke(edgePath(tier, place, from + 0.004, to - 0.004, (high * storey) / tasks));
      }
    }
    if (feature.step === 'paused' && open > 0.6) {
      ctx.strokeStyle = paint(colors.body, 0.9 * lit);
      ctx.lineWidth = 1.5;
      for (const up of [4, 8]) ctx.stroke(edgePath(tier, place, from + span * 0.3, to - span * 0.3, high * motion.fill + up));
    }
    if (feature.step === 'stalled') {
      ctx.strokeStyle = paint(colors.danger, lit);
      ctx.lineWidth = 2.5;
      ctx.stroke(edgePath(tier, place, from, to, high * fill));
    }
    // It shipped while he was away: it stands over the rest with its cap lit, and shows so even on a closed ring.
    if (wall.unseen) {
      ctx.strokeStyle = paint(colors.done, shows);
      ctx.lineWidth = 3;
      ctx.stroke(edgePath(tier, place, from, to, high));
    }
    // It waits on his word: a bead held over it. On the far side of a closed ring there is no wall for it to stand on.
    if (feature.waiting_on_you !== null && (isFront || place.away > -0.5)) {
      const bead = pointOn(tier, place, at, high + lerp(6, 9, open));
      ctx.fillStyle = paint(colors.accent, Math.max(lit, 0.85) * shows);
      ctx.beginPath();
      ctx.arc(bead[0], bead[1], 2.6, 0, TAU);
      ctx.fill();
    }
    if (motion.flash > 0.01) {
      ctx.fillStyle = paint(colors.done, 0.6 * motion.flash);
      ctx.fill(frame);
    }
  };

  /**
   * A feature on the small circle: an arc of it. Shipped, it is whole, and capped in the positive colour until he has looked.
   * In flight, it is filled as far as it is built, round the way a dial fills; the part still to build crawls while it is being
   * built, is dotted while it waits its turn, wears two bars when paused, and is in the danger colour when stalled or blocked.
   * Parked, it is ruled across inside a whole edge, and still.
   */
  const drawArc = (tier: RoadmapStackTier, place: Place, wall: RoadmapStackWall, spot: { at: number; width: number }, seconds: number) => {
    const { feature } = wall;
    const motion = motions.get(feature.name);
    if (!motion) return;
    // The air between two arcs: 2.5px a side, less where a circle holds so many that its arcs would be mostly air.
    const gap = Math.min(2.5, spot.width * stance.radius * 0.12) / stance.radius;
    const from = spot.at - spot.width / 2 + gap;
    const to = spot.at + spot.width / 2 - gap;
    if (to <= from) return;
    const inner = 1 - ARC_BAND / 2 / stance.radius;
    const outer = 1 + ARC_BAND / 2 / stance.radius;
    const bad = wall.tone === 'danger';
    const done = feature.word === 'shipped';
    const band = (start: number, end: number) => {
      const path = new Path2D();
      const steps = Math.max(2, Math.ceil((end - start) / 0.05));
      for (let i = 0; i <= steps; i += 1) {
        const point = pointOn(tier, place, lerp(start, end, i / steps), 0, outer);
        if (i === 0) path.moveTo(point[0], point[1]);
        else path.lineTo(point[0], point[1]);
      }
      for (let i = steps; i >= 0; i -= 1) {
        const point = pointOn(tier, place, lerp(start, end, i / steps), 0, inner);
        path.lineTo(point[0], point[1]);
      }
      path.closePath();
      return path;
    };
    const whole = band(from, to);
    const fill = done ? 1 : motion.fill;
    // It fills from the far end: clockwise, as he looks down on it.
    const built = to - (to - from) * fill;
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    if (feature.step === 'parked') {
      rule(tier, place, from, to, [0, 0], [inner, outer], arcs, whole);
      ctx.strokeStyle = paint(colors.ink, 0.95 * arcs);
      ctx.lineWidth = 1.5;
      ctx.stroke(whole);
      return;
    }
    const moving = feature.step === 'building' || feature.step === 'starting';
    if (fill > 0.004) {
      ctx.fillStyle = paint(bad ? colors.danger : colors.ink, (done ? (wall.unseen ? 1 : 0.5) : moving ? 0.95 : 0.6) * arcs);
      ctx.fill(band(built, to));
    }
    const waits = feature.step === 'queued' || feature.step === 'waiting' || feature.step === 'starting';
    ctx.strokeStyle = paint(bad ? colors.danger : colors.body, (bad ? 0.95 : 0.5) * arcs);
    ctx.lineWidth = 1;
    ctx.setLineDash(waits ? [1, 3] : []);
    ctx.stroke(whole);
    ctx.setLineDash([]);
    if (feature.step === 'building' && fill < 0.995) {
      ctx.strokeStyle = paint(colors.ink, 0.95 * arcs);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = still ? 0 : seconds * 14;
      ctx.stroke(edgePath(tier, place, from + gap, built, 0));
      ctx.setLineDash([]);
    }
    if (feature.step === 'paused') {
      ctx.strokeStyle = paint(colors.body, 0.9 * arcs);
      ctx.lineWidth = 1.5;
      const middle = (from + built) / 2;
      for (const bar of [middle - 1.6 / stance.radius, middle + 1.6 / stance.radius]) {
        const low = pointOn(tier, place, bar, 0, inner + 2 / stance.radius);
        const top = pointOn(tier, place, bar, 0, outer - 2 / stance.radius);
        ctx.beginPath();
        ctx.moveTo(low[0], low[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.stroke();
      }
    }
    if (wall.unseen) {
      ctx.strokeStyle = paint(colors.done, arcs);
      ctx.lineWidth = 3;
      ctx.stroke(edgePath(tier, place, from, to, 0, outer + 3 / stance.radius));
    }
    if (motion.flash > 0.01) {
      ctx.fillStyle = paint(colors.done, 0.7 * motion.flash * arcs);
      ctx.fill(whole);
    }
  };

  /** The floor of the ring in front: a thread for each epic, lit as far as it has shipped, a knot for each feature, and its name. */
  const drawFloor = (tier: RoadmapStackTier, place: Place) => {
    const open = place.open * othersIn;
    const facingEpic = facing && tier.walls.includes(facing) ? facing.epic.name : null;
    const small = stance.radius < 190;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${small ? 9 : 10}px ${font}`;
    for (const run of tier.epics) {
      const isFacing = run.epic.name === facingEpic;
      const from = run.from + 0.02;
      const to = run.to - 0.02;
      const shipped = run.walls.filter((wall) => wall.feature.word === 'shipped').length;
      ctx.setLineDash([]);
      ctx.strokeStyle = paint(colors.body, (isFacing ? 0.5 : 0.24) * open);
      ctx.lineWidth = 1;
      ctx.stroke(edgePath(tier, place, from, to, 0, EPIC_RHO));
      if (shipped > 0) {
        ctx.strokeStyle = paint(colors.ink, (isFacing ? 1 : 0.8) * open);
        ctx.lineWidth = 2;
        ctx.stroke(edgePath(tier, place, from, lerp(from, to, shipped / run.walls.length), 0, EPIC_RHO));
      }
      for (const wall of run.walls) {
        const knot = pointOn(tier, place, wall.at, 0, EPIC_RHO);
        const done = wall.feature.word === 'shipped';
        ctx.beginPath();
        ctx.arc(knot[0], knot[1], done ? 2 : 2.4, 0, TAU);
        if (done) {
          ctx.fillStyle = paint(colors.ink, (isFacing ? 1 : 0.75) * open);
          ctx.fill();
        } else {
          ctx.fillStyle = paint(colors.ground, open);
          ctx.fill();
          ctx.strokeStyle = paint(wall.attention > 0 ? colors.accent : colors.body, (isFacing ? 0.9 : 0.5) * open);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      if (open > 0.35 && (!small || isFacing)) {
        // The epic's name lies along its thread, on a patch of the ground so the thread does not run through it.
        const middle = (run.from + run.to) / 2;
        const at = pointOn(tier, place, middle, 0, EPIC_RHO);
        const before = pointOn(tier, place, middle - 0.02, 0, EPIC_RHO);
        const after = pointOn(tier, place, middle + 0.02, 0, EPIC_RHO);
        let lie = Math.atan2(after[1] - before[1], after[0] - before[0]);
        if (Math.cos(lie) < 0) lie += Math.PI;
        const text = run.epic.title.toUpperCase();
        const patch = ctx.measureText(text).width + 12;
        ctx.save();
        ctx.translate(at[0], at[1]);
        ctx.rotate(lie);
        ctx.fillStyle = paint(colors.ground, open);
        ctx.fillRect(-patch / 2, -7, patch, 14);
        ctx.fillStyle = paint(isFacing ? colors.ink : colors.muted, lerp(0.5, 1, (depthOf(tier, middle) + 1) / 2) * open);
        ctx.fillText(text, 0, 0.5);
        ctx.restore();
      }
    }
  };

  /** What the rings to come hang on: a line up from the middle of the floor, a mark where each one sits. It runs on past the last and fades: the roadmap has no top. */
  const drawMast = (above: { index: number; place: Place }[]) => {
    if (above.length === 0) return;
    const top = above[above.length - 1].place.lift;
    const alpha = clamp((above[0].place.away - 0.5) * 2, 0, 1) * othersIn;
    const foot = stance.cy;
    const head = stance.cy - (top + stance.radius * 0.13) * rise;
    const fade = ctx.createLinearGradient(0, foot, 0, head);
    fade.addColorStop(0, paint(colors.body, 0.3 * alpha));
    fade.addColorStop(0.75, paint(colors.body, 0.22 * alpha));
    fade.addColorStop(1, paint(colors.body, 0));
    ctx.strokeStyle = fade;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 4]);
    ctx.beginPath();
    ctx.moveTo(stance.cx, foot);
    ctx.lineTo(stance.cx, head);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const item of above) {
      ctx.fillStyle = paint(item.index === shown() ? colors.ink : colors.body, 0.7 * othersIn * clamp((item.place.away - 0.5) * 2, 0, 1));
      ctx.beginPath();
      ctx.arc(stance.cx, stance.cy - item.place.lift * rise, 1.5, 0, TAU);
      ctx.fill();
    }
  };

  const draw = (seconds: number) => {
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    wallPaths.clear();
    const order = tiers.map((tier, index) => ({ tier, index, place: placeOf(index) })).sort((a, b) => a.place.lift - b.place.lift);
    const drawnAt = (wall: RoadmapStackWall) => spots.get(wall.feature.name)?.at ?? wall.at;
    const half = (tier: RoadmapStackTier, isFront: boolean) => tier.walls
      .filter((wall) => (depthOf(tier, drawnAt(wall)) >= 0) === isFront)
      .sort((a, b) => depthOf(tier, drawnAt(a)) - depthOf(tier, drawnAt(b)));
    // From the ground up. A ring that is reached, or the one in front, has a floor: it hides what lies under it, so of
    // the rings below only their front edges show. The rings to come are open hoops; the floor shows through them.
    let mast = false;
    for (const { tier, index, place } of order) {
      const solid = place.away <= 0 ? 1 : 1 - smooth(clamp(place.away, 0, 1));
      if (place.away > 0.5 && !mast) {
        mast = true;
        drawMast(order.filter((item) => item.place.away > 0.5));
      }
      const rim = edgePath(tier, place, 0, TAU, 0);
      if (solid > 0.01) {
        ctx.fillStyle = paint(colors.ground, solid);
        ctx.fill(rim);
      }
      // Small, the circle itself is the one line drawn besides the arcs.
      ctx.strokeStyle = paint(colors.body, (place.away > 0 ? lerp(0.16, 0.34, clamp(place.away, 0, 1)) : 0.16) * (index === front ? lerp(2, 1, tipped) : othersIn));
      ctx.lineWidth = 1;
      ctx.setLineDash(place.away > 0.5 ? [2, 4] : []);
      ctx.stroke(rim);
      ctx.setLineDash([]);
      for (const wall of half(tier, false)) drawWall(tier, place, wall, seconds);
      if (place.open * othersIn > 0.03) drawFloor(tier, place);
      // The ring he is pointing at; one a finger chose waits, lit, for its second press.
      if (index === shown() && place.open < 0.5) {
        ctx.strokeStyle = paint(colors.ink, index === chosen && !still ? 0.72 + 0.28 * Math.sin(seconds * 5) : 0.9);
        ctx.lineWidth = index === chosen ? 1.75 : 1.25;
        ctx.stroke(edgePath(tier, place, 0, TAU, place.away < 0 ? place.flat : 0));
      }
      for (const wall of half(tier, true)) drawWall(tier, place, wall, seconds);
      if (index === front && arcs > 0.02) {
        for (const wall of tier.walls) {
          const spot = spots.get(wall.feature.name);
          if (spot) drawArc(tier, place, wall, spot, seconds);
        }
      }
    }
    // Small, and pointed at or focused: its rim lights.
    if (rest !== null && !standing && peek) {
      ctx.strokeStyle = paint(colors.ink, 0.9);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(stance.cx, stance.cy, Math.max(1, stance.radius - ARC_BAND / 2 - 5), 0, TAU);
      ctx.stroke();
    }
    // The pointer, under the whole stack: what stands over it on the ring in front is what faces him.
    const foot = footOf();
    ctx.fillStyle = paint(colors.ink, 0.9 * tipped);
    ctx.beginPath();
    ctx.moveTo(stance.cx, foot + 9);
    ctx.lineTo(stance.cx - 5, foot + 18);
    ctx.lineTo(stance.cx + 5, foot + 18);
    ctx.closePath();
    ctx.fill();
    for (const spark of sparks) {
      ctx.fillStyle = paint(spark.color, 1 - spark.age);
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * (1 - 0.5 * spark.age), 0, TAU);
      ctx.fill();
    }
  };
  /** The foot of the stack: under the front edge of the ring in front and every closed ring beneath it. */
  const footOf = () => stance.cy + stance.radius * tilt + Math.max(0, frontEased) * stance.step * rise + (1 - tipped) * (ARC_BAND / 2 + 4);

  /** The next wall that asks for him: round the ring in front first, then on the nearest ring that has one. */
  const nextAsking = (direction: 1 | -1) => {
    const tier = tiers[front];
    if (!tier) return;
    const count = tier.walls.length;
    const at = facing ? tier.walls.indexOf(facing) : 0;
    for (let offset = 1; offset < count; offset += 1) {
      const wall = tier.walls[(at + direction * offset + count * 2) % count];
      if (wall.attention > 0) {
        turnTo(tier, wall);
        return;
      }
    }
    const others = tiers
      .map((item, index) => index)
      .filter((index) => index !== front && tiers[index].walls.some((wall) => wall.attention > 0))
      .sort((a, b) => Math.abs(a - front) - Math.abs(b - front));
    if (others.length === 0) return;
    const next = tiers[others[0]];
    const wall = [...next.walls].sort((a, b) => b.attention - a.attention)[0];
    goTier(others[0]);
    turnTo(next, wall);
  };

  return {
    /** The canvas's box changed: its CSS size and the device's pixel ratio. */
    resize(nextWidth: number, nextHeight: number, nextRatio: number) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      fit();
    },

    /** Reads the colours and the mono face off the page: `from` is an element that wears the theme, `ground` the colour behind the canvas. */
    readTheme(from: HTMLElement, ground: string) {
      const style = getComputedStyle(from);
      // Any colour CSS can write (a hex, an `rgb()`, a `color(srgb …)` a computed style hands back) is read the one way
      // that needs no parser: painted on one pixel and read off it. A colour the canvas refuses leaves the pixel clear.
      const probe = canvas.ownerDocument.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      const pixel = probe.getContext('2d', { willReadFrequently: true });
      const read = (color: string, fallback: Rgb): Rgb => {
        if (!color || !pixel) return fallback;
        pixel.clearRect(0, 0, 1, 1);
        pixel.fillStyle = 'rgba(0,0,0,0)';
        pixel.fillStyle = color;
        pixel.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = pixel.getImageData(0, 0, 1, 1).data;
        return alpha === 0 ? fallback : [red, green, blue];
      };
      const token = (name: string, fallback: Rgb) => read(style.getPropertyValue(name).trim(), fallback);
      colors = {
        ink: token('--ink-strong', FALLBACK.ink),
        body: token('--ink', FALLBACK.body),
        muted: token('--ink-muted', FALLBACK.muted),
        accent: token('--accent', FALLBACK.accent),
        ground: read(ground, token('--canvas', FALLBACK.ground)),
        danger: token('--danger-dot', FALLBACK.danger),
        done: token('--pos-dot', FALLBACK.done),
      };
      font = style.fontFamily || font;
    },

    /** Whether the operator asked for less motion: the crawl stands still, a turn lands at once, and the stack stands up and lies down in one step. */
    setStill(next: boolean) {
      still = next;
    },

    /**
     * Where the stack rests as one small circle, in the canvas's own pixels, or null for a stack that always stands. A stack
     * first given a rest starts there, small.
     */
    setRest(next: RoadmapStackRest | null) {
      if (next === null) {
        rest = null;
        standing = true;
        grown = 1;
      } else {
        if (rest === null) {
          standing = false;
          grown = 0;
        }
        rest = next;
      }
      view();
    },

    /** Stands the stack up from its circle, or lays it back down. Laid down, it points at nothing and holds no turn. */
    setStanding(next: boolean) {
      if (rest === null || standing === next) return;
      standing = next;
      // The button that lit the rim leaves with the circle, and says nothing as it goes.
      peek = false;
      if (!next) {
        anchorName = null;
        hover = -1;
        chosen = -1;
        drag = null;
      }
    },

    /** The small circle is under a pointer or holds the keyboard's focus: its rim lights. */
    setPeek(next: boolean) {
      peek = next;
    },

    /**
     * A new picture, laid out. The ring in front stays the same milestone when the picture still holds it. The first
     * picture is the arrival: it opens on `arrival`, turned to what he most needs to see there — the newest feature
     * that shipped while he was away, else whatever asks for him.
     */
    setTiers(next: RoadmapStackTier[], arrival: number) {
      const frontName = tiers[front]?.milestone.name;
      tiers = next;
      for (const tier of tiers) {
        for (const wall of tier.walls) {
          const motion = motions.get(wall.feature.name);
          if (!motion) {
            motions.set(wall.feature.name, { frame: arrived ? 0 : wall.frame, fill: wall.fill, flash: 0, word: wall.feature.word });
          } else if (motion.word !== wall.feature.word) {
            // It shipped while he watched: its wall flashes and throws sparks.
            if (wall.feature.word === 'shipped' && arrived) {
              motion.flash = 1;
              if (!still) {
                const from = pointOn(tier, placeOf(tiers.indexOf(tier)), wall.at, stance.wall * placeOf(tiers.indexOf(tier)).open);
                for (let i = 0; i < 12; i += 1) {
                  const way = (i / 12) * TAU + (Math.random() - 0.5) * 0.4;
                  const speed = 40 + Math.random() * 70;
                  sparks.push({ x: from[0], y: from[1], vx: Math.cos(way) * speed, vy: Math.sin(way) * speed - 30, age: 0, size: 1.6 + Math.random() * 1.2, color: i % 3 ? colors.done : colors.ink });
                }
              }
            }
            motion.word = wall.feature.word;
          }
        }
      }
      if (tiers.length === 0) {
        front = 0;
        frontEased = 0;
        facing = null;
        return;
      }
      if (!arrived) {
        arrived = true;
        front = clamp(arrival, 0, tiers.length - 1);
        frontEased = front;
        const tier = tiers[front];
        const fresh = tier.walls.filter((wall) => wall.unseen).sort((a, b) => Date.parse(b.feature.shipped_at ?? '') - Date.parse(a.feature.shipped_at ?? ''))[0];
        const asking = [...tier.walls].sort((a, b) => b.attention - a.attention)[0];
        const first = fresh ?? asking;
        if (first) turnOf(tier).rot = -first.at;
      } else {
        const kept = tiers.findIndex((tier) => tier.milestone.name === frontName);
        front = kept >= 0 ? kept : clamp(front, 0, tiers.length - 1);
        // A wall added or taken away moves its neighbours: the ring settles on the one now nearest the front.
        if (!drag && turnOf(tiers[front]).target === null) settle(tiers[front]);
      }
      fit();
    },

    /** One animation frame: every turn and every eased figure moves on, the stack is drawn, and what it shows is reported. */
    frame(now: number): RoadmapStackFrame {
      const elapsed = lastAt === 0 ? 0 : Math.min(0.05, (now - lastAt) / 1000);
      lastAt = now;
      frontEased += (front - frontEased) * Math.min(1, elapsed * (still ? 40 : 5.5));
      if (Math.abs(front - frontEased) < 0.002) frontEased = front;
      if (rest !== null) {
        const to = standing ? 1 : 0;
        if (grown !== to) {
          grown = still ? to : clamp(grown + (standing ? elapsed / STAND_S : -elapsed / FOLD_S), 0, 1);
          view();
        }
      }
      for (const [index, tier] of tiers.entries()) {
        if (drag && index === front && drag.hit.on !== 'tier') continue;
        const turn = turnOf(tier);
        if (turn.target !== null) {
          const left = turn.target - turn.rot;
          turn.rot += left * Math.min(1, elapsed * (still ? 40 : 9));
          if (Math.abs(left) < 0.0015) {
            turn.rot = turn.target;
            turn.target = null;
          }
        } else if (Math.abs(turn.speed) > 0.02) {
          turn.rot += turn.speed * elapsed;
          turn.speed *= Math.exp(-elapsed * 2.6);
          if (Math.abs(turn.speed) < 0.5) settle(tier);
        }
      }
      const ease = Math.min(1, elapsed * 7);
      for (const tier of tiers) {
        for (const wall of tier.walls) {
          const motion = motions.get(wall.feature.name);
          if (!motion) continue;
          motion.frame += (wall.frame - motion.frame) * ease;
          motion.fill += (wall.fill - motion.fill) * ease;
          motion.flash *= Math.exp(-elapsed / 0.5);
        }
      }
      for (const spark of sparks) {
        spark.age += elapsed / 0.9;
        spark.x += spark.vx * elapsed;
        spark.y += spark.vy * elapsed;
        spark.vy += 120 * elapsed;
      }
      sparks = sparks.filter((spark) => spark.age < 1);
      facing = tiers[front] ? nearestWall(tiers[front]) : null;
      spread();
      if (width > 0 && height > 0) draw(now / 1000);
      return { tier: front, facing, shown: shown() === front ? -1 : shown(), readingTop: Math.round(footOf() + lerp(12, 26, tipped)), grown };
    },

    /** A pointer went down. True when it landed on the stack, so the canvas holds the pointer until it lifts. */
    pointerDown(x: number, y: number, touch: boolean): boolean {
      // Small or on its way, it is not turned or pressed here: its owner's own button stands it up.
      const hit = grown >= 1 ? hitAt(x, y) : null;
      if (!hit || !tiers[front]) return false;
      drag = { angle: angleAt(x, y), x, y, moved: 0, hit, at: performance.now(), speed: 0, touch };
      const turn = turnOf(tiers[front]);
      turn.target = null;
      turn.speed = 0;
      return true;
    },

    /** A pointer moved: held, it turns the ring in front; a mouse that is not held points at a ring. Returns whether it is over one. */
    pointerMove(x: number, y: number, mouse: boolean): boolean {
      if (!drag) {
        const hit = mouse && grown >= 1 ? hitAt(x, y) : null;
        hover = hit?.on === 'tier' ? hit.tier : -1;
        return hover >= 0;
      }
      const angle = angleAt(x, y);
      const turned = fold(angle - drag.angle);
      const now = performance.now();
      drag.moved += Math.hypot(x - drag.x, y - drag.y);
      drag.x = x;
      drag.y = y;
      if (drag.moved < 5 || drag.hit.on === 'tier' || !tiers[front]) return false;
      turnOf(tiers[front]).rot += turned;
      drag.speed = turned / Math.max(0.016, (now - drag.at) / 1000);
      drag.angle = angle;
      drag.at = now;
      return false;
    },

    /**
     * The pointer lifted. `undefined`: it had turned the ring, which now settles, and there is nothing to open or close.
     * `null`: a press that opens nothing (a wall that was not facing comes round; a ring is chosen or gone to; the bare
     * ring). A target: the facing wall or an epic's thread was pressed, and its card opens.
     *
     * Under a finger there is no pointing first, so the first press on a ring he is not on only chooses it — it lights
     * and is read out — and the second brings it to him. A mouse has pointed already and goes at once.
     */
    pointerUp(): RoadmapStackTarget | null | undefined {
      const lifted = drag;
      drag = null;
      const tier = tiers[front];
      if (!lifted || !tier) return undefined;
      const { hit } = lifted;
      if (lifted.moved >= 5 && hit.on !== 'tier') {
        chosen = -1;
        const turn = turnOf(tier);
        if (Math.abs(lifted.speed) > 0.6 && performance.now() - lifted.at < 80) turn.speed = clamp(lifted.speed, -9, 9);
        else settle(tier);
        return undefined;
      }
      if (hit.on === 'tier') {
        if (lifted.touch && chosen !== hit.tier) chosen = hit.tier;
        else goTier(hit.tier);
        return null;
      }
      chosen = -1;
      if (hit.on === 'epic') return { kind: 'epic', name: hit.name };
      if (hit.on === 'wall') {
        const turn = turnOf(tier);
        if (hit.wall === facing && Math.abs(fold(hit.wall.at + turn.rot)) < 0.03) return { kind: 'feature', name: hit.wall.feature.name };
        turnTo(tier, hit.wall);
      }
      return null;
    },

    /** The mouse left the canvas: it points at nothing. */
    pointerLeave() {
      hover = -1;
    },

    /** One notch of the wheel: the next wall round, or the one before. */
    wheel(forward: boolean) {
      const tier = tiers[front];
      const now = performance.now();
      if (!tier || tier.walls.length === 0 || now - wheelAt < 90 || grown < 1) return;
      wheelAt = now;
      chosen = -1;
      const at = facing ? tier.walls.indexOf(facing) : 0;
      turnTo(tier, tier.walls[(at + (forward ? 1 : -1) + tier.walls.length) % tier.walls.length]);
    },

    /**
     * A key. Left and right turn the ring in front; up is the milestone to come and down the one before; Enter opens
     * what faces him; Space goes to the next thing that asks for him. `false` when the key is not the stack's.
     */
    key(key: string, shift: boolean): RoadmapStackTarget | boolean {
      const tier = tiers[front];
      if (!tier || grown < 1) return false;
      chosen = -1;
      const count = tier.walls.length;
      const at = facing ? tier.walls.indexOf(facing) : 0;
      if (key === 'ArrowRight' && count > 0) turnTo(tier, tier.walls[(at + 1) % count]);
      else if (key === 'ArrowLeft' && count > 0) turnTo(tier, tier.walls[(at - 1 + count) % count]);
      else if (key === 'ArrowUp' || key === 'PageUp') goTier(front + 1);
      else if (key === 'ArrowDown' || key === 'PageDown') goTier(front - 1);
      else if (key === ' ') nextAsking(shift ? -1 : 1);
      else if (key === 'Enter') return facing ? { kind: 'feature', name: facing.feature.name } : true;
      else return false;
      return true;
    },

    /** Brings a feature's wall to the front, on whichever ring it stands: a row pressed in an epic's card. */
    face(name: string) {
      for (const [index, tier] of tiers.entries()) {
        const wall = tier.walls.find((item) => item.feature.name === name);
        if (!wall) continue;
        goTier(index);
        turnTo(tier, wall);
        return;
      }
    },

    /** Where a card hangs from, in the canvas's own pixels: over a feature's wall, or on an epic's thread. Null when the stack no longer shows it. */
    anchorOf(target: RoadmapStackTarget): Point | null {
      for (const [index, tier] of tiers.entries()) {
        const place = placeOf(index);
        if (target.kind === 'epic') {
          const run = tier.epics.find((item) => item.epic.name === target.name);
          if (run) return pointOn(tier, place, (run.from + run.to) / 2, 0, EPIC_RHO);
        } else {
          const wall = tier.walls.find((item) => item.feature.name === target.name);
          if (wall) return pointOn(tier, place, wall.at, stance.wall * (motions.get(target.name)?.frame ?? wall.frame) * place.open + 4);
        }
      }
      return null;
    },
  };
}
