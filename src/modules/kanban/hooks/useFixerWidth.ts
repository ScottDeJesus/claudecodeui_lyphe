import { useCallback, useEffect, useRef, useState } from 'react';

import { api, refusalSentence } from '@/shared/api';
import { CARD_WIDTH_MAX, CARD_WIDTH_MIN } from '@/shared/constants';

/**
 * What went wrong with the number, with the server's own sentence when it sent one. unread: no read has answered, so there is no number
 * to draw. refused: a save did not land, and the number before it is drawn again.
 */
type FixerWidthProblem = { kind: 'unread' | 'refused'; sentence: string | null };

type FixerWidth = {
  /** The number the dispatcher last answered, or null while no read has. */
  saved: number | null;
  /** What the slider draws: the knob's place while it is held or its save is out, otherwise the saved number. */
  shown: number | null;
  /** True while a save is out. */
  saving: boolean;
  /** Why the last read or save did not land, or null while nothing is wrong. */
  problem: FixerWidthProblem | null;
  /** The knob moved: draw the number, write nothing. */
  move: (next: number) => void;
  /** The knob was let go: write the number, then draw what the server read back; a refusal puts the old number back and says why. */
  keep: (next: number) => Promise<void>;
  /** Ask again: the way out of a number that could not be read. */
  refresh: () => Promise<void>;
};

/** One answer of the relay: the number the file holds, or none with the server's sentence when it sent one. */
type Answer = { width: number; sentence: null } | { width: null; sentence: string | null };

/** An error envelope parses as JSON too, so only a whole number inside the dispatcher's bounds is an answer, never a default. */
function widthOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const { width } = body as { width?: unknown };
  if (typeof width !== 'number' || !Number.isInteger(width)) return null;
  return width >= CARD_WIDTH_MIN && width <= CARD_WIDTH_MAX ? width : null;
}

/** One request to the relay, judged: the number it answered, or none and the sentence the server refused with. Never throws. */
async function ask(request: () => Promise<Response>): Promise<Answer> {
  try {
    const response = await request();
    if (!response.ok) return { width: null, sentence: await refusalSentence(response) };
    const width = widthOf(await response.json());
    return width === null ? { width: null, sentence: null } : { width, sentence: null };
  } catch (error) {
    console.error('Error reaching the fixers-at-once number:', error);
    return { width: null, sentence: null };
  }
}

/** One read, handed to apply unless isStale says a save has overtaken it; outside the hook so the effect that asks sets no state itself. */
async function load(isStale: () => boolean, apply: (answer: Answer) => void): Promise<void> {
  const answer = await ask(() => api.settings.bugBoard());
  if (!isStale()) apply(answer);
}

/**
 * HOW MANY BUG FIXERS RUN AT ONCE, for the slider beside the board's switch.
 *
 * THE NUMBER IS THE DISPATCHER'S, NOT THE BOARD'S: width in ~/.claude/charters/cards.toml, one number for every board that runs itself,
 * the same one Settings > Agents draws as "cards walked at once". Both ask the same relay (GET / PUT /api/kanban-dispatch/settings, which
 * runs dispatcher card config), so the two controls can never hold different numbers for long: each draws what the file holds.
 *
 * IT IS READ WHEN THE OPENING OPENS (watching), and again when the window is come back to, because the number can have moved from
 * Settings, a terminal or a phone while the Opening stayed mounted.
 *
 * ONE FILE, SO ONE ORDER OF ANSWERS. Saves go one at a time: a release that lands while a save is out waits and is sent next, so two
 * writes never race for the file. A save retires every read asked before it.
 *
 * A REFUSED SAVE PUTS THE OLD NUMBER BACK AND SAYS WHY, in the server's own sentence, then asks the file again: a save whose answer was
 * lost may have landed.
 */
export function useFixerWidth(watching: boolean): FixerWidth {
  // The number as the dispatcher last read it off the file. State, because the slider and its figure draw it; null until a read answers.
  const [saved, setSaved] = useState<number | null>(null);
  // The knob's place while it is held or its save is out, so the slider follows the hand and not the file; null otherwise.
  const [draft, setDraft] = useState<number | null>(null);
  // Held from a save's start to its answer; the header marks the control busy from it for assistive tech.
  const [saving, setSaving] = useState(false);
  // Why the last read or save did not land; the header says it under the slider until the next read or move clears it.
  const [problem, setProblem] = useState<FixerWidthProblem | null>(null);
  /** The saved number as of the latest answer, for keep, a stable callback that cannot close over saved. */
  const savedRef = useRef<number | null>(null);
  /** Whether a save loop is running: a ref, because a release that folds into it must see it at once. */
  const writing = useRef(false);
  /** The number a release asked for while a save was out; the loop in keep sends it next. */
  const pending = useRef<number | null>(null);
  /** Bumped by every save, so a read that started before it can tell it is stale. */
  const generation = useRef(0);

  /** What a read does to the header: a number replaces the held one and clears an unread line; no number says it is unknown. */
  const apply = useCallback((answer: Answer) => {
    savedRef.current = answer.width;
    setSaved(answer.width);
    if (answer.width === null) setProblem({ kind: 'unread', sentence: answer.sentence });
    else setProblem((held) => (held?.kind === 'unread' ? null : held));
  }, []);

  const refresh = useCallback(async () => {
    if (writing.current) return;
    const asked = generation.current;
    await load(() => generation.current !== asked || writing.current, apply);
  }, [apply]);

  useEffect(() => {
    if (!watching) return undefined;
    void refresh();
    // visibilitychange beside focus because iOS Safari fires no reliable focus on an app switch.
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
  }, [watching, refresh]);

  const move = useCallback((next: number) => {
    setDraft(next);
    // Reaching for the knob again is the answer to a refusal: its line has been read.
    setProblem((held) => (held?.kind === 'refused' ? null : held));
  }, []);

  const keep = useCallback(async (next: number): Promise<void> => {
    if (savedRef.current === null) return;
    if (writing.current) {
      pending.current = next;
      setDraft(next);
      return;
    }
    if (next === savedRef.current) {
      // Let go where it was picked up: nothing to write.
      setDraft(null);
      return;
    }
    writing.current = true;
    setDraft(next);
    setSaving(true);
    setProblem(null);
    let target: number | null = next;
    let answer: Answer = { width: null, sentence: null };
    while (target !== null) {
      generation.current += 1;
      const sending: number = target;
      answer = await ask(() => api.settings.saveBugBoard({ width: sending }));
      target = pending.current;
      pending.current = null;
      // A release that asked for the number the file now holds has nothing left to write.
      if (target !== null && answer.width === target) target = null;
    }
    writing.current = false;
    setSaving(false);
    setDraft(null);
    if (answer.width !== null) {
      // What the server read back off the file, which is the number the dispatcher will count by.
      savedRef.current = answer.width;
      setSaved(answer.width);
      return;
    }
    setProblem({ kind: 'refused', sentence: answer.sentence });
    await load(() => writing.current, apply);
  }, [apply]);

  return { saved, shown: draft ?? saved, saving, problem, move, keep, refresh };
}
