import { useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** The photos fetched for one list of shas: each sha's object URL, or null where its bytes did not arrive. */
type Loaded = { key: string; urls: Record<string, string | null> };

/**
 * The photos of a list of views, as object URLs by sha. Each is fetched with the token (`<img>` cannot send one), set
 * as it arrives, revoked when the list changes or the view goes, and aborted when the list changes before it lands.
 * A sha whose bytes did not arrive reads null, which the picture draws as its neutral tile. The browser keeps the bytes
 * a year (`immutable`: the sha IS the content), so a list read again costs no transfer.
 *
 * Used by the affected-areas module's view root, for the gallery's tiles; `useImageUrl` is its one-photo form.
 */
export function useImageUrls(shas: string[]): Record<string, string | null> {
  // The photos that arrived, with the list they answer, so a list that changed shows none of the old one's at once
  // (their URLs are revoked by then) without an effect to clear them.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = [...new Set(shas)].join(',');

  useEffect(() => {
    if (key === '') return undefined;
    const created: string[] = [];
    const controller = new AbortController();
    const settle = (sha: string, url: string | null) => setLoaded((previous) => ({ key, urls: { ...(previous?.key === key ? previous.urls : {}), [sha]: url } }));

    for (const sha of key.split(',')) {
      void (async () => {
        try {
          const response = await api.affectedAreas.image(sha, { signal: controller.signal });
          if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
          const url = URL.createObjectURL(await response.blob());
          // The list may have changed while the blob was read: the cleanup already ran and would never revoke this one.
          if (controller.signal.aborted) {
            URL.revokeObjectURL(url);
            return;
          }
          created.push(url);
          settle(sha, url);
        } catch (failure) {
          if (controller.signal.aborted) return;
          // A settled record with no URL: the picture says its bytes did not arrive rather than waiting on a load that is over.
          settle(sha, null);
        }
      })();
    }

    return () => {
      controller.abort();
      for (const url of created) URL.revokeObjectURL(url);
      // The record still names these URLs and, once revoked, an `<img>` handed one fails to load. A list that comes back
      // (the tour screen, shown again after a pano) would find its own old key and draw them, so the record goes.
      setLoaded(null);
    };
  }, [key]);

  return loaded !== null && loaded.key === key ? loaded.urls : {};
}

/**
 * The photo of one view as an object URL: null while it loads, when it failed, and when there is no view (a null sha).
 * The shown face's, so a face pressed while the last one loads aborts that fetch and fetches the new.
 *
 * Used by the affected-areas module's view root, for the shown face.
 */
export function useImageUrl(sha: string | null): string | null {
  const urls = useImageUrls(sha === null ? [] : [sha]);
  return sha === null ? null : urls[sha] ?? null;
}
