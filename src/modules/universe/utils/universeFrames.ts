import type { ServerEvent } from '@/shared/types';

/**
 * ONE RULE, ONE HOME: is this frame a row about the estate the client is actually holding?
 *
 * A `universe_activity` frame carries the `mapId` its `node` indices belong to, and a client that
 * has refetched a newer map — or not yet fetched one at all — must not point those indices at the
 * map it holds. Both readers of the socket ask THIS function, so the canvas and the bus digest can
 * never disagree about whether a frame from a retired map is real:
 *
 *   - `src/modules/universe/hooks/useUniverseStream.ts`, the canvas's path, which draws the rows;
 *   - `src/modules/universe/UniverseFeed.tsx`, the bus's path, which counts them into a digest.
 *
 * `knownMapId` is `null` while no map is held, and then nothing is fresh: a row indexing a map the
 * client cannot draw is not a row it may act on, and the map's own hook sets the id the moment it
 * lands (`useUniverseMap`). A frame that is not an activity frame at all — the `universe_map`
 * announcement above all — is refused here by the same test, so a caller may pass every frame.
 */
export function isFreshActivityFrame(event: ServerEvent, knownMapId: string | null): boolean {
  if (event.kind !== 'universe_activity') return false;
  if (typeof event.mapId !== 'string') return false;
  return knownMapId !== null && event.mapId === knownMapId;
}
