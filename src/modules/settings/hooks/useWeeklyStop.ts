import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/**
 * The percents the Settings dropdown offers, lowest first: 50% to 95% in steps of five, then 99%. The pacer
 * honours any whole percent from 50 to 99 (`weekly_stop.percent_of`), so a line written by hand between two
 * stops is drawn as its own option rather than hidden. Used by `RunnerWeeklyStopRow`, which builds its options from it.
 */
export const WEEKLY_STOP_CHOICES: readonly number[] = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 99];

/** The bounds the pacer holds the line to (`weekly_stop.MIN` / `MAX`): the first and last of the choices. */
const WEEKLY_STOP_MIN = 50;
const WEEKLY_STOP_MAX = 99;

/**
 * The percent in a `GET` or `PUT` answer, or `null` when the body is not one.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is
 * `{success:false,error:{…}}`, which `.json()` parses happily: a body without a whole percent in range is
 * "could not ask", never a default — a dropdown that read that as 95 would draw a line for a setting that may be 80.
 */
function percentOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { percent } = body as { percent?: unknown };
  return typeof percent === 'number' && Number.isInteger(percent)
    && percent >= WEEKLY_STOP_MIN && percent <= WEEKLY_STOP_MAX ? percent : null;
}

/** The setting as the server reads it off disk, or `null` when it could not be asked. */
async function readPercent(): Promise<number | null> {
  try {
    const response = await api.settings.weeklyStop();
    if (!response.ok) return null;
    return percentOf(await response.json());
  } catch (error) {
    console.error('Error loading the weekly stop:', error);
    return null;
  }
}

/** The write, returning the percent the server read back off the file, or `null` if it failed. */
async function writePercent(next: number): Promise<number | null> {
  try {
    const response = await api.settings.saveWeeklyStop({ percent: next });
    // A refused write is not a percent either: the row must not keep the number it asked for over a
    // file that never took it.
    if (!response.ok) return null;
    return percentOf(await response.json());
  } catch (error) {
    console.error('Error saving the weekly stop:', error);
    return null;
  }
}

/**
 * One read, handed to `apply` unless `isStale` says a write has overtaken it. A function of its own,
 * outside the hook, so the mount effect asks a question of the server rather than setting state in the
 * effect body: what lands in state lands from the answer, through `apply`.
 */
async function load(isStale: () => boolean, apply: (truth: number | null) => void): Promise<void> {
  const truth = await readPercent();
  if (!isStale()) apply(truth);
}

type WeeklyStop = {
  /** The percent as the server last read it off disk, or `null` while no read has succeeded. */
  percent: number | null;
  /** True once a read has failed: the setting is unknown, which is not the same as the default. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /** Move the line. A pick while a write is in flight is folded into the next write rather than dropped. */
  setPercent: (next: number) => Promise<void>;
  /** Ask the server again — the way out of an unreadable setting. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the pacer's weekly stop in `src/`. Used by the settings module's
 * `RunnerWeeklyStopRow`, which composes it; the fetch/save/re-read/error logic lives here once.
 *
 * The percent is NOT a client preference and so is not `readUserPreference`: it is a file on this host that
 * the pacer re-reads at every picture, which is why every read here is a request to the server rather than a
 * value the browser already holds.
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS. A read issued before a write and landing after it would draw the percent
 * the file has already left, so every write retires the reads asked before it (`generation`), and a read is
 * not asked at all while a write is in flight — that write's own answer is already coming, and it is read
 * back off the file.
 */
export function useWeeklyStop(): WeeklyStop {
  // The percent as the server last read it off disk. State, because the dropdown draws it; `null` until the
  // server answers, since there is no honest percent to draw before then.
  const [percent, setPercentState] = useState<number | null>(null);
  // Set when a read comes back with nothing, so the row can say the setting is unknown rather than draw a
  // percent it does not have. Cleared by the first answer.
  const [unreadable, setUnreadable] = useState(false);
  // Held while a write is in flight; the row marks its dropdown busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  /** Whether a write loop is running -- a ref, because the picks that fold into it must see it at once. */
  const writing = useRef(false);
  /** The newest percent a pick asked for while a write was in flight; the loop in `setPercent` writes it next. */
  const pending = useRef<number | null>(null);
  /** Bumped by every write, so a read that started before it can tell it is stale. */
  const generation = useRef(0);

  /** What an answer does to the row: a percent replaces it, no answer says the setting is unknown. */
  const apply = useCallback((truth: number | null) => {
    setUnreadable(truth === null);
    if (truth !== null) setPercentState(truth);
  }, []);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const asked = generation.current;
    await load(() => generation.current !== asked || writing.current, apply);
  }, [apply]);

  useEffect(() => {
    void refresh();
    // Coming back to the page is the one moment the percent can have moved under a mounted row — the
    // operator sets it from their phone. `visibilitychange` beside `focus` because iOS Safari fires no
    // reliable blur/focus on an app switch.
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

  const setPercent = useCallback(async (next: number) => {
    if (!Number.isInteger(next) || next < WEEKLY_STOP_MIN || next > WEEKLY_STOP_MAX) return;
    // Optimistic, then corrected: the server answers with what it read back off the file.
    setPercentState(next);
    setUnreadable(false);
    if (writing.current) {
      pending.current = next;
      return;
    }
    writing.current = true;
    setSaving(true);
    let target: number | null = next;
    while (target !== null) {
      generation.current += 1;
      const settled = await writePercent(target);
      // A pick that asked for the percent the file now holds has nothing left to write.
      if (settled !== null && pending.current === settled) pending.current = null;
      if (settled !== null) {
        // The percent the file holds, unless a newer pick is already waiting to be written.
        if (pending.current === null) setPercentState(settled);
      } else {
        // The write failed: the row must show the file's truth and not the number it asked for.
        generation.current += 1;
        const truth = await readPercent();
        pending.current = null;
        setPercentState(truth);
        setUnreadable(truth === null);
      }
      target = pending.current;
      pending.current = null;
    }
    writing.current = false;
    setSaving(false);
  }, []);

  return { percent, unreadable, saving, setPercent, refresh };
}
