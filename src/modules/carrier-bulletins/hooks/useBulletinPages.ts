import { api } from '@/shared/api';
import type { BulletinPage } from '@/shared/carrier-bulletins-types';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { AffectedAreasRead } from '@/shared/types';

/** One bulletin's pages, by the bulletin it is asked for: module-level so `useLaneRead` sees the same function every render. */
const pagesFor = (bulletinId: string) => api.carrierBulletins.pages(bulletinId);

/**
 * The open carrier's pages in page order, with the part each sits in and its state. Read when a carrier opens and on a
 * press; nothing is read while `bulletinId` is null (the overview shows). The page screen leans on the same read for
 * its page's state and part while its own reading is out, and for Previous and Next.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function useBulletinPages(bulletinId: string | null): AffectedAreasRead<BulletinPage[]> & { reload: () => void } {
  return useLaneRead<BulletinPage[]>(bulletinId, pagesFor);
}
