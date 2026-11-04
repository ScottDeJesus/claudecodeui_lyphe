import { useCallback, useEffect, useRef, useState } from 'react';

import { api, attemptWrite, errorMessage } from '@/shared/api';
import type { VocabularyEntry, VocabularyRow } from '@/shared/types';

/** The list a save sends, made from the list as it stands when that save's turn comes: see `useVocabulary`. */
type VocabularyChange = (rows: VocabularyRow[]) => VocabularyRow[];

type VocabularyState = {
  /** The account's house words as the server last answered them, each with the client-only id its row is keyed by; null until the first read lands (and while a read has failed). */
  rows: VocabularyRow[] | null;
  /** A save is out or waiting its turn: every press on the editor waits for it, and "Saving…" shows. His typing never waits. */
  saving: boolean;
  /** The server's sentence for the last refused save (cleared when a burst of saves begins); while `rows` is still null, why the read failed. Null when none. */
  error: string | null;
  /** Saves the list `change` makes of the list as it stands when this save's turn comes, after every save asked for before it has answered. Resolves true when the server took it (and `rows` is its answer, every row keeping its id), false when it refused or could not be reached (`error` says why). */
  save: (change: VocabularyChange) => Promise<boolean>;
  /** A row for a word the account is adding, with an id no other row has: hand it to `save` at the end of the list. */
  rowFor: (entry: VocabularyEntry) => VocabularyRow;
  /** Reads the list again, for the Try again of a read that failed. */
  retry: () => Promise<void>;
};

// The last row id handed out. A page-lifetime counter, never sent to the server: it only has to differ between the rows on screen.
let lastRowId = 0;

function newRowId(): number {
  lastRowId += 1;
  return lastRowId;
}

function rowOf(entry: VocabularyEntry): VocabularyRow {
  return { id: newRowId(), entry };
}

/**
 * The rows for a list the server answered, to a read or to the save that sent `sent`: each takes the id of the row at its place,
 * because the server keeps the order and the count of a list (it refuses one rather than drop an entry). A count that differs is
 * not an answer to that list, and every row is new. A read of an unchanged list therefore keeps every id, and no row remounts.
 */
function rowsAnswering(answer: VocabularyEntry[], sent: VocabularyRow[] | null): VocabularyRow[] {
  const sameCount = sent !== null && sent.length === answer.length;
  return answer.map((entry, at) => (sameCount ? { id: sent[at].id, entry } : rowOf(entry)));
}

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
 * what is stored. Saves run one at a time, in the order they were asked for, and each is made from the list the one before it
 * answered (`save` takes a function of the list, never a list): an edit made while a save is out is built on top of that save,
 * never on the list the save is about to replace, so nothing he types ever has to wait.
 *
 * Every row carries a client-only id, made when a word is added and kept through every read and save: the server answers the
 * list in the order it was sent, one entry for each, so the answer's rows take the ids of the rows at their places. The editor
 * keys its rows by it, so a word renamed in place stays the same row and keeps the focus in the field it was typed in. A read
 * that was out when a save was asked for, or lands while one is out, is dropped as older than the save's answer: the mount
 * reads twice in dev (React StrictMode), and a second read landing inside a save once remounted every row and dropped the focus.
 */
export function useVocabulary(): VocabularyState {
  // The list as the server last answered, with each row's id. Null before any answer: the editor has no honest list to draw, and a save from a guess would replace the real one.
  const [rows, setRows] = useState<VocabularyRow[] | null>(null);
  // True from a save's request until its answer, so the controls wait and "Saving…" shows.
  const [saving, setSaving] = useState(false);
  // The last refusal (or, before any read has landed, the failed read's reason), drawn under the table.
  const [error, setError] = useState<string | null>(null);

  // False once unmounted: a save outlives the tab that made it, and a closed tab has nothing to draw.
  const aliveRef = useRef(true);
  // The list as last answered, for a save's turn to build from: state is a render behind, and a save waiting behind another must start from what that one answered.
  const rowsRef = useRef<VocabularyRow[] | null>(null);
  // Counts the saves asked for, so a read that was out when one was asked for is dropped as older than it.
  const savesAskedRef = useRef(0);
  // Saves asked for and not yet answered: a read that lands while any is out is older than what it will say, and `saving` is true while any is.
  const savesOutRef = useRef(0);
  // The end of the line of saves: a save's turn starts when the one before it has answered.
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Draws `next` and keeps it for the next save to build from. */
  const adopt = useCallback((next: VocabularyRow[]) => {
    rowsRef.current = next;
    setRows(next);
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
    const askedBefore = savesAskedRef.current;
    return readOutcome().then((outcome) => {
      // A save asked for since this read began, or still out, is newer than it, and the tab may be gone.
      if (!aliveRef.current || savesAskedRef.current !== askedBefore || savesOutRef.current > 0) return;
      if ('list' in outcome) {
        adopt(rowsAnswering(outcome.list, rowsRef.current));
        setError(null);
      } else if (rowsRef.current === null) {
        // Only a read with nothing drawn has a failure to show: a later read that fails leaves the list standing, and is no refusal of any row's save.
        setError(outcome.failure);
      }
    });
  }, [readOutcome, adopt]);

  useEffect(() => {
    void read();
  }, [read]);

  const retry = useCallback(async () => {
    setError(null);
    await read();
  }, [read]);

  /** One save's turn: `change` made on the list as it stands now, sent, and the answer drawn. Never throws for a server fault; resolves whether the server took it. */
  const runSave = useCallback(async (change: VocabularyChange): Promise<boolean> => {
    const base = rowsRef.current;
    // No list has been drawn, so there is nothing a save could be made from (the editor shows no rows then).
    if (base === null) return false;
    const next = change(base);
    const outcome = await attemptWrite(() => api.voice.saveVocabulary(next.map((row) => row.entry)));
    const stored = outcome.landed ? asVocabulary(await outcome.response.json().catch(() => null)) : null;
    if (aliveRef.current) {
      if (stored !== null) adopt(rowsAnswering(stored, next));
      else setError(outcome.landed ? "Not saved: the server's answer was not understood." : outcome.sentence ?? 'Not saved: the server could not be reached.');
    }
    return stored !== null;
  }, [adopt]);

  const save = useCallback((change: VocabularyChange): Promise<boolean> => {
    // The first save of a burst clears the last refusal; one waiting behind another leaves it, so a refusal is never wiped before it is read.
    if (savesOutRef.current === 0) setError(null);
    savesAskedRef.current += 1;
    savesOutRef.current += 1;
    setSaving(true);
    const turn = queueRef.current.then(() => runSave(change)).finally(() => {
      savesOutRef.current -= 1;
      if (aliveRef.current) setSaving(savesOutRef.current > 0);
    });
    // A turn that threw (a fault in `change`) goes to its caller, and the line moves on.
    queueRef.current = turn.catch(() => false);
    return turn;
  }, [runSave]);

  return { rows, saving, error, save, rowFor: rowOf, retry };
}
