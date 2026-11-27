import { useEffect, useRef, useState } from 'react';

import { api, REQUEST_TIMEOUT_MS } from '@/shared/api';
import { freshestBatch } from '@/modules/cerberus/utils/wardenUpdates';
import type { CerberusStartedBatch, CerberusUpdateView } from '@/shared/cerberus-types';
import { useServerFrame } from '@/shared/hooks/useServerFrame';

/** The frame a warden update moves on; only one flagged `updates: true` is read here. */
const UPDATE_FRAME_KINDS = ['cerberus_changed'] as const;

/** True when a body is a batch's updates: a list with at least one (a batch is never empty, so an empty one is an id center does not know). */
function isBatch(body: unknown): body is CerberusUpdateView[] {
  return Array.isArray(body) && body.length > 0;
}

/**
 * ONE BATCH OF WARDEN UPDATES, followed: `GET /api/cerberus/updates/:batch` read on mount, on every
 * `cerberus_changed` frame flagged `updates: true` (center sends one for each moment of an update, unheld) and
 * on a reconnect, for as long as the caller stands and some update of it has not ended. Used by
 * `UpdateWardensDialog`, which mounts it only while open, so closing the dialog stops the reads and never the batch.
 *
 * `seed` is what the caller already knew when it began following (the answer to the press that started the
 * batch, or the running batch the wardens read held), shown until the first read answers so the dialog never
 * flashes back to choosing. The caller keeps it current with what the provider reads on the same frames, and the
 * answer is whichever of the two knows more, per update (`freshestBatch`): a read that left before a step and
 * answered after it never puts the dialog back. A read that fails or answers nothing keeps what was held until the
 * next frame; one read at a time, and a frame that lands while one is out asks for exactly one more when it
 * answers, so a slow answer is never overtaken. Answers `null` while no batch is followed.
 */
export function useUpdateBatch(batch: string | null, seed: CerberusUpdateView[]): CerberusUpdateView[] | null {
  // The newest good answer, tagged with the batch it is for. Essential: the dialog draws its rows from it,
  // and tagging it lets a followed batch's answer never be shown under another batch's id.
  const [held, setHeld] = useState<CerberusStartedBatch | null>(null);

  // The read of the batch followed now, or nothing while none is. A ref, so the frame subscription is made once.
  const readRef = useRef<() => void>(() => undefined);
  useServerFrame(UPDATE_FRAME_KINDS, (event) => {
    if (event.kind === 'websocket_reconnected' || event.updates === true) readRef.current();
  });

  useEffect(() => {
    if (batch === null) return undefined;
    let stopped = false;
    let reading = false;
    let readAgain = false;
    let ended = false;

    const read = async () => {
      if (ended) return;
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
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
        // This app's own network, the deadline above, or a body that is not JSON: no answer, read again on the next frame.
      } finally {
        window.clearTimeout(deadlineTimer);
      }
      reading = false;
      if (stopped) return;
      if (answer !== null) setHeld({ batch, updates: answer });
      // An ended update never changes again, so a batch whose every update ended is read no more.
      if (answer !== null && answer.every((update) => update.result !== null)) {
        ended = true;
        return;
      }
      if (readAgain) {
        readAgain = false;
        void read();
      }
    };

    readRef.current = () => void read();
    void read();
    return () => {
      stopped = true;
      readRef.current = () => undefined;
    };
  }, [batch]);

  if (batch === null) return null;
  return held?.batch === batch ? freshestBatch(held.updates, seed) : seed;
}
