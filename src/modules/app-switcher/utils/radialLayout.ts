type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

/**
 * The angle the whole arc spans, first item's centre to last item's centre. 110° puts five items about 81px
 * apart on the arc at RADIAL_RADIUS_PX: 33px of air between neighbouring discs, which is the room a label
 * beside each disc needs.
 */
const RADIAL_SWEEP_DEG = 110;
/**
 * How far each item's centre stands from the FAB's centre; well clear of the FAB's 44px catch. It is the
 * radius at which the switcher's five labelled items stop colliding — measured over a grid of FAB positions
 * at 1440x900 and 390x844 with the labels' real widths: 160px still leaves two labels meeting on a run of
 * items, and 170px leaves nothing overlapping anywhere the FAB can stand.
 */
const RADIAL_RADIUS_PX = 170;
/**
 * The room an item is given: its 48px disc (`RADIAL_DISC_PX`, drawn by the radial) and the air around it. Half
 * of it is how far a centre must stay from a viewport edge, and it is the spacing a tight corner holds between
 * neighbours when the sweep has to narrow — at the disc's own 48px, an arc squeezed against a wall stood its
 * discs edge to edge with no room for the labels beside them. 72px leaves that room at every position the
 * grid measured.
 */
const RADIAL_ITEM_PX = 72;
/** The gap left between an item's edge and the viewport's edge. */
const RADIAL_EDGE_PX = 8;

/** A point counts as at-radius within this many pixels; the circle/wall solve lands on it to float precision. */
const RADIUS_TOLERANCE_PX = 1e-6;
/** A centre this close to the bounds counts as inside them: float error puts a point standing ON a wall a hair past it. */
const FIT_TOLERANCE_PX = 1e-6;
/** How far the whole arc is turned, per try, when a wall does not leave room for it where it faces. */
const ROTATION_STEP_DEG = 1;
/** The resolution of the scan that fits an arc into the room a corner leaves. */
const SCAN_STEP_DEG = 0.5;
/** How far past RADIAL_RADIUS_PX a tight corner may push the arc outward to keep its items apart. */
const RADIAL_GROWTH_PX = 2 * RADIAL_ITEM_PX;
/** How much the radius grows per try in a tight corner. */
const GROWTH_STEP_PX = 1;

const RADIANS_PER_DEGREE = Math.PI / 180;

/** The rectangle the centres may occupy: the viewport, less the edge gap and half an item on every side. */
function centreBounds(viewport: Size): Bounds {
  const inset = RADIAL_EDGE_PX + RADIAL_ITEM_PX / 2;
  return { minX: inset, maxX: viewport.width - inset, minY: inset, maxY: viewport.height - inset };
}

/** How far a point stands outside the bounds, along the shorter way back in; 0 when it is inside. */
function overflowOf(point: Point, bounds: Bounds): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  return Math.hypot(dx, dy);
}

function clampToBounds(point: Point, bounds: Bounds): Point {
  return {
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(point.y, bounds.minY), bounds.maxY),
  };
}

/**
 * The point in the bounds, at least RADIAL_RADIUS_PX from `origin`, nearest to `ideal`.
 *
 * The last resort, for a viewport too small to hold the arc at all. A plain clamp can pull a centre
 * closer to the FAB than the radius, so a clamped point that ended up too close slides ALONG the wall to
 * the place where that wall meets the circle of the radius. The circle meets each of the four wall lines
 * in at most two points, and the nearest of those that lie on the wall is the answer.
 */
function nearestClearPoint(ideal: Point, origin: Point, bounds: Bounds): Point {
  const clamped = clampToBounds(ideal, bounds);
  if (Math.hypot(clamped.x - origin.x, clamped.y - origin.y) >= RADIAL_RADIUS_PX - RADIUS_TOLERANCE_PX) {
    return clamped;
  }

  const radius = RADIAL_RADIUS_PX + RADIUS_TOLERANCE_PX;
  const candidates: Point[] = [];
  for (const x of [bounds.minX, bounds.maxX]) {
    const reach = radius ** 2 - (x - origin.x) ** 2;
    if (reach < 0) continue;
    for (const y of [origin.y - Math.sqrt(reach), origin.y + Math.sqrt(reach)]) {
      if (y >= bounds.minY && y <= bounds.maxY) candidates.push({ x, y });
    }
  }
  for (const y of [bounds.minY, bounds.maxY]) {
    const reach = radius ** 2 - (y - origin.y) ** 2;
    if (reach < 0) continue;
    for (const x of [origin.x - Math.sqrt(reach), origin.x + Math.sqrt(reach)]) {
      if (x >= bounds.minX && x <= bounds.maxX) candidates.push({ x, y });
    }
  }
  // No wall meets the circle only when the viewport is smaller than the arc; the clamp is all that is left.
  if (candidates.length === 0) return clamped;

  return candidates.reduce((best, candidate) =>
    Math.hypot(candidate.x - clamped.x, candidate.y - clamped.y) <
    Math.hypot(best.x - clamped.x, best.y - clamped.y)
      ? candidate
      : best,
  );
}

/** Each item's angle about the arc's middle, in radians: equal steps, first and last at the sweep's edges. */
function itemOffsets(count: number, sweep: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => (index / (count - 1) - 0.5) * sweep);
}

function pointAt(origin: Point, radius: number, angle: number): Point {
  return { x: origin.x + radius * Math.cos(angle), y: origin.y + radius * Math.sin(angle) };
}

function pointsOnArc(origin: Point, middle: number, offsets: number[], radius: number): Point[] {
  return offsets.map((offset) => pointAt(origin, radius, middle + offset));
}

/** The straight-line distance between two neighbouring items on an arc of this radius and sweep. */
function neighbourSpacing(radius: number, sweep: number, count: number): number {
  return count < 2 ? Infinity : 2 * radius * Math.sin(sweep / (2 * (count - 1)));
}

/**
 * The arc as designed — the full sweep at RADIAL_RADIUS_PX — turned to the nearest angle at which every
 * item stands inside the bounds, or null when no turn of it fits (a corner leaves less than the sweep).
 * Tries in order of distance from the facing direction: 0, +1°, -1°, +2°, ... so the first fit is the
 * nearest one.
 */
function fitFullSweep(origin: Point, bounds: Bounds, facing: number, count: number): Point[] | null {
  const offsets = itemOffsets(count, RADIAL_SWEEP_DEG * RADIANS_PER_DEGREE);
  const step = ROTATION_STEP_DEG * RADIANS_PER_DEGREE;
  for (let turn = 0; turn * step <= Math.PI; turn += 1) {
    for (const direction of turn === 0 ? [1] : [1, -1]) {
      const points = pointsOnArc(origin, facing + direction * turn * step, offsets, RADIAL_RADIUS_PX);
      if (points.every((point) => overflowOf(point, bounds) <= FIT_TOLERANCE_PX)) {
        return points.map((point) => clampToBounds(point, bounds));
      }
    }
  }
  return null;
}

/**
 * The widest sweep, up to the designed one, whose two ends and everything between stand inside the
 * bounds on a circle of this radius, centred as near the facing direction as that width allows.
 * Null when no two neighbouring angles on the circle stand inside.
 *
 * The circle is sampled every SCAN_STEP_DEG; a sample is inside when its point is. From each inside
 * sample the run of inside samples is measured the same distance either way, so the arc it gives is
 * symmetric about that sample. The widest run wins and, among equals, the one nearest the facing angle.
 */
function widestArcFacing(
  origin: Point,
  bounds: Bounds,
  facing: number,
  radius: number,
): { middle: number; sweep: number } | null {
  const samples = Math.round(360 / SCAN_STEP_DEG);
  const step = SCAN_STEP_DEG * RADIANS_PER_DEGREE;
  const wrap = (index: number) => ((index % samples) + samples) % samples;
  const inside = Array.from(
    { length: samples },
    (_, index) => overflowOf(pointAt(origin, radius, index * step), bounds) <= FIT_TOLERANCE_PX,
  );
  const fullReach = Math.round(RADIAL_SWEEP_DEG / 2 / SCAN_STEP_DEG);
  const facingIndex = Math.round(facing / step);

  let best: { index: number; reach: number } | null = null;
  for (let turn = 0; turn <= samples / 2; turn += 1) {
    for (const direction of turn === 0 ? [1] : [1, -1]) {
      const index = wrap(facingIndex + direction * turn);
      if (!inside[index]) continue;
      let reach = 0;
      while (reach < fullReach && inside[wrap(index + reach + 1)] && inside[wrap(index - reach - 1)]) reach += 1;
      // The whole designed sweep fits here, and no sweep is wider: nothing further out can beat it.
      if (reach === fullReach) return { middle: index * step, sweep: 2 * reach * step };
      if (best === null || reach > best.reach) best = { index, reach };
    }
  }
  return best === null || best.reach === 0 ? null : { middle: best.index * step, sweep: 2 * best.reach * step };
}

/**
 * Item centres on an arc around the FAB, facing the viewport's open space, every item clear of the
 * FAB's 44px catch and inside the viewport.
 *
 * Used by the switcher's radial, which draws its five acts at these points. Asked for no items it
 * answers none.
 *
 * The arc is centred on the FAB and faces the viewport's centre, so a FAB docked top-left fans down and
 * right and one floating bottom-right fans up and left. Where a wall leaves no room for the arc where
 * it faces, the WHOLE arc is turned to the nearest angle that fits it (the items keep their equal steps
 * and their radius).
 *
 * A CORNER leaves less room than the sweep needs — a FAB standing at its resting inset in the
 * bottom-right corner has about 82° for a 110° sweep — and no turn of the arc fits. There the sweep
 * narrows to the room the walls leave and the radius GROWS, a pixel at a time, until neighbouring items
 * stand as far apart as the open arc's own neighbours do (or as far as an item is wide, if that is
 * less): the fan opens outward where it cannot open sideways. Every centre still stands at least
 * RADIAL_RADIUS_PX from the FAB's centre. A viewport too small to hold any of that falls back to
 * clamping each centre in and sliding it along the wall until it is a full radius from the FAB.
 */
export function radialLayout(fab: Rect, viewport: Size, count: number): Point[] {
  // `!(count >= 1)` rather than `count < 1` so that NaN is asked-for-nothing as well.
  if (!(count >= 1)) return [];

  const origin: Point = { x: fab.left + fab.width / 2, y: fab.top + fab.height / 2 };
  const bounds = centreBounds(viewport);
  const sweep = RADIAL_SWEEP_DEG * RADIANS_PER_DEGREE;

  // Toward the viewport's centre; a FAB standing exactly on it has no open side, so it faces up.
  const towardX = viewport.width / 2 - origin.x;
  const towardY = viewport.height / 2 - origin.y;
  const facing = towardX === 0 && towardY === 0 ? -Math.PI / 2 : Math.atan2(towardY, towardX);

  const designed = fitFullSweep(origin, bounds, facing, count);
  if (designed !== null) return designed;

  const spacingWanted = Math.min(RADIAL_ITEM_PX, neighbourSpacing(RADIAL_RADIUS_PX, sweep, count));
  let bestFit: { points: Point[]; spacing: number } | null = null;
  for (let radius = RADIAL_RADIUS_PX; radius <= RADIAL_RADIUS_PX + RADIAL_GROWTH_PX; radius += GROWTH_STEP_PX) {
    const arc = widestArcFacing(origin, bounds, facing, radius);
    if (arc === null) continue;
    const spacing = neighbourSpacing(radius, arc.sweep, count);
    if (bestFit === null || spacing > bestFit.spacing) {
      const points = pointsOnArc(origin, arc.middle, itemOffsets(count, arc.sweep), radius);
      bestFit = { points: points.map((point) => clampToBounds(point, bounds)), spacing };
    }
    if (spacing >= spacingWanted) break;
  }
  if (bestFit !== null) return bestFit.points;

  return pointsOnArc(origin, facing, itemOffsets(count, sweep), RADIAL_RADIUS_PX).map((point) =>
    nearestClearPoint(point, origin, bounds),
  );
}
