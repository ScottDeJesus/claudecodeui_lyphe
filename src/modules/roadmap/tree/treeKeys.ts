import type { RoadmapTreeSelection } from '@/shared/types';

// Every node and dot of the tree carries `data-tree-key`: `roadmap`, or `<kind>:<name>`. A press, a key and the
// pointer's tip all read an item off it, so the key is read in ONE place.

/** The item a `data-tree-key` names; null for a key that names none (an unknown kind, or no name). */
function selectionOfTreeKey(key: string): RoadmapTreeSelection | null {
  if (key === 'roadmap') return { kind: 'roadmap' };
  const colon = key.indexOf(':');
  if (colon < 1) return null;
  const kind = key.slice(0, colon);
  const name = key.slice(colon + 1);
  if (name === '') return null;
  return kind === 'milestone' || kind === 'epic' || kind === 'feature' ? { kind, name } : null;
}

/** The `data-tree-key` an item's node carries: what `selectionUnder` reads back, and what a node is found by. */
export function treeKeyOf(selection: RoadmapTreeSelection): string {
  return selection.kind === 'roadmap' ? 'roadmap' : `${selection.kind}:${selection.name}`;
}

/**
 * The item at an event's target: the nearest `[data-tree-key]` at or above it. A feature's dot is its own
 * key inside its epic's, so a press on a dot names the feature and never its epic. Null over empty drawing.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, for its press, its keys and its tip.
 */
export function selectionUnder(target: EventTarget): RoadmapTreeSelection | null {
  if (!(target instanceof Element)) return null;
  const key = target.closest('[data-tree-key]')?.getAttribute('data-tree-key');
  return typeof key === 'string' ? selectionOfTreeKey(key) : null;
}
