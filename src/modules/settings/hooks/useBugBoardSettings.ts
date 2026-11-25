import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { CARD_WIDTH_MAX, CARD_WIDTH_MIN } from '@/shared/constants';

/**
 * How many board cards the dispatcher may work at the same time: every whole number `~/.claude/charters/cards.toml` accepts for `width`, lowest
 * first. Used by `RunnerBugBoardRow`, which builds its dropdown from it.
 */
export const BUG_BOARD_WIDTH_CHOICES: readonly number[] = Array.from({ length: CARD_WIDTH_MAX - CARD_WIDTH_MIN + 1 }, (_, index) => CARD_WIDTH_MIN + index);

/** The bounds the dispatcher holds the sort's confidence to (`card_config`'s `threshold`). The row prints them over its field. */
export const BUG_BOARD_THRESHOLD_MIN = 0.5;
export const BUG_BOARD_THRESHOLD_MAX = 0.99;

/**
 * The bounds the dispatcher holds a waiting card's ageing to (`card_config`'s `age_days`): whole days, and the lowest turns ageing off.
 * Used by `RunnerBugBoardRow`, which builds its dropdown from them.
 */
export const BUG_BOARD_AGE_DAYS_MIN = 0;
export const BUG_BOARD_AGE_DAYS_MAX = 30;

/** The confidence's notation: two decimals, as a card's Sort step prints it (`0.93`), so the field and that step compare by eye. */
const THRESHOLD_DECIMALS = 2;

type BugBoardSettings = {
  /** Card walks allowed at once, as the dispatcher last answered, or `null` while no read has succeeded. */
  width: number | null;
  /** How sure a voice must be for its sort to be taken, as the dispatcher last answered, or `null` while no read has succeeded. */
  threshold: number | null;
  /**
   * How many whole days a card waits in To Do for each priority it moves up, `0` for never, as the dispatcher last answered; `null`
   * while no read has succeeded, and while the dispatcher that answered does not report the number.
   */
  ageDays: number | null;
  /** True once a read has failed: the numbers are unknown, which is not the same as their defaults. */
  unreadable: boolean;
  /** True while a write is in flight. */
  saving: boolean;
  /**
   * What the confidence field draws: the operator's own typing while a draft is open, otherwise the saved number at two decimals (`0.80`).
   * Empty while `threshold` is `null`.
   */
  thresholdText: string;
  /**
   * True from the moment the field was left on a draft that is not a number inside the bounds, until it is typed in again. The row
   * says "not saved" under the field while it holds. A blank draft is not one: it sends nothing and says nothing.
   */
  thresholdOutOfBounds: boolean;
  /** Move the number of cards walked at once. */
  setWidth: (next: number) => Promise<void>;
  /** Move the days a waiting card waits per priority; `0` turns ageing off. */
  setAgeDays: (next: number) => Promise<void>;
  /** Keep what the operator typed into the confidence field as a draft; nothing is written, and `thresholdOutOfBounds` falls. */
  typeThreshold: (text: string) => void;
  /**
   * The confidence field was left: write the draft when it is a number inside the bounds, else drop it so the field snaps back, raising
   * `thresholdOutOfBounds` unless the draft was blank.
   */
  leaveThreshold: () => void;
  /** Ask the dispatcher again: the way out of an unreadable setting. */
  refresh: () => Promise<void>;
};

/**
 * The numbers as the dispatcher reads them off the file, each inside its bounds. `ageDays` is `null` when the answer carried none: a
 * dispatcher older than the number answers the other two alone, and they are still a reading.
 */
type BugBoardReading = { width: number; threshold: number; ageDays: number | null };

/** A change to any of the three numbers; a write sends only the fields it moves. */
type BugBoardChange = { width?: number; threshold?: number; ageDays?: number };

/** An envelope like `{success:false,error:{…}}` parses as JSON too, so only a body with both numbers in range is an answer, never a default. */
function readingOf(body: unknown): BugBoardReading | null {
  if (typeof body !== 'object' || body === null) return null;
  const { width, threshold, ageDays } = body as { width?: unknown; threshold?: unknown; ageDays?: unknown };
  if (typeof width !== 'number' || !BUG_BOARD_WIDTH_CHOICES.includes(width)) return null;
  // `NaN` passes both range checks below, so finiteness is its own test.
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null;
  if (threshold < BUG_BOARD_THRESHOLD_MIN || threshold > BUG_BOARD_THRESHOLD_MAX) return null;
  // The third number is read apart: none, or one that is no whole number of days inside its bounds, is "not reported", never a
  // default and never a reason to drop the two numbers beside it.
  const reported = typeof ageDays === 'number' && Number.isInteger(ageDays) && ageDays >= BUG_BOARD_AGE_DAYS_MIN && ageDays <= BUG_BOARD_AGE_DAYS_MAX;
  return { width, threshold, ageDays: reported ? ageDays : null };
}

/** The settings as the server reads them off disk, or `null` when they could not be asked. */
async function readSettings(): Promise<BugBoardReading | null> {
  try {
    const response = await api.settings.bugBoard();
    if (!response.ok) return null;
    return readingOf(await response.json());
  } catch (error) {
    console.error('Error loading the bug board settings:', error);
    return null;
  }
}

/** The write, returning what the server read back off the file, or `null` if it failed. */
async function writeSettings(change: BugBoardChange): Promise<BugBoardReading | null> {
  try {
    const response = await api.settings.saveBugBoard(change);
    // A refused write is not a reading either: the rows must not keep the value it asked for over a file that never took it.
    if (!response.ok) return null;
    return readingOf(await response.json());
  } catch (error) {
    console.error('Error saving the bug board settings:', error);
    return null;
  }
}

/** One read, handed to `apply` unless `isStale` says a write has overtaken it; outside the hook so the mount effect sets no state itself. */
async function load(isStale: () => boolean, apply: (truth: BugBoardReading | null) => void): Promise<void> {
  const truth = await readSettings();
  if (!isStale()) apply(truth);
}

/**
 * The one reader and writer of the dispatcher's three card numbers in `src/`: how many board cards it works at once, how sure the sort
 * must be, and how many days a waiting card waits per priority it moves up. Used by the settings module's `RunnerBugBoardRow`, which composes it.
 *
 * The numbers are NOT client preferences: they are `~/.claude/charters/cards.toml`, which the dispatcher reads at every take-up and every
 * sort, so every read here is a request to the server (`GET` / `PUT /api/kanban-dispatch/settings`, which relay `dispatcher card config`).
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS, as `useCpuLimit` keeps it: every write retires the reads asked before it (`generation`), and a read is not
 * asked at all while a write is in flight — that write's own answer is already coming, and it is read back off the file. A pick made during a
 * write is folded into the next write (`pending`), field by field, so a width and a threshold that leave together are both written.
 */
export function useBugBoardSettings(): BugBoardSettings {
  // The two numbers as the dispatcher last read them off disk. State, because the rows draw them; `null` until a read answers.
  const [reading, setReading] = useState<BugBoardReading | null>(null);
  // Set when a read comes back with nothing, so the rows say the numbers are unknown rather than draw defaults the file may not hold.
  const [unreadable, setUnreadable] = useState(false);
  // Held from a write's start to its answer; the rows mark themselves busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  // The operator's typing in the confidence field, or `null` while no draft is open. State, because the field draws it.
  const [draft, setDraft] = useState<string | null>(null);
  // Raised when the field is left on a draft outside the bounds; the row says "not saved" until the field is typed in again.
  const [thresholdOutOfBounds, setThresholdOutOfBounds] = useState(false);
  /** Whether a write loop is running -- a ref, because the picks that fold into it must see it at once. */
  const writing = useRef(false);
  /** The change a pick asked for while a write was in flight; the loop in `write` sends it next. */
  const pending = useRef<BugBoardChange | null>(null);
  /** Bumped by every write, so a read that started before it can tell it is stale. */
  const generation = useRef(0);
  /** The draft as of the latest keystroke, for `leaveThreshold`, a stable callback that cannot close over `draft`. */
  const draftRef = useRef<string | null>(null);

  /** What an answer does to the rows: a reading replaces them, no answer says the numbers are unknown. A read never touches the draft. */
  const apply = useCallback((truth: BugBoardReading | null) => {
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
    // Coming back to the page is the one moment the numbers can have moved under a mounted row — the operator sets them from their phone.
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

  const write = useCallback(async (change: BugBoardChange): Promise<void> => {
    // Optimistic, then corrected: the server answers with what it read back off the file.
    setReading((held) => (held === null ? held : { ...held, ...change }));
    setUnreadable(false);
    if (writing.current) {
      // Merged field by field, so a width pick and a threshold that leave during one write are both written.
      pending.current = { ...pending.current, ...change };
      return;
    }
    writing.current = true;
    setSaving(true);
    let target: BugBoardChange | null = change;
    while (target !== null) {
      generation.current += 1;
      const settled = await writeSettings(target);
      if (settled !== null) {
        // The numbers the file holds, unless a newer pick is already waiting to be written.
        if (pending.current === null) setReading(settled);
      } else {
        // The write failed: the rows must show the file's truth and not the values it asked for.
        generation.current += 1;
        const truth = await readSettings();
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

  const setWidth = useCallback(async (next: number) => {
    if (!BUG_BOARD_WIDTH_CHOICES.includes(next)) return;
    await write({ width: next });
  }, [write]);

  const setAgeDays = useCallback(async (next: number) => {
    if (!Number.isInteger(next) || next < BUG_BOARD_AGE_DAYS_MIN || next > BUG_BOARD_AGE_DAYS_MAX) return;
    await write({ ageDays: next });
  }, [write]);

  const typeThreshold = useCallback((text: string) => {
    draftRef.current = text;
    setDraft(text);
    setThresholdOutOfBounds(false);
  }, []);

  const leaveThreshold = useCallback(() => {
    const text = draftRef.current;
    if (text === null) return;
    // A blank draft is no answer at all: it sends nothing and says nothing.
    if (text.trim() === '') {
      draftRef.current = null;
      setDraft(null);
      return;
    }
    const typed = Number(text);
    if (!Number.isFinite(typed) || typed < BUG_BOARD_THRESHOLD_MIN || typed > BUG_BOARD_THRESHOLD_MAX) {
      draftRef.current = null;
      setDraft(null);
      setThresholdOutOfBounds(true);
      return;
    }
    const sent = Math.round(typed * 10 ** THRESHOLD_DECIMALS) / 10 ** THRESHOLD_DECIMALS;
    // The draft goes once the write answers, and only if it still holds the text sent: typing made meanwhile stays.
    void write({ threshold: sent }).then(() => {
      if (draftRef.current === text) {
        draftRef.current = null;
        setDraft(null);
      }
    });
  }, [write]);

  const thresholdText = draft ?? (reading === null ? '' : reading.threshold.toFixed(THRESHOLD_DECIMALS));

  return {
    width: reading === null ? null : reading.width,
    threshold: reading === null ? null : reading.threshold,
    ageDays: reading === null ? null : reading.ageDays,
    unreadable,
    saving,
    thresholdText,
    thresholdOutOfBounds,
    setWidth,
    setAgeDays,
    typeThreshold,
    leaveThreshold,
    refresh,
  };
}
