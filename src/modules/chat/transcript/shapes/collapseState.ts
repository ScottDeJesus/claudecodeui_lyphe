/**
 * Which shapes the reader has folded, for the life of the page.
 *
 * A module-level Map and not component state, for the reason `CollapsibleUserText.tsx:18` keeps a
 * module-level Set: `LazyMessageRow.tsx:83` unmounts a row's whole subtree once it leaves a
 * 1200 px band, so a fold remembered inside the component is forgotten the moment the reader
 * scrolls past it and comes back.
 *
 * The key is CONTENT-ADDRESSED, never a message id. A message id changes three times as a reply
 * finalises and is superseded (`docs/architecture/02-realtime-stream.md:280-285`); the text the
 * reader folded does not. Keying on the id would re-open every block the reader had just shut.
 *
 * The Map is only ever written by a click, so it grows with human effort rather than with
 * transcript length — no eviction is needed and none is added.
 */
const foldedShapes = new Map<string, boolean>();

/**
 * The identity of one block: its kind and a hash of its whole text. `payload` is defined per kind
 * by the plan (a table's headers and rows, a section's heading AND body, a fence's source) —
 * a heading's text alone would make every "Findings" in a reply fold in lockstep with the first.
 */
export function shapeKey(kind: string, payload: string): string {
  // djb2, inline: this module imports nothing, and a key that only has to tell one block from its
  // neighbours does not earn a dependency.
  let hash = 5381;
  for (let index = 0; index < payload.length; index += 1) {
    hash = ((hash << 5) + hash + payload.charCodeAt(index)) | 0;
  }
  // Forced unsigned BEFORE it is stringified, or half of the keys carry a minus sign for no
  // reason and every artifact that names one reads like a bug.
  return `${kind}:${(hash >>> 0).toString(36)}`;
}

/**
 * Absent means EXPANDED. Always.
 *
 * Nothing here ever opens folded on its own — the operator asked to collapse things himself. It is
 * also the reason a 32-bit collision is tolerable: two different payloads sharing a key can at
 * worst show a block folded that the reader never folded, and they can re-open it. The opposite
 * default would make a collision hide content silently.
 */
export function isCollapsed(key: string): boolean {
  return foldedShapes.get(key) === true;
}

/** Records a click. The only writer. */
export function setCollapsed(key: string, next: boolean): void {
  foldedShapes.set(key, next);
}

/**
 * Forgets one key, so a fold can MOVE with its block instead of being copied.
 *
 * A content-addressed key changes under a block that is still growing — the settled half of a
 * streaming reply keeps gaining text — and a fold the reader made has to follow it, or it springs
 * back open on the next delta. `useShapeCollapse` carries the entry forward and calls this to drop
 * the one it came from, which is why the Map still holds at most one entry per folded block and
 * still grows with human effort rather than with transcript length. This is not eviction: nothing
 * here ever forgets a fold the reader can still see.
 */
export function clearCollapsed(key: string): void {
  foldedShapes.delete(key);
}
