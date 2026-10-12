import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/** Which of the two defaults a press moves: how many features of an epic are in progress, or how many tasks each runs. */
type WipLimit = 'features' | 'tasks';

/** Both defaults as the file holds them — each limit's word, `'<N>'` or `'all'`. */
type WipWords = { features: string; tasks: string };

/** How long to wait before asking a second time. One failure is far more often a lost packet than a missing file, and a row with no position cannot be used. */
const READ_RETRY_MS = 1200;

/** One limit's word as the server writes it: `all`, or a whole number from 1 with no leading zero, inside the range both languages hold. */
function wordOf(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:all|[1-9][0-9]*)$/.test(value)) return null;
  return value === 'all' || Number.isSafeInteger(Number(value)) ? value : null;
}

/**
 * The two defaults in a `GET` or `PUT` answer, or `null` when the body is not them.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is
 * `{success:false,error:{…}}`, which `.json()` parses happily: a body without both words is "could not
 * ask", never a default — a stepper that read that as two and two would draw numbers for a file that
 * may hold nine.
 */
function wordsOf(body: unknown): WipWords | null {
  if (typeof body !== 'object' || body === null) return null;
  const { features, tasks } = body as { features?: unknown; tasks?: unknown };
  const featuresWord = wordOf(features);
  const tasksWord = wordOf(tasks);
  return featuresWord === null || tasksWord === null ? null : { features: featuresWord, tasks: tasksWord };
}

/** The defaults as the server reads them off disk, or `null` when they could not be read. */
async function readWords(): Promise<WipWords | null> {
  try {
    const response = await api.settings.wipDefaults();
    if (!response.ok) return null;
    return wordsOf(await response.json());
  } catch (error) {
    console.error('Error loading the WIP defaults:', error);
    return null;
  }
}

/** The write, returning the words the server read back off the file, or `null` if it failed. */
async function writeWords(next: WipWords): Promise<WipWords | null> {
  try {
    const response = await api.settings.saveWipDefaults(next);
    // A refused write is not a position either: the row must not keep the numbers it asked for over a
    // file that never took them.
    if (!response.ok) return null;
    return wordsOf(await response.json());
  } catch (error) {
    console.error('Error saving the WIP defaults:', error);
    return null;
  }
}

/** One read, and a second after a pause when the first got no answer. */
async function readWordsWithRetry(): Promise<WipWords | null> {
  const first = await readWords();
  if (first !== null) return first;
  await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
  return readWords();
}

type WipDefaults = {
  /** Both defaults as the server last read them off disk, or `null` while no read has succeeded. */
  words: WipWords | null;
  /** True once a read has failed: the defaults are unknown, which is not the same as two and two. */
  unreadable: boolean;
  /** True while a write is in flight, so the row can tell assistive tech it is busy. */
  saving: boolean;
  /** Move one default. The file is written whole, so the other default rides along — as the file holds it when the write goes out, not as this row last read it. A press while a write is in flight is folded into the next write rather than dropped. */
  setLimit: (limit: WipLimit, word: string) => Promise<void>;
  /** Ask the server again — the way out of an unreadable file, and the only press a row with no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the dispatcher's WIP defaults in `src/`. Used by the settings module's
 * `RunnerWipDefaultsRow`, which composes it; the fetch/save/re-read/error logic lives here once.
 *
 * The defaults are NOT a client preference and so are not `readUserPreference`: they are a file on this
 * host (`~/.claude/state/wip.flag`) that the dispatcher re-reads at every take-up, which is why every
 * read here is a request to the server rather than a value the browser already holds. The board does
 * not use this hook: it draws the dispatcher's own frame, which states the defaults beside each epic's
 * own words (`DispatcherRoute.wip`).
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS. A read issued before a write and landing after it would draw the
 * numbers the file has already left, so every write retires the reads asked before it (`generation`),
 * and a read is not asked at all while a write is in flight — that write's own answer is already
 * coming, and it is read back off the file.
 */
export function useWipDefaults(): WipDefaults {
  // The two defaults as the server last read them off disk. State, because the steppers draw them;
  // `null` until the server answers, since there is no honest number to draw before then and `null` is
  // what keeps the row from flickering through a wrong one.
  const [words, setWords] = useState<WipWords | null>(null);
  // Set when a read comes back with nothing, so the row can say the defaults are unknown rather than
  // draw numbers it does not have. Cleared by the first answer.
  const [unreadable, setUnreadable] = useState(false);
  // Held while a write is in flight; the row marks its steppers busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  /** Whether a write loop is running -- a ref, because the presses that fold into it must see it at once. */
  const writing = useRef(false);
  /** The limits pressed while a write was in flight, each with its newest word; the loop in `setLimit` writes them next, over a fresh read of the file. */
  const pending = useRef<Partial<WipWords> | null>(null);
  /** Bumped by every write, so a read that started before it can tell it is stale. */
  const generation = useRef(0);

  /** What an answer does to the row: words replace the pair, no answer says the defaults are unknown. */
  const apply = useCallback((truth: WipWords | null) => {
    setUnreadable(truth === null);
    if (truth !== null) setWords(truth);
  }, []);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const asked = generation.current;
    const truth = await readWordsWithRetry();
    // A write that started while this read was out has an answer of its own coming; this one is stale.
    if (generation.current === asked && !writing.current) apply(truth);
  }, [apply]);

  useEffect(() => {
    void refresh();
    // Coming back to the page is the one moment the defaults can have moved under a mounted row — the
    // operator sets them from their phone. `visibilitychange` beside `focus` because iOS Safari fires
    // no reliable blur/focus on an app switch.
    const onFocus = () => { void refresh(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  const setLimit = useCallback(async (limit: WipLimit, word: string) => {
    // No press has a position to move from until a read has landed; the steppers are not drawn then.
    if (words === null) return;
    const wanted: WipWords = { ...words, [limit]: word };
    // Optimistic, then corrected: the server answers with what it read back off the file.
    setWords(wanted);
    setUnreadable(false);
    if (writing.current) {
      pending.current = { ...pending.current, [limit]: word };
      return;
    }
    writing.current = true;
    setSaving(true);
    let asked: Partial<WipWords> | null = { [limit]: word };
    // What this row last held: the fallback for the limit nobody pressed when the re-read below gets no answer.
    let known: WipWords = wanted;
    while (asked !== null) {
      generation.current += 1;
      // THE FILE IS RE-READ JUST BEFORE EVERY WRITE, and only the limits pressed are laid over it. The
      // other default may have moved since this row last read it — the operator sets defaults from his
      // phone, and a desktop tab left in front fires no focus event — and a pair written from this row's
      // copy would silently put the old number back.
      const fresh = await readWords();
      const target: WipWords = { ...(fresh ?? known), ...asked };
      const settled = await writeWords(target);
      // A press that asked for the words the file now holds (`+` then `-` inside one write) has nothing
      // left to write.
      if (settled !== null && pending.current !== null && Object.entries(pending.current).every(([key, value]) => settled[key as WipLimit] === value)) {
        pending.current = null;
      }
      if (settled !== null) {
        known = settled;
        // The pair the file holds, unless a newer press is already waiting to be written.
        if (pending.current === null) setWords(settled);
      } else {
        // The write failed: the row must show the file's truth and not the numbers it asked for. When
        // that read goes unanswered too, the numbers are RETRACTED — unknown, rather than kept.
        generation.current += 1;
        const truth = await readWords();
        pending.current = null;
        setWords(truth);
        setUnreadable(truth === null);
      }
      asked = pending.current;
      pending.current = null;
    }
    writing.current = false;
    setSaving(false);
  }, [words]);

  return { words, unreadable, saving, setLimit, refresh };
}
