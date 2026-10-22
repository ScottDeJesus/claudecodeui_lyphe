import { api } from '@/shared/api';
import type { OverviewRow } from '@/shared/carrier-bulletins-types';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { AffectedAreasRead } from '@/shared/types';

/** The overview has one read, so one key: `useLaneRead` reads when the key is set, which is when the view opens. */
const OVERVIEW_KEY = 'overview';

/** The overview's read: module-level so `useLaneRead` sees the same function every render. */
const overviewFor = () => api.carrierBulletins.overview();

/**
 * Every carrier's current file and how far it is read: the overview screen's list, and the header the carrier's pages
 * and a page draw from at once. Read when the view first opens, and again only on a press (Refresh, Try again, or Back
 * to the overview): never on a timer, and never while the tab shows another view, which holds nothing to read for.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function useOverview(): AffectedAreasRead<OverviewRow[]> & { reload: () => void } {
  return useLaneRead<OverviewRow[]>(OVERVIEW_KEY, overviewFor);
}
