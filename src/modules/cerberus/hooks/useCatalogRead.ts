import { useCallback, useEffect, useRef, useState } from 'react';

import { api, REQUEST_TIMEOUT_MS } from '@/shared/api';
import type { CerberusCatalogEntryView } from '@/shared/cerberus-types';

/**
 * THE CATALOG, read beside the overview: `GET /api/cerberus/catalog`, every unretired entry.
 *
 * It follows the overview's rules, on a smaller scale. A read takes a ticket and an answer older than the
 * newest one applied is dropped, so a read that left before a write cannot land after the write's re-read
 * and put the entry's old switch back. Only a good answer (a 200 whose body is a list) replaces what is
 * held; a read that fails keeps the entries it had, and says it failed only while there are none.
 *
 * `readCatalog` resolves when the read has answered or failed, and never rejects. The provider's `refresh`
 * starts it beside the overview's read and does NOT wait for it: the catalog is secondary data, and a write's
 * verdict must not wait out a catalog read that hangs. Used by `CerberusProvider`.
 */
export function useCatalogRead(): {
  catalog: CerberusCatalogEntryView[] | null;
  catalogFailed: boolean;
  readCatalog: () => Promise<void>;
} {
  // The entries the last good read brought, null until one answers: "not read yet" must look different on
  // screen from a catalog with nothing in it.
  const [catalog, setCatalog] = useState<CerberusCatalogEntryView[] | null>(null);

  // True while no read has ever answered and the last one failed: what turns the Catalog's shimmering rows
  // into its "can't be reached" box. A failed read after a good one never sets it.
  const [catalogFailed, setCatalogFailed] = useState(false);

  // Mount flag, and the ticket counters: which read this is, and the newest whose good answer was applied.
  const mountedRef = useRef(true);
  const newestReadRef = useRef(0);
  const newestAnswerRef = useRef(0);
  // Whether any read has answered, mirrored so a failed read can tell "never" from "once" without being rebuilt by it.
  const answeredRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readCatalog = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    let answer: CerberusCatalogEntryView[] | null = null;
    // The read's own deadline, as the overview's: older WebKit cannot build `AbortSignal.timeout`.
    const deadline = new AbortController();
    const deadlineTimer = window.setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await api.cerberus.catalog({ signal: deadline.signal });
      if (response.ok) {
        const body: unknown = await response.json();
        if (Array.isArray(body)) answer = body as CerberusCatalogEntryView[];
      }
    } catch {
      // This app's own network, the deadline above, or a body that is not JSON: no answer, as a refusal is.
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    if (!mountedRef.current) return;
    if (answer === null) {
      if (!answeredRef.current) setCatalogFailed(true);
      return;
    }
    if (ticket < newestAnswerRef.current) return;
    newestAnswerRef.current = ticket;
    answeredRef.current = true;
    setCatalog(answer);
    setCatalogFailed(false);
  }, []);

  return { catalog, catalogFailed, readCatalog };
}
