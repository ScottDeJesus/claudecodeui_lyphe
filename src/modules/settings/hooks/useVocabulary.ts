import { useCallback, useEffect, useRef, useState } from 'react';

import { api, attemptWrite, errorMessage } from '@/shared/api';
import type { VocabularyEntry } from '@/shared/types';

type VocabularyState = {
  /** The account's house words as the server last answered them; null until the first read lands (and while a read has failed). */
  entries: VocabularyEntry[] | null;
  /** A save is out: every press on the editor waits for it, because the next list is made from the one drawn. */
  saving: boolean;
  /** The server's sentence for the last refused save; while `entries` is still null, why the read failed. Null when none. */
  error: string | null;
  /** Replaces the whole list. Resolves true when the server took it (and `entries` is its answer), false when it refused or could not be reached (`error` says why). */
  save: (next: VocabularyEntry[]) => Promise<boolean>;
  /** Reads the list again, for the Try again of a read that failed. */
  retry: () => Promise<void>;
};

/** The list in a `{ vocabulary }` body, or null when the body is not one: an expired token's envelope parses as JSON too, so nothing is trusted unread. */
function asVocabulary(body: unknown): VocabularyEntry[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const list = (body as { vocabulary?: unknown }).vocabulary;
  if (!Array.isArray(list)) return null;
  const entries: VocabularyEntry[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) return null;
    const { spelling, pronunciation, misheard } = item as Record<string, unknown>;
    if (typeof spelling !== 'string' || typeof pronunciation !== 'string') return null;
    if (!Array.isArray(misheard) || !misheard.every((form) => typeof form === 'string')) return null;
    entries.push({ spelling, pronunciation, misheard: [...misheard] });
  }
  return entries;
}

/**
 * The one reader and writer of the account's vocabulary in `src/`: `GET` and `PUT /api/voice/vocabulary`. Used by the settings
 * module's VocabularySection, the editor of the table both transcribers and Kaylee's speech read.
 *
 * Nothing is optimistic: what the page draws is the server's last answer, so a refused save leaves the old list standing with
 * the server's sentence under it. A save is the WHOLE list, which the server normalises and answers, so the editor always shows
 * what is stored. Only one save runs at a time: the editor's buttons and chips wait while `saving`, and its text fields are
 * read-only, so no edit is ever built from a list that a save in flight is about to replace.
 */
export function useVocabulary(): VocabularyState {
  // The list as the server last answered. Null before any answer: the editor has no honest list to draw, and a save from a guess would replace the real one.
  const [entries, setEntries] = useState<VocabularyEntry[] | null>(null);
  // True from a save's request until its answer, so the controls wait and "Saving…" shows.
  const [saving, setSaving] = useState(false);
  // The last refusal (or, before any read has landed, the failed read's reason), drawn under the table.
  const [error, setError] = useState<string | null>(null);

  // False once unmounted: a save outlives the tab that made it, and a closed tab has nothing to draw.
  const aliveRef = useRef(true);
  // Counts the saves that landed, so a read that was out when one landed is dropped as older than it.
  const landedSavesRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** One read, judged: the list it answers, or the sentence for why there is none. Never throws. */
  const readOutcome = useCallback(async (): Promise<{ list: VocabularyEntry[] } | { failure: string }> => {
    try {
      const response = await api.voice.vocabulary();
      const body: unknown = await response.json().catch(() => null);
      const list = response.ok ? asVocabulary(body) : null;
      if (list !== null) return { list };
      const sentence = body !== null && typeof body === 'object' ? errorMessage((body as { error?: unknown }).error) : null;
      return { failure: sentence ?? `the server answered ${response.status}` };
    } catch {
      return { failure: 'the server could not be reached' };
    }
  }, []);

  const read = useCallback((): Promise<void> => {
    const landedBefore = landedSavesRef.current;
    return readOutcome().then((outcome) => {
      // A save that landed while this read was out is newer than it, and the tab may be gone.
      if (!aliveRef.current || landedSavesRef.current !== landedBefore) return;
      if ('list' in outcome) {
        setEntries(outcome.list);
        setError(null);
      } else {
        setError(outcome.failure);
      }
    });
  }, [readOutcome]);

  useEffect(() => {
    void read();
  }, [read]);

  const retry = useCallback(async () => {
    setError(null);
    await read();
  }, [read]);

  const save = useCallback(async (next: VocabularyEntry[]): Promise<boolean> => {
    setSaving(true);
    setError(null);
    const outcome = await attemptWrite(() => api.voice.saveVocabulary(next));
    const stored = outcome.landed ? asVocabulary(await outcome.response.json().catch(() => null)) : null;
    if (stored !== null) landedSavesRef.current += 1;
    if (aliveRef.current) {
      if (stored !== null) setEntries(stored);
      else setError(outcome.landed ? "Not saved: the server's answer was not understood." : outcome.sentence ?? 'Not saved: the server could not be reached.');
      setSaving(false);
    }
    return stored !== null;
  }, []);

  return { entries, saving, error, save, retry };
}
