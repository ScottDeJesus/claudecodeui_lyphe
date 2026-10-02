/**
 * Where a carried item belongs among the others, read off the layout and the pointer alone — the one
 * geometry of the sortable capability, in a list of any shape: a column, a row, a grid that wraps.
 *
 * THE SLOT IS THE ITEM UNDER THE POINTER, and which side of it is the pointer's half: in a row of
 * several items it is the left half (before it) and the right half (after it), in a single column the
 * top half and the bottom half. Whether an item shares its row is read from the layout, never from a
 * column count the caller would have to keep true: another item that overlaps it vertically is
 * beside it. A grid whose cards stand at their own heights (`items-start`) still has rows that never
 * overlap one another, so the test holds.
 *
 * EVERY BOX IS READ AS LAID OUT, WITH ITS TRANSFORM TAKEN OFF (`layoutRectOf`). A neighbour that is
 * sliding to its new place is, for the length of the slide, drawn somewhere its slot is not, and a
 * hit-test on what is drawn would decide against a list that no longer stands there. The carried item
 * is drawn under the pointer by a transform for the whole carry, so it too is measured at its slot.
 *
 * THE POINTER OVER THE CARRIED ITEM'S OWN SLOT DECIDES NOTHING, which is what keeps a reorder from
 * undoing itself: the moment an item has moved, the slot it left is under the pointer's old position
 * no more, and the slot it took is, so the next reading is "stay". A pointer over a gap, or beyond the
 * list's end, is read against the nearest item — beyond the last it is after it, above the first it
 * is before it.
 */

/** A box in viewport pixels. */
export type LayoutRect = { left: number; top: number; width: number; height: number };

/** One item of the list: its key and where its slot lies. */
export type SortableBox = { key: string; rect: LayoutRect };

/** The side of an item the carried one is to be put on. */
export type Slot = { key: string; before: boolean };

/** An element's box in the viewport as the layout places it, with any translate (a slide, a carry) taken off. */
export function layoutRectOf(element: Element): LayoutRect {
  const box = element.getBoundingClientRect();
  const { m41, m42 } = new DOMMatrixReadOnly(getComputedStyle(element).transform);
  return { left: box.left - m41, top: box.top - m42, width: box.width, height: box.height };
}

/** How far a point is from a box: 0 inside it. */
function distanceTo(rect: LayoutRect, x: number, y: number): number {
  const across = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const down = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(across, down);
}

/** Whether two boxes share a stretch of the page's vertical axis: they stand in one row. */
function inOneRow(a: LayoutRect, b: LayoutRect): boolean {
  return Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 1;
}

/** The slot the pointer names for the `carried` key, or `null` when it names none (over the carried item's own slot, or nothing to choose). */
export function slotAt(x: number, y: number, boxes: readonly SortableBox[], carried: string): Slot | null {
  const own = boxes.find((box) => box.key === carried);
  if (own !== undefined && distanceTo(own.rect, x, y) === 0) return null;
  let nearest: SortableBox | null = null;
  let nearestDistance = Infinity;
  for (const box of boxes) {
    if (box.key === carried) continue;
    const distance = distanceTo(box.rect, x, y);
    if (distance < nearestDistance) {
      nearest = box;
      nearestDistance = distance;
    }
  }
  if (nearest === null) return null;
  const target = nearest;
  const beside = boxes.some((box) => box.key !== target.key && inOneRow(box.rect, target.rect));
  const before = beside
    ? x < target.rect.left + target.rect.width / 2
    : y < target.rect.top + target.rect.height / 2;
  return { key: target.key, before };
}

/** `order` with `carried` taken out and put on `slot`'s side of the item it names. */
export function moveKey(order: readonly string[], carried: string, slot: Slot): string[] {
  const rest = order.filter((key) => key !== carried);
  const at = rest.indexOf(slot.key);
  rest.splice(slot.before ? at : at + 1, 0, carried);
  return rest;
}
