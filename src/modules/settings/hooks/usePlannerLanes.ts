import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';

/**
 * The floor the dial is held to, mirrored from the dispatcher's own (`planner_lanes.MIN`): a lane of
 * zero takes nothing up, which is a pause and not a width. There is no ceiling above it — the number
 * the operator sets is the number the file holds. Used by `RunnerPlannerLanesRow`, whose stepper
 * stops at it.
 */
export const PLANNER_LANES_MIN = 1;

/**
 * The width in a `GET` or `PUT` answer, or `null` when the body is not one.
 *
 * The API's own envelope for a restart, a proxy's 502 or an expired token's 401 is
 * `{success:false,error:{…}}`, which `.json()` parses happily: a body without a whole number of at
 * least one is "could not ask", never a default — a stepper that read that as the default would draw
 * two lanes for a dial that may be nine.
 */
function lanesOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { lanes } = body as { lanes?: unknown };
  return typeof lanes === 'number' && Number.isInteger(lanes) && lanes >= PLANNER_LANES_MIN ? lanes : null;
}

/** The dial as the server reads it off disk, or `null` when it could not be asked. */
async function readLanes(): Promise<number | null> {
  try {
    const response = await api.settings.plannerLanes();
    if (!response.ok) return null;
    return lanesOf(await response.json());
  } catch (error) {
    console.error('Error loading the planner lanes:', error);
    return null;
  }
}

/** The write, returning the width the server read back off the file, or `null` if it failed. */
async function writeLanes(next: number): Promise<number | null> {
  try {
    const response = await api.settings.savePlannerLanes({ lanes: next });
    // A refused write is not a width either: the row must not keep the number it asked for over a
    // file that never took it.
    if (!response.ok) return null;
    return lanesOf(await response.json());
  } catch (error) {
    console.error('Error saving the planner lanes:', error);
    return null;
  }
}

/**
 * One read, handed to `apply` unless `isStale` says a write has overtaken it. A function of its own,
 * outside the hook, so the mount effect asks a question of the server rather than setting state in the
 * effect body: what lands in state lands from the answer, through `apply`.
 */
async function load(isStale: () => boolean, apply: (truth: number | null) => void): Promise<void> {
  const truth = await readLanes();
  if (!isStale()) apply(truth);
}

type PlannerLanes = {
  /** The width as the server last read it off disk, or `null` while no read has succeeded. */
  lanes: number | null;
  /** True once a read has failed: the width is unknown, which is not the same as the default. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /** Move the dial. A press while a write is in flight is folded into the next one rather than
   * dropped, so two quick taps of `+` are two lanes. */
  setLanes: (next: number) => Promise<void>;
  /** Ask the server again — the way out of an unreadable dial, and the only press a stepper with no
   * width can honour. */
  refresh: () => Promise<void>;
};

/**
 * The one reader and writer of the dispatcher's planner-lane dial in `src/`. Used by the settings
 * module's `RunnerPlannerLanesRow`, which composes it; the fetch/save/re-read/error logic lives here
 * once.
 *
 * The width is NOT a client preference and so is not `readUserPreference`: it is a file on this host
 * that the dispatcher's daemon re-reads at every planner take-up, which is why every read here is a
 * request to the server rather than a value the browser already holds. The Runner tab's readout
 * (`PlannerLanesReadout`) does not use this hook: it draws the dispatcher's own frame, which states
 * the width beside how many planners are out against it.
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS. A read issued before a write and landing after it would draw the
 * width the file has already left, so every write retires the reads asked before it (`generation`),
 * and a read is not asked at all while a write is in flight — that write's own answer is already
 * coming, and it is read back off the file.
 */
export function usePlannerLanes(): PlannerLanes {
  // The width as the server last read it off disk. State, because the stepper draws it; `null` until
  // the server answers, since there is no honest width to draw before then and `null` is what keeps
  // the stepper from flickering through a wrong one.
  const [lanes, setLanesState] = useState<number | null>(null);
  // Set when a read comes back with nothing, so the row can say the dial is unknown rather than draw
  // a width it does not have. Cleared by the first answer.
  const [unreadable, setUnreadable] = useState(false);
  // Held while a write is in flight; the row marks its stepper busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  /** Whether a write loop is running -- a ref, because the presses that fold into it must see it at once. */
  const writing = useRef(false);
  /** The newest width a press asked for while a write was in flight; the loop in `setLanes` writes it next. */
  const pending = useRef<number | null>(null);
  /** Bumped by every write, so a read that started before it can tell it is stale. */
  const generation = useRef(0);

  /** What an answer does to the row: a width replaces it, no answer says the dial is unknown. */
  const apply = useCallback((truth: number | null) => {
    setUnreadable(truth === null);
    if (truth !== null) setLanesState(truth);
  }, []);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const asked = generation.current;
    await load(() => generation.current !== asked || writing.current, apply);
  }, [apply]);

  useEffect(() => {
    void refresh();
    // Coming back to the page is the one moment the width can have moved under a mounted row — the
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

  const setLanes = useCallback(async (next: number) => {
    if (!Number.isFinite(next)) return;
    const wanted = Math.max(PLANNER_LANES_MIN, Math.trunc(next));
    // Optimistic, then corrected: the server answers with what it read back off the file.
    setLanesState(wanted);
    setUnreadable(false);
    if (writing.current) {
      pending.current = wanted;
      return;
    }
    writing.current = true;
    setSaving(true);
    let target: number | null = wanted;
    while (target !== null) {
      generation.current += 1;
      const settled = await writeLanes(target);
      // A press that asked for the width the file now holds (`+` then `-` inside one write) has
      // nothing left to write.
      if (settled !== null && pending.current === settled) pending.current = null;
      if (settled !== null) {
        // The width the file holds, unless a newer press is already waiting to be written.
        if (pending.current === null) setLanesState(settled);
      } else {
        // The write failed: the row must show the file's truth and not the number it asked for.
        generation.current += 1;
        const truth = await readLanes();
        pending.current = null;
        setLanesState(truth);
        setUnreadable(truth === null);
      }
      target = pending.current;
      pending.current = null;
    }
    writing.current = false;
    setSaving(false);
  }, []);

  return { lanes, unreadable, saving, setLanes, refresh };
}
