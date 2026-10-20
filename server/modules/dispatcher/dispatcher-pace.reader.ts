import type { DispatcherPace } from '@/shared/types.js';

import { field, isCount, isCountOrNull, isFlag, isRecord, isText, need } from './dispatcher-state.transport.js';

/**
 * The pacer's picture as the document states it (`route.pace`, `pace_report.route`): the account it
 * read, the reading behind it, both windows, the probe, how many asks it holds and its one sentence.
 *
 * It has its own file for the reason `dispatcher-epics.reader.ts` does: `dispatcher-state.service.ts`
 * imports the database module (`sessionsDb`), so anything a probe reads from a saved document must be
 * importable without one. `routeOf` is this reader's caller in the lane; a probe imports `paceSince`
 * directly.
 *
 * ONE ABSENT KEY IS ANOTHER BUILD TALKING, a present one that does not read is refused BY NAME —
 * the rule every route field follows. `undefined` (a dispatcher older than the picture) is left off
 * the object, so the client's `route?.pace` reads "not drawn"; `null` is the document saying it has
 * no picture, and draws nothing too; anything else is validated field by field. Every figure is a
 * FRACTION 0..1 and every instant epoch SECONDS, the dispatcher document's own units — the client
 * that needs percents (the account panel's meters) converts at the usage route, never here.
 */

/** One window of the picture, `null` when the pacer could not read it. `resets_at` is epoch seconds,
 *  or `null` on a reading that carries no reset. */
function windowOf(raw: unknown, where: string): DispatcherPace['five'] {
  if (raw === null) return null;
  const window = need(raw, isRecord, where);
  return {
    used: need(field(window, 'used'), isCount, `${where}.used`),
    projected: need(field(window, 'projected'), isCount, `${where}.projected`),
    ceiling: need(field(window, 'ceiling'), isCount, `${where}.ceiling`),
    resets_at: need(field(window, 'resets_at'), isCountOrNull, `${where}.resets_at`),
  };
}

/** The reading the picture was built on: its instant (epoch seconds or null), its source word, and
 *  whether it is fresh enough to pace on and still open. */
function readingOf(raw: unknown): DispatcherPace['reading'] {
  const reading = need(raw, isRecord, 'route.pace.reading');
  return {
    at: need(field(reading, 'at'), isCountOrNull, 'route.pace.reading.at'),
    source: need(field(reading, 'source'), isText, 'route.pace.reading.source'),
    fresh: need(field(reading, 'fresh'), isFlag, 'route.pace.reading.fresh'),
    rolled: need(field(reading, 'rolled'), isFlag, 'route.pace.reading.rolled'),
  };
}

/**
 * `route.pace`, or `undefined` for a dispatcher build OLDER than the key, or `null` for the document
 * saying it has no picture — both read as "not drawn". A picture that IS there and does not read is
 * refused by name, and the lane keeps its last good document.
 *
 * Consumed by `dispatcher-state.service.ts` (`routeOf`).
 */
export function paceSince(raw: unknown): DispatcherPace | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const pace = need(raw, isRecord, 'route.pace');
  return {
    account: need(field(pace, 'account'), isText, 'route.pace.account'),
    reading: readingOf(field(pace, 'reading')),
    five: windowOf(field(pace, 'five'), 'route.pace.five'),
    week: windowOf(field(pace, 'week'), 'route.pace.week'),
    probe: need(field(pace, 'probe'), isFlag, 'route.pace.probe'),
    held: need(field(pace, 'held'), isCount, 'route.pace.held'),
    opens_at: need(field(pace, 'opens_at'), isCountOrNull, 'route.pace.opens_at'),
    words: need(field(pace, 'words'), isText, 'route.pace.words'),
  };
}
