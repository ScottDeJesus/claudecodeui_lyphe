import type { RegionShape } from '@/shared/types';

/** A badge's side on screen: `--vv-region-badge-size` in verve/media.css. Change the two together. */
const BADGE_PX = 22;

/** A spot's reach on screen: `--vv-region-spot-size` in verve/spots.css and its hairline. Change the two together. */
const SPOT_PX = 18;

/** How far a badge's press reaches past its body: `.vv-region-badge::before`'s inset in verve/media.css. Change the two together. */
const PRESS_PX = 6;

/** A box on screen, `[x0, y0, x1, y1]` in px of the picture. */
type Rect = [number, number, number, number];

/** How much of two boxes overlaps, in px². */
function overlap(a: Rect, b: Rect): number {
  const width = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const height = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A box grown by `by` px on every side. */
const grown = ([x0, y0, x1, y1]: Rect, by: number): Rect => [x0 - by, y0 - by, x1 + by, y1 + by];

/** A fraction of the picture, a missing or non-finite one read as its edge. */
const fraction = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? 0 : value);

/**
 * What a place costs a badge, compared in order, the first difference deciding:
 * 1. how much of it covers a badge placed before it or a spot (the number must show, and a camera's mark must too);
 * 2. how many other regions' boxes hold its middle (a number on another's outline reads as that one's);
 * 3. whether it misses its own box (a number touching its outline reads as that one's);
 * 4. how much its press, `PRESS_PX` past its body, takes of a badge before it or a spot (a fingertip at its edge must not
 *    open a neighbour);
 * 5. how much of it lies on other regions' boxes.
 * Equal on all five, the earlier place wins.
 */
type Cost = [number, number, number, number, number];

const cheaper = (a: Cost, b: Cost): boolean => {
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] < b[index];
  return false;
};

/**
 * Where each badge stands when `RegionImage`'s `badgePlacement` is `clear`: its top-left in 0..1 of the picture, by region
 * id, for a picture `width` × `height` px on screen. Taken in the caller's order (the tab order), so the first regions keep
 * their first choice.
 *
 * Each badge weighs 24 places, in order: its box's top-left (where every photo draws it) and other three corners; the eight
 * places beside its box, touching it at those corners; the four places at its box's outer corners; and a second ring of eight,
 * a badge and a press further out, for a crowd the first sixteen cannot hold. It takes the cheapest by `Cost`, so it never
 * covers a number or a spot while a free place stands, then keeps off other outlines and on its own, then keeps its press off
 * its neighbours. Every place is held inside the picture.
 *
 * A badge has one size on screen whatever the picture's, so a phone, where the picture is small, moves more badges than a
 * desk. Read by `RegionImage` alone; the day-one sketch is its site (MAN-740 rule 5).
 */
export function clearBadgePlaces(
  regions: RegionShape[],
  spots: { x: number; y: number }[],
  width: number,
  height: number,
): Record<string, [number, number]> {
  const places: Record<string, [number, number]> = {};
  if (!(width > BADGE_PX && height > BADGE_PX)) return places;
  const half = SPOT_PX / 2;
  const taken: Rect[] = spots.map((spot) => {
    const [x, y] = [fraction(spot.x) * width, fraction(spot.y) * height];
    return [x - half, y - half, x + half, y + half];
  });
  const boxes: Rect[] = regions.map((region) => [0, 1, 2, 3].map((index) => fraction(region.box[index]) * (index % 2 === 0 ? width : height)) as Rect);
  const hold = (x: number, y: number): [number, number] => [Math.min(Math.max(x, 0), width - BADGE_PX), Math.min(Math.max(y, 0), height - BADGE_PX)];
  const [s, far] = [BADGE_PX, 2 * BADGE_PX + PRESS_PX];

  regions.forEach((region, at) => {
    const own = boxes[at];
    const others = boxes.filter((_, index) => index !== at);
    const [x0, y0, x1, y1] = own;
    const candidates = [
      [x0, y0], [x1 - s, y0], [x0, y1 - s], [x1 - s, y1 - s],
      [x0 - s, y0], [x1, y0], [x0, y0 - s], [x1 - s, y0 - s], [x0 - s, y1 - s], [x1, y1 - s], [x0, y1], [x1 - s, y1],
      [x0 - s, y0 - s], [x1, y0 - s], [x0 - s, y1], [x1, y1],
      [x0 - far, y0], [x1 + far - s, y0], [x0, y0 - far], [x1 - s, y0 - far], [x0 - far, y1 - s], [x1 + far - s, y1 - s], [x0, y1 + far - s], [x1 - s, y1 + far - s],
    ].map(([x, y]) => hold(x, y));

    let best = candidates[0];
    let least: Cost | null = null;
    for (const [x, y] of candidates) {
      const body: Rect = [x, y, x + s, y + s];
      const [mx, my] = [x + s / 2, y + s / 2];
      const cost: Cost = [
        taken.reduce((sum, mark) => sum + overlap(body, mark), 0),
        others.filter((box) => mx >= box[0] && mx <= box[2] && my >= box[1] && my <= box[3]).length,
        overlap(body, grown(own, 1)) > 0 ? 0 : 1,
        taken.reduce((sum, mark) => sum + overlap(grown(body, PRESS_PX), mark), 0),
        others.reduce((sum, box) => sum + overlap(body, box), 0),
      ];
      if (least === null || cheaper(cost, least)) [best, least] = [[x, y], cost];
    }
    taken.push([best[0], best[1], best[0] + s, best[1] + s]);
    places[region.id] = [best[0] / width, best[1] / height];
  });
  return places;
}
