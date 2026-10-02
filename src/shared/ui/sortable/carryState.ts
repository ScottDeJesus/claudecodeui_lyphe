/**
 * What a carry is made of, apart from the hook that runs it: the record of the one item in the
 * pointer's hand, and the two pure readings of an order the hook leans on — whether two orders are the
 * same, and how a preview order is read against the keys the list holds NOW.
 *
 * Used by `useSortable`, which owns the one `Carry` a list has at a time.
 */

/** What one carry knows: the item in the pointer's hand, where it was taken, and the order it is being moved through. */
export type Carry = {
  key: string;
  element: HTMLElement;
  /** Where inside the item the pointer took it, so the item stays under the same spot of itself. */
  grabX: number;
  grabY: number;
  pointerX: number;
  pointerY: number;
  /** The keys as the list stood when the carry began, to tell a drop that moved something from one that did not. */
  startOrder: readonly string[];
  /** The keys as the carry has them now: the order drawn, and the order a drop commits. */
  order: readonly string[];
  /** The pane the list scrolls in, and how far it had scrolled when the carry last decided anything. */
  scroller: HTMLElement | null;
  reference: { x: number; y: number; scroll: number };
  /** The pane's offset as the last frame saw it, so a scroll nobody here caused (the reader's wheel) is noticed. */
  seenScroll: number;
  frame: number;
  /** The neighbours' running slides, so a reorder that lands mid-slide starts from where each is drawn. */
  slides: Map<string, Animation>;
};

export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, at) => key === b[at]);

/**
 * The keys of `preview` that are still in the list, in the carry's order, with keys the list gained
 * since put at the front: a card that arrives while another is in the hand (a poll's news) is drawn,
 * and nothing about the carry resets. A newly arrived card is the highest ranked there is.
 */
export function reconcile(preview: readonly string[], keys: readonly string[]): readonly string[] {
  const live = new Set(keys);
  const kept = preview.filter((key) => live.has(key));
  const known = new Set(kept);
  return [...keys.filter((key) => !known.has(key)), ...kept];
}
