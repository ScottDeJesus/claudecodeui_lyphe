import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/**
 * The cap in a `GET` or `PUT` answer, or `null` when the body is not one.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is
 * `{success:false,error:{…}}`, which `.json()` parses happily: a body without a finite `usd` of 0 or
 * more is "could not ask", never a default — a row that read that as the shipped $5.00 would draw an
 * amount for a cap that may be $50, or $0. (The server itself reads an absent file as $5.00 and
 * answers it as a number; that is a reading, not a default invented here.)
 */
function usdOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { usd } = body as { usd?: unknown };
  return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null;
}

/** The cap as the server reads it off disk, or `null` when it could not be asked. */
async function readUsd(): Promise<number | null> {
  try {
    const response = await api.settings.geminiPlanCap();
    if (!response.ok) return null;
    return usdOf(await response.json());
  } catch (error) {
    console.error('Error loading the Gemini plan cap:', error);
    return null;
  }
}

/** The write, returning the amount the server read back off the file, or `null` if it failed. */
async function writeUsd(next: number): Promise<number | null> {
  try {
    const response = await api.settings.saveGeminiPlanCap(next);
    // A refused write (the server's 400 INVALID_GEMINI_PLAN_CAP, a 5xx) is not an amount either: the row
    // must not keep the number it asked for over a file that never took it.
    if (!response.ok) return null;
    return usdOf(await response.json());
  } catch (error) {
    console.error('Error saving the Gemini plan cap:', error);
    return null;
  }
}

type GeminiPlanCap = {
  /** The cap in dollars as the server last read it off disk, or `null` while no read has succeeded. */
  usd: number | null;
  /**
   * True once a read has failed: the amount is unknown, which is not the same as the $5.00 default. A failed
   * re-ask on focus keeps the last amount read (`usd` stays a number); a refused write whose re-read fails
   * too drops it to `null`, because then what the file holds is not known.
   */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /**
   * Write an amount of 0 or more; anything else sends nothing. The promise settles once the file's
   * truth is drawn — the amount read back, or after a refusal the amount re-read — so the caller can
   * drop the draft it typed that amount into. A call made while a write is in flight is folded into the
   * next one (the newest amount wins) and settles with that loop.
   */
  save: (next: number) => Promise<void>;
  /** Ask the server again — the way out of an unreadable cap, and the only press a row with no amount can honour. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the Gemini budget's per-plan cap in `src/`. Used by the settings module's
 * `RunnerGeminiBudgetRow`, which composes it; the fetch/save/re-read/error logic lives here once.
 *
 * The cap is NOT a client preference and so is not `readUserPreference`: it is a file on this host that the
 * backend's gate re-reads at every Gemini call, which is why every read here is a request to the server
 * rather than a value the browser already holds.
 *
 * ONE FILE, ONE REQUEST AT A TIME, SO ONE ORDER OF ANSWERS. A read is not asked while another read or a
 * write is in flight (the focus and visibility events of one return to the page are one read), and a write
 * waits out a read already on the wire before it goes — so no read can land after a write and draw the
 * amount the file has already left. What the row draws after a write is that write's own read-back, and
 * after a refused write a re-read of the file; nothing here is optimistic, because the amount in force
 * is the file's and not the one asked for.
 *
 * Nothing polls: the file is asked on mount, on focus, on `visibilitychange` and after a write.
 */
export function useGeminiPlanCap(): GeminiPlanCap {
  // The cap as the server last read it off disk. State, because the row draws it; `null` until the server
  // answers, since there is no honest amount to draw before then and the shipped $5.00 is not one.
  const [usd, setUsd] = useState<number | null>(null);
  // Set when a read comes back with nothing, so the row can say the amount is unknown rather than draw one
  // it does not have. Cleared by the first answer.
  const [unreadable, setUnreadable] = useState(false);
  // Held while a write is in flight; the row marks its field busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  /** The read on the wire, if any -- a ref, because a second ask and a write must see it at once. */
  const reading = useRef<Promise<void> | null>(null);
  /** The write loop on the wire, if any -- the promise a save folded into it settles with. */
  const writing = useRef<Promise<void> | null>(null);
  /** The newest amount a save asked for while a write was in flight; the loop writes it next. */
  const pending = useRef<number | null>(null);

  /** What an answer does to the row: an amount replaces it, no answer says the cap is unknown. */
  const apply = useCallback((truth: number | null) => {
    setUnreadable(truth === null);
    if (truth !== null) setUsd(truth);
  }, []);

  const refresh = useCallback(async () => {
    if (reading.current !== null || writing.current !== null) return;
    const read = readUsd().then(apply);
    reading.current = read;
    await read;
    reading.current = null;
  }, [apply]);

  useEffect(() => {
    void refresh();
    // Coming back to the page is the one moment the cap can have moved under a mounted row — the operator
    // sets it from their phone. `visibilitychange` beside `focus` because iOS Safari fires no reliable
    // blur/focus on an app switch.
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

  /** The write loop: one write at a time until no save is waiting, each followed by the file's truth. */
  const writeLoop = useCallback(async (first: number) => {
    // A read already on the wire lands first (it is not stale: no write has landed yet), so its answer can
    // never arrive after this write's and overwrite it.
    await reading.current;
    let target: number | null = first;
    while (target !== null) {
      const settled = await writeUsd(target);
      if (settled !== null) {
        // The amount the file holds, drawn unless a newer save is already waiting to be written.
        if (pending.current === null) apply(settled);
      } else {
        // The write failed: the row must show the file's truth and not the amount it asked for. When the
        // re-read fails too, the file's amount is not known (the write may even have landed with its answer
        // lost), so `usd` goes back to `null` and the row says unknown. A save waiting behind this write is
        // kept and written next: one refusal says nothing about the amount typed after it.
        const truth = await readUsd();
        apply(truth);
        if (truth === null) setUsd(null);
      }
      target = pending.current;
      pending.current = null;
    }
  }, [apply]);

  const save = useCallback(async (next: number) => {
    // The row filters first; this is the one writer, so it refuses what the server would 400 rather than
    // send it.
    if (!Number.isFinite(next) || next < 0) return;
    if (writing.current !== null) {
      pending.current = next;
      await writing.current;
      return;
    }
    setSaving(true);
    const loop = writeLoop(next);
    writing.current = loop;
    await loop;
    writing.current = null;
    setSaving(false);
  }, [writeLoop]);

  return { usd, unreadable, saving, save, refresh };
}
