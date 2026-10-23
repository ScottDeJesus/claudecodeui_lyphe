import type { TourDetail } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { AffectedAreasRead } from '@/shared/types';

/** One tour's read, by the id it is asked for: module-level so `useLaneRead` sees the same function every render. */
const tourFor = (tourId: string) => api.affectedAreas.tour(tourId);

/**
 * The open tour: its job, rooms and panos, read when it opens (a null id reads nothing) and again by `reload`, which
 * the view root calls after each answer of the walk and of a press, so the gallery's badges and the counts follow
 * what was read. A quiet reload keeps the tour on screen until the new one arrives.
 *
 * Used by the affected-areas module's view root.
 */
export function useTour(tourId: string | null): AffectedAreasRead<TourDetail> & { reload: () => void } {
  const read = useLaneRead<TourDetail>(tourId, tourFor);
  return { value: read.value, trouble: read.trouble, retry: read.retry, reload: read.reload };
}
