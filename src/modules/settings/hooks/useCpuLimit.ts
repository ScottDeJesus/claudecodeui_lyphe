import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/**
 * The runner's CPU limit as the row holds it: a whole percent of the box's cores (`1`..`100`), or `'off'` when the operator turned the
 * check off. Never `null` — `null` is the HOOK's word for "not read yet", which is not the default and not off.
 */
export type CpuLimitChoice = number | 'off';

/** The line and the box it is a share of, as the server read them off the file. */
type CpuLimitReading = { limit: CpuLimitChoice; cores: number };

/**
 * The percents the Settings dropdown offers, lowest first. The runner honours any whole percent from 1 to 100 (`cpu_limit.percent_of`), so a
 * line written by hand between two stops is drawn as its own option rather than hidden. Used by `RunnerCpuLimitRow`, which builds its options from it.
 */
export const CPU_LIMIT_CHOICES: readonly number[] = [5, 10, 25, 50, 75, 100];

/** The bounds the runner holds the line to (`cpu_limit.MIN` / `MAX`). */
const CPU_LIMIT_MIN = 1;
const CPU_LIMIT_MAX = 100;

/**
 * The line in a `GET` or `PUT` answer, or `null` when the body is not one.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is `{success:false,error:{…}}`, which `.json()` parses happily:
 * a body without a `percent` key, or with a number outside the range, is "could not ask", never a default — a dropdown that read that as 100
 * would draw a line for a setting that may be off. A `percent` of `null` IS an answer: it is the file's word `off`.
 */
function readingOf(body: unknown): CpuLimitReading | null {
  if (typeof body !== 'object' || body === null) return null;
  const { percent, cores } = body as { percent?: unknown; cores?: unknown };
  if (typeof cores !== 'number' || !Number.isInteger(cores) || cores < 1) return null;
  if (percent === null) return { limit: 'off', cores };
  if (typeof percent !== 'number' || !Number.isInteger(percent) || percent < CPU_LIMIT_MIN || percent > CPU_LIMIT_MAX) return null;
  return { limit: percent, cores };
}

/** The setting as the server reads it off disk, or `null` when it could not be asked. */
async function readLimit(): Promise<CpuLimitReading | null> {
  try {
    const response = await api.settings.cpuLimit();
    if (!response.ok) return null;
    return readingOf(await response.json());
  } catch (error) {
    console.error('Error loading the CPU limit:', error);
    return null;
  }
}

/** The write, returning what the server read back off the file, or `null` if it failed. */
async function writeLimit(next: CpuLimitChoice): Promise<CpuLimitReading | null> {
  try {
    const response = await api.settings.saveCpuLimit({ percent: next === 'off' ? null : next });
    // A refused write is not a reading either: the row must not keep the value it asked for over a file that never took it.
    if (!response.ok) return null;
    return readingOf(await response.json());
  } catch (error) {
    console.error('Error saving the CPU limit:', error);
    return null;
  }
}

/**
 * One read, handed to `apply` unless `isStale` says a write has overtaken it. A function of its own, outside the hook, so the mount effect asks a
 * question of the server rather than setting state in the effect body: what lands in state lands from the answer, through `apply`.
 */
async function load(isStale: () => boolean, apply: (truth: CpuLimitReading | null) => void): Promise<void> {
  const truth = await readLimit();
  if (!isStale()) apply(truth);
}

type CpuLimit = {
  /** The line as the server last read it off disk, or `null` while no read has succeeded. */
  limit: CpuLimitChoice | null;
  /** How many cores the line is a share of on this box, or `null` while no read has succeeded. */
  cores: number | null;
  /** True once a read has failed: the setting is unknown, which is not the same as the default or off. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /** Move the line. A pick while a write is in flight is folded into the next write rather than dropped. */
  setLimit: (next: CpuLimitChoice) => Promise<void>;
  /** Ask the server again — the way out of an unreadable setting. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the runner's CPU limit in `src/`. Used by the settings module's `RunnerCpuLimitRow`, which composes it; the
 * fetch/save/re-read/error logic lives here once.
 *
 * The line is NOT a client preference and so is not `readUserPreference`: it is a file on this host that every agent the runner starts re-reads,
 * which is why every read here is a request to the server rather than a value the browser already holds.
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS, as `useWeeklyStop` keeps it: every write retires the reads asked before it (`generation`), and a read is not
 * asked at all while a write is in flight — that write's own answer is already coming, and it is read back off the file.
 */
export function useCpuLimit(): CpuLimit {
  // The line and the box as the server last read them off disk. State, because the dropdown draws them; `null` until the server answers,
  // since there is no honest line to draw before then.
  const [reading, setReading] = useState<CpuLimitReading | null>(null);
  // Set when a read comes back with nothing, so the row can say the setting is unknown rather than draw a line it does not have. Cleared by the first answer.
  const [unreadable, setUnreadable] = useState(false);
  // Held while a write is in flight; the row marks its dropdown busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  /** Whether a write loop is running -- a ref, because the picks that fold into it must see it at once. */
  const writing = useRef(false);
  /** The newest line a pick asked for while a write was in flight; the loop in `setLimit` writes it next. */
  const pending = useRef<CpuLimitChoice | null>(null);
  /** Bumped by every write, so a read that started before it can tell it is stale. */
  const generation = useRef(0);

  /** What an answer does to the row: a reading replaces it, no answer says the setting is unknown. */
  const apply = useCallback((truth: CpuLimitReading | null) => {
    setUnreadable(truth === null);
    if (truth !== null) setReading(truth);
  }, []);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const asked = generation.current;
    await load(() => generation.current !== asked || writing.current, apply);
  }, [apply]);

  useEffect(() => {
    void refresh();
    // Coming back to the page is the one moment the line can have moved under a mounted row — the operator sets it from their phone.
    // `visibilitychange` beside `focus` because iOS Safari fires no reliable blur/focus on an app switch.
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

  const setLimit = useCallback(async (next: CpuLimitChoice) => {
    const valid = next === 'off' || (Number.isInteger(next) && next >= CPU_LIMIT_MIN && next <= CPU_LIMIT_MAX);
    if (!valid) return;
    // Optimistic, then corrected: the server answers with what it read back off the file. The box's core count is the server's, so it is kept as it was.
    setReading((held) => (held === null ? held : { ...held, limit: next }));
    setUnreadable(false);
    if (writing.current) {
      pending.current = next;
      return;
    }
    writing.current = true;
    setSaving(true);
    let target: CpuLimitChoice | null = next;
    while (target !== null) {
      generation.current += 1;
      const settled = await writeLimit(target);
      // A pick that asked for the line the file now holds has nothing left to write.
      if (settled !== null && pending.current === settled.limit) pending.current = null;
      if (settled !== null) {
        // The line the file holds, unless a newer pick is already waiting to be written.
        if (pending.current === null) setReading(settled);
      } else {
        // The write failed: the row must show the file's truth and not the value it asked for.
        generation.current += 1;
        const truth = await readLimit();
        pending.current = null;
        setReading(truth);
        setUnreadable(truth === null);
      }
      target = pending.current;
      pending.current = null;
    }
    writing.current = false;
    setSaving(false);
  }, []);

  return {
    limit: reading === null ? null : reading.limit,
    cores: reading === null ? null : reading.cores,
    unreadable,
    saving,
    setLimit,
    refresh,
  };
}
