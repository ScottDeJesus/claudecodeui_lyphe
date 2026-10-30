import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, errorMessage, refusalSentence } from '@/shared/api';
import type { CompanionMemoryReading } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';

/** Whether `body` is what `GET /api/companion/memory` answers: a count (or null with a reason), her page's id, and a reason (or null). */
function isReading(body: unknown): body is CompanionMemoryReading {
  if (typeof body !== 'object' || body === null) return false;
  const { count, pageId, reason } = body as Record<string, unknown>;
  return (count === null || typeof count === 'number') && typeof pageId === 'string' && (reason === null || typeof reason === 'string');
}

/**
 * Used by this module's CompanionMemorySettings, which draws Settings > Voice > Companion's "Her memory" card from what it returns.
 *
 * The card's own read and clear of her memory bank: `GET /api/companion/memory` when the section opens, `DELETE` when he confirms Clear,
 * and the `GET` again after it. EVENTS, NOT A WATCHDOG: no frame announces her bank, so nothing here polls it or re-reads on a timer. A
 * count is as old as the last open or clear, which is the truth of a card he looks at and acts on.
 *
 * The read after a clear happens whether the clear went through or was refused: a clear that stopped part way (the docstore door
 * went away between two retires) has already forgotten some, so the count the card keeps drawing would be wrong. A refused clear is
 * a warn toast naming her and carrying the server's sentence, and the card stays as it was for another try.
 *
 * A read that fails, is refused, or answers something that is not a reading (a proxy's `null`, another server's JSON) is a reading
 * with `count: null` and the failure as its `reason`, which the card draws as its warn Banner. It is never a count of zero, and
 * never the waiting row: "she keeps nothing", "I could not read her bank" and "I am still reading" are three different things to tell him.
 */
export function useCompanionMemorySettings(name: string) {
  const { t } = useTranslation('settings');
  const pushToast = useToast();
  // Her bank as the card last read it: the card draws its count, link and clear from this and nothing else holds it. Null only while the
  // FIRST read is out; a later read (after a clear) keeps the last reading here until its answer replaces it, so the card never falls back to its waiting row.
  const [reading, setReading] = useState<CompanionMemoryReading | null>(null);
  // A clear is out, from the confirm until the server has answered and the read after it has landed: the confirm is busy and cannot be
  // pressed twice. It cannot be derived: nothing else in the page knows a request is in flight.
  const [clearing, setClearing] = useState(false);
  // False once the card unmounted: a read or a clear that lands then sets nothing.
  const aliveRef = useRef(false);
  // True from the first activation of the confirm until the clear and the read after it have finished. `clearing` above is only what the
  // last render saw, so two activations in one task (before React has rendered it) would each pass a check of it and send two DELETEs; a ref changes at once.
  const clearingRef = useRef(false);
  // The number of the newest read started. Reads can overlap (the open's and a clear's), and only the newest one's answer may become the reading.
  const newestReadRef = useRef(0);

  const read = useCallback(async () => {
    newestReadRef.current += 1;
    const mine = newestReadRef.current;
    let next: CompanionMemoryReading;
    try {
      const response = await api.companion.memory.read();
      if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
      const body: unknown = await response.json();
      if (!isReading(body)) throw new Error('The answer was not a reading of her memory.');
      next = body;
    } catch (error) {
      console.warn('[Companion] Could not read her memory:', error);
      // No page id: the unreadable card draws a Banner and no link, and the client does not know her page's id except from the server.
      next = { count: null, pageId: '', reason: errorMessage(error) ?? 'the request failed' };
    }
    if (aliveRef.current && mine === newestReadRef.current) setReading(next);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void read();
    return () => {
      aliveRef.current = false;
    };
  }, [read]);

  /** Clears her whole memory and reads her bank again, refused or not. Called from the card's confirm alone. */
  const clear = useCallback(async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    try {
      const response = await api.companion.memory.clear();
      if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
    } catch (error) {
      pushToast({ tone: 'warn', title: t('voiceSettings.companion.memory.clearRefused', { name }), message: errorMessage(error) ?? undefined });
    }
    await read();
    clearingRef.current = false;
    if (aliveRef.current) setClearing(false);
  }, [name, pushToast, read, t]);

  return { reading, clearing, clear };
}
