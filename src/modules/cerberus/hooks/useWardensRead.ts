import { useCallback, useEffect, useRef, useState } from 'react';

import { api, REQUEST_TIMEOUT_MS } from '@/shared/api';
import type { CerberusWardens } from '@/shared/cerberus-types';

/** True when a body is the wardens shape: the release (or its absence) and the node list every reader dereferences. */
function isWardens(body: unknown): body is CerberusWardens {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { latest?: unknown; nodes?: unknown };
  return candidate.latest !== undefined && Array.isArray(candidate.nodes);
}

/**
 * WHERE THE FLEET'S WARDENS STAND, read beside the overview: `GET /api/cerberus/wardens`, the release center
 * holds, each node's warden version against it and the batch running.
 *
 * It follows the catalog's rules (`useCatalogRead`): a read takes a ticket and an answer older than the newest
 * one applied is dropped, so a read that left before a batch's start cannot land after the start's re-read and
 * put "Wardens up to date" back over a batch that is running. Only a good answer replaces what is held; a read
 * that fails keeps the last one, and the header draws nothing while there has been none, since with no answer
 * there is no release to offer.
 *
 * `readWardens` resolves when the read has answered or failed, and never rejects. The provider's `refresh`
 * starts it beside the overview's read and does not wait for it. Used by `CerberusProvider`.
 */
export function useWardensRead(): { wardens: CerberusWardens | null; readWardens: () => Promise<void> } {
  // The last good answer, null until one comes: the header's button and the dialog both wait for it, and
  // "not read yet" must never look like "nothing to update".
  const [wardens, setWardens] = useState<CerberusWardens | null>(null);

  // Mount flag, and the ticket counters: which read this is, and the newest whose good answer was applied.
  const mountedRef = useRef(true);
  const newestReadRef = useRef(0);
  const newestAnswerRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const readWardens = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    let answer: CerberusWardens | null = null;
    // The read's own deadline, as the overview's: older WebKit cannot build `AbortSignal.timeout`.
    const deadline = new AbortController();
    const deadlineTimer = window.setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await api.cerberus.wardens({ signal: deadline.signal });
      if (response.ok) {
        const body: unknown = await response.json();
        // An older server may leave `running` out; every reader counts it, so it is filled in as none.
        if (isWardens(body)) answer = { ...body, running: body.running ?? [] };
      }
    } catch {
      // This app's own network, the deadline above, or a body that is not JSON: no answer, as a refusal is.
    } finally {
      window.clearTimeout(deadlineTimer);
    }
    if (answer === null || !mountedRef.current || ticket < newestAnswerRef.current) return;
    newestAnswerRef.current = ticket;
    setWardens(answer);
  }, []);

  return { wardens, readWardens };
}
