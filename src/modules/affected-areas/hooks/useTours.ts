import { useEffect, useState } from 'react';

import { useLaneRead } from '@/modules/affected-areas/hooks/useLaneRead';
import type { TourList, TourSummary } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasRead } from '@/shared/types';

/** The most tours the picker lists: recent ones, newest first. A search narrows them; it does not page. */
const TOURS_LIMIT = 30;

/** How long typing must rest before the list is read for it, so a name typed in a second is read once. */
const TYPING_SETTLES_MS = 300;

/** The longest search the lane takes, counted by code point as the lane counts it; a longer paste is cut, not refused. */
const QUERY_MAX_CHARS = 80;

/** The picker's read, by the text that settled: module-level so `useLaneRead` sees the same function every render. */
const toursFor = (query: string) => api.affectedAreas.tours({
  q: query === '' ? undefined : [...query].slice(0, QUERY_MAX_CHARS).join(''),
  limit: TOURS_LIMIT,
});

/**
 * The tours the picker lists for what was typed: read when the view first shows (it mounts then) and once typing has
 * rested for 300 ms, and again on Try again and on `reload`, which the view root calls when the picker comes back (a
 * press or a walk has changed how far each tour is read) and a quiet one keeps the list on screen. The rest timer runs
 * only while `shown`: text typed just before the view was left is read when it returns, never while it is away. No
 * other timer reads anything.
 *
 * Used by the affected-areas module's view root.
 */
export function useTours(query: string, shown: boolean): AffectedAreasRead<TourSummary[]> & { reload: () => void } {
  // The text the list is read for: `query` once typing has rested. The field shows every keystroke at once; the
  // lane is asked once per pause, and this is the only place that tells the two apart.
  const [settled, setSettled] = useState(query.trim());
  useEffect(() => {
    const typed = query.trim();
    if (!shown || typed === settled) return undefined;
    const rested = setTimeout(() => setSettled(typed), TYPING_SETTLES_MS);
    return () => clearTimeout(rested);
  }, [query, settled, shown]);

  const read = useLaneRead<TourList>(settled, toursFor);
  return { value: read.value?.tours ?? null, trouble: read.trouble, retry: read.retry, reload: read.reload };
}
