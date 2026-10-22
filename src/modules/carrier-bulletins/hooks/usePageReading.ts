import { api } from '@/shared/api';
import type { PageReading } from '@/shared/carrier-bulletins-types';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { AffectedAreasRead } from '@/shared/types';

/**
 * One page's read, by `bulletinId:page`: module-level so `useLaneRead` sees the same function every render. A bulletin id
 * is a uuid and a page a number, so neither holds a colon.
 */
const readingFor = (key: string) => {
  const [bulletinId, page] = key.split(':');
  return api.carrierBulletins.page(bulletinId, Number(page));
};

/**
 * What Claude read on the open page and what the house settled it into, with the exact file the page is of (whose PNG
 * `usePageImage` fetches). Read when a page opens and on a press; nothing is read while `page` is null (the carrier's
 * pages, or the overview, show). A page with no answer (not read, or waiting) comes back as a reading whose `reading` is null.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function usePageReading(bulletinId: string | null, page: number | null): AffectedAreasRead<PageReading> & { reload: () => void } {
  return useLaneRead<PageReading>(bulletinId === null || page === null ? null : `${bulletinId}:${page}`, readingFor);
}
