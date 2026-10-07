import { useEffect, useState } from 'react';

import { api, REQUEST_TIMEOUT_MS } from '@/shared/api';
import { freshestBatch } from '@/modules/cerberus/utils/wardenUpdates';
import type { CerberusStartedBatch, CerberusUpdateView } from '@/shared/cerberus-types';

/** How long after one read of the batch answers the next is asked: the dialog's "every 2 s while open". */
const POLL_MS = 2_000;

/** True when a body is a batch's updates: a list with at least one (a batch is never empty, so an empty one is an id center does not know). */
function isBatch(body: unknown): body is CerberusUpdateView[] {
  return Array.isArray(body) && body.length > 0;
}

/**
 * ONE BATCH OF WARDEN UPDATES, followed: `GET /api/cerberus/updates/:batch` read again 2 s after each answer,
 * for as long as the caller stands and some update of it has not ended. Used by `UpdateWardensDialog`, which
 * mounts it only while open, so closing the dialog stops the reads and never the batch.
 *
 * `seed` is what the caller already knew when it began following (the answer to the press that started the
 * batch, or the running batch the wardens read held), shown until the first read answers so the dialog never
 * flashes back to choosing. The caller keeps it current with what the provider pushes on every update frame (an
 * update is over in under half a second, so a poll every 2 s would see its steps only after it ended), and the
 * answer is whichever of the two knows more, per update (`freshestBatch`): a poll that left before a step and
 * answered after it never puts the dialog back. A read that fails or answers nothing keeps what was held and the
 * next is asked as usual; one read at a time, so a slow answer is never overtaken by the next ask. Answers `null`
 * while no batch is followed.
 */
export function useUpdateBatch(batch: string | null, seed: CerberusUpdateView[]): CerberusUpdateView[] | null {
  // The newest good answer, tagged with the batch it is for. Essential: the dialog draws its rows from it,
  // and tagging it lets a followed batch's answer never be shown under another batch's id.
  const [polled, setPolled] = useState<CerberusStartedBatch | null>(null);

  useEffect(() => {
    if (batch === null) return undefined;
    let stopped = false;
    let timer: number | undefined;

    const read = async () => {
      let answer: CerberusUpdateView[] | null = null;
      // The read's own deadline, as every read of this tab: older WebKit cannot build `AbortSignal.timeout`.
      const deadline = new AbortController();
      const deadlineTimer = window.setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await api.cerberus.updateBatch(batch, { signal: deadline.signal });
        if (response.ok) {
          const body: unknown = await response.json();
          if (isBatch(body)) answer = body;
        }
      } catch {
        // This app's own network, the deadline above, or a body that is not JSON: no answer, asked again below.
      } finally {
        window.clearTimeout(deadlineTimer);
      }
      if (stopped) return;
      if (answer !== null) setPolled({ batch, updates: answer });
      // An ended update never changes again, so a batch whose every update ended is read no more.
      if (answer !== null && answer.every((update) => update.result !== null)) return;
      timer = window.setTimeout(() => void read(), POLL_MS);
    };

    void read();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [batch]);

  if (batch === null) return null;
  return polled?.batch === batch ? freshestBatch(polled.updates, seed) : seed;
}
