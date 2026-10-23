import { useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** The page fetched for one `sha:page`: its object URL, or null where its bytes did not arrive. */
type Loaded = { key: string; url: string | null };

/**
 * The PNG of one page of one exact file, as an object URL: null while it loads, when it failed, and while there is no
 * page to show (a null sha or page). It is fetched with the token (`<img>` cannot send one), the URL is revoked when the
 * page changes or the view goes, and a fetch whose page has since changed is aborted so a page pressed through quickly
 * leaves no request running. A page whose bytes did not arrive reads null, which the page screen draws as its neutral
 * tile with the page's number. The browser keeps the bytes a year (`immutable`: the sha IS the file), so a page opened
 * again costs no transfer.
 *
 * Used by the carrier-bulletins module's view root, for the open page.
 */
export function usePageImage(sha: string | null, page: number | null): string | null {
  // The page that arrived, with the page it answers, so a page that changed shows nothing of the old one at once (its
  // URL is revoked by then) without an effect to clear it; null is a fetch that ended without bytes.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = sha === null || page === null ? null : `${sha}:${page}`;

  useEffect(() => {
    if (sha === null || page === null || key === null) return undefined;
    let created: string | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await api.carrierBulletins.image(sha, page, { signal: controller.signal });
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        // The page may have changed while the blob was read: the cleanup already ran and would never revoke this one.
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        created = url;
        setLoaded({ key, url });
      } catch (failure) {
        if (controller.signal.aborted) return;
        // A settled record with no URL: the tile stands, and Enlarge stays off, rather than waiting on a load that is over.
        console.warn(`The bulletin page ${page} could not be fetched`, failure);
        setLoaded({ key, url: null });
      }
    })();

    return () => {
      controller.abort();
      if (created !== null) URL.revokeObjectURL(created);
      // The record still names this URL and, once revoked, an `<img>` handed it fails to load. A page that comes back (Back
      // and open it again) would find its own old key and draw it, so the record goes.
      setLoaded(null);
    };
  }, [sha, page, key]);

  return loaded !== null && loaded.key === key ? loaded.url : null;
}
