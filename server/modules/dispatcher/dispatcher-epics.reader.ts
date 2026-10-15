import type { DispatcherRoute } from '@/shared/types.js';

import { field, isFlag, isRecord, isWholeFrom, need, oneOf } from './dispatcher-state.transport.js';

/**
 * The epic dial's census as the document states it (`route.epics`, `line_gate.census`): the word the
 * operator set in `epics.flag`, whether Pause all is on, and how many epics of the queue have started.
 *
 * It has its own file, apart from the route's other readers in `dispatcher-state.service.ts`, because
 * that service imports the database module (`sessionsDb`) and this reader must be reachable without
 * opening one: `.verify/lib/lane-picture.ts` reads the key through it over a saved document.
 */

/** The six limits the dial takes (`epic_dial.LIMITS` and `ALL`): `1` to `5`, or `all` for the no-limit walk. Anything else is a build this lane cannot draw. */
const EPIC_LIMITS: readonly string[] = ['1', '2', '3', '4', '5', 'all'];

/** How many epics have started: a whole number from 0, which `isCount` alone would not hold to (`-1` and `1.5` pass it). */
const isRunning = isWholeFrom(0);

/**
 * `route.epics`, or `null` for a dispatcher build OLDER than the key — and for an explicit `null`, which reads
 * the same: that is ANOTHER BUILD TALKING and not a torn document, so the dial is simply not drawn and every card reads the queue it can. A key that
 * IS there and does not read is refused by name — `limit` outside the six words, `paused` not a flag,
 * `running` not a whole count — like every other field of the route, and the lane keeps its last good
 * picture.
 */
// Consumed by dispatcher-state.service.ts (`routeOf`) and .verify/lib/lane-picture.ts (the lane's own reading of a saved document).
export function epicsOf(raw: unknown): DispatcherRoute['epics'] {
  if (raw === undefined || raw === null) return null;
  const epics = need(raw, isRecord, 'route.epics');
  return {
    limit: oneOf(field(epics, 'limit'), EPIC_LIMITS, 'route.epics.limit'),
    paused: need(field(epics, 'paused'), isFlag, 'route.epics.paused'),
    running: need(field(epics, 'running'), isRunning, 'route.epics.running'),
  };
}
