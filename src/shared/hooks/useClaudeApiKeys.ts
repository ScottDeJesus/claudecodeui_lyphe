import { useCallback, useEffect, useState } from 'react';

import { api, errorMessage } from '@/shared/api';
import type { ClaudeApiCardView, ClaudeApiKeySave, ClaudeApiPicture, ClaudeApiUnreadable } from '@/shared/types';

/**
 * THE CLAUDE API KEYS CARD'S READ AND ITS THREE ACTS — the door's picture
 * (`~/.claude/claudecodeui_lyphe`'s Settings API relays `claude-api status --json`), the slot a
 * write is in flight on, and `save`/`remove`/`refresh`. A refused save's words are the pressing
 * surface's own state, never the module's: they die with the surface and are not redrawn on a remount.
 *
 * THE PICTURE IS NOT A CLIENT PREFERENCE. It is two files and a ledger in another process's
 * world, and a key's standing moves while Settings is closed: a wall lands at the next launch, a
 * spend-down window opens at its hour. So every read here is a question to the server, asked again
 * whenever the page regains focus — and no timer is kept, because nothing here knows a wall's hour.
 *
 * UNREADABLE IS NOT "NOT SET". A failed read answers `{unreadable: true}`, which the card draws as
 * unknown in words and with no form: fields over settings the card cannot see are how a reader
 * overwrites a credit or a label they never meant to touch (INV-8936).
 *
 * ONE QUESTION AT A TIME, ONE CLOCK. A read issued before a write and landing after it would draw
 * the store the write had already left, so every write retires the reads that predate it through
 * one module-level epoch, exactly as the park-at-peak switch's hook does. A save that lands is
 * answered by the fresh picture the server read back, never by what was sent. A page return fires
 * `focus` and `visibilitychange` together — one 600 ms window merges the pair, and no timer is kept.
 *
 * Used by `ClaudeApiKeysContent`.
 */

type KeysState = Pick<ClaudeApiCardView, 'picture' | 'savingSlot'>;
/** One row's error line: the door's words or the failure sentence, and its slot. */
type RefusalLine = NonNullable<ClaudeApiCardView['refusal']>;
type SaveOutcome = { saved: boolean; refusal: RefusalLine | null };

/** A write that never got an answer, and a press that raced another write, each say so in words. */
const FAILED_WORDS = 'The save failed before the door answered, so whether the key was stored is unknown. The field was kept and the store was re-read.';
const DROPPED_WORDS = 'Another key write is already on the wire, so this press was not sent. Try again when it finishes.';
/** `focus` and `visibilitychange` are one return to the page; inside this window they are one ask. */
const PAGE_ASK_WINDOW_MS = 600;

/** Every surface showing the keys right now; a second is told the same answer, not a copy. */
const readers = new Set<(state: KeysState) => void>();

/** The last state delivered, drawn at once by a surface that mounts while a question is out. */
let known: KeysState = { picture: null, savingSlot: null };

/** How many authoritative states have been established: bumped as a write is ISSUED and when a
 * read's answer is published. */
let epoch = 0;

/** A read is out; two questions to one store cannot say anything the first will not. */
let inFlight = false;
/** Another ask arrived while that read was out; the newer one, asked for real once it lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;
/** When the page last asked on its own (a return to the tab), to merge the pair it fires. */
let lastPageAsk = 0;

/** Hand the state to every surface on screen. */
function publish(next: KeysState): void {
  known = next;
  for (const reader of readers) reader(known);
}

/** Publish a read's answer, and retire every question asked before it existed. */
function announce(picture: ClaudeApiPicture | ClaudeApiUnreadable): void {
  epoch += 1;
  waiting = false;
  publish({ ...known, picture });
}

/**
 * Whether a body is the door's picture. A malformed body, or the API's own error envelope
 * (`{success:false,error:{…}}`, which `.json()` parses happily), is a read FAILURE: a body without
 * the picture's fields must never be drawn as an empty store.
 */
function isPicture(value: unknown): value is ClaudeApiPicture {
  if (typeof value !== 'object' || value === null) return false;
  const picture = value as {
    rides?: unknown;
    keys?: unknown;
    pace_usd_per_hour?: unknown;
    unpriced?: unknown;
    checked_at?: unknown;
  };
  return typeof picture.rides === 'object' && picture.rides !== null
    && Array.isArray(picture.keys)
    && typeof picture.pace_usd_per_hour === 'number'
    && Array.isArray(picture.unpriced)
    && typeof picture.checked_at === 'number';
}

/** The server's own read-failure answer, relayed: unknown, in words, never an empty store. */
function isUnreadable(value: unknown): value is ClaudeApiUnreadable {
  return typeof value === 'object' && value !== null
    && (value as { unreadable?: unknown }).unreadable === true;
}

/** One answer body as the picture — or `null` when it is neither the picture nor the unknown
 * answer, which is a failure the caller words itself. */
async function pictureOf(response: Response): Promise<ClaudeApiPicture | ClaudeApiUnreadable | null> {
  try {
    const body: unknown = await response.json();
    if (isPicture(body)) return body;
    return isUnreadable(body) ? { unreadable: true } : null;
  } catch {
    return null;
  }
}

/** Ask for the door's picture. Never throws: every failure is the unknown answer. */
async function readPicture(): Promise<ClaudeApiPicture | ClaudeApiUnreadable> {
  try {
    const response = await api.settings.claudeApi();
    if (!response.ok) return { unreadable: true };
    return (await pictureOf(response)) ?? { unreadable: true };
  } catch (error) {
    console.error('Error loading the Claude API keys:', error);
    return { unreadable: true };
  }
}

/** The door's own sentence out of an error envelope, or the sentence the caller named. */
async function refusalWords(response: Response, fallback = 'The claude-api door refused this save.'): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object') {
      return errorMessage((body as { error?: unknown }).error) ?? fallback;
    }
  } catch {
    // A body that is not JSON carries no words; the fallback is the one sentence left.
  }
  return fallback;
}

/** Ask the server what the store says, and hand the answer to every surface. */
async function ask(): Promise<void> {
  if (inFlight) {
    waiting = true;
    return;
  }

  inFlight = true;
  do {
    waiting = false;
    // The clock as it stood when this question was put: an answer is worth drawing only if no
    // authoritative state has been established since.
    const at = epoch;
    const picture = await readPicture();
    // Silence is the answer here: a question put before a write has no business drawing the store
    // the write is leaving, and an answer also holds back while a newer question is queued.
    if (at === epoch && !waiting) announce(picture);
  } while (waiting);

  inFlight = false;
}

/** Mark a write as issued: the slot busy, older reads dead. */
function beginWrite(slot: number): void {
  writing = true;
  epoch += 1;
  publish({ ...known, savingSlot: slot });
}

/** A write is over; the rows stop drawing busy. */
function endWrite(): void {
  writing = false;
  publish({ ...known, savingSlot: null });
}

/** Save one slot. True only on SAVED; a failure hands back the line to draw under that row's field. */
async function saveKey(slot: number, body: ClaudeApiKeySave): Promise<SaveOutcome> {
  // Dropped rather than queued, module-wide: the store is one store, and the card disables every
  // row's press while a write is out — the guard's sentence is for a press that still races it.
  if (writing) return { saved: false, refusal: { slot, words: DROPPED_WORDS } };
  beginWrite(slot);

  let outcome: SaveOutcome = { saved: false, refusal: null };
  try {
    const response = await api.settings.saveClaudeApiKey(slot, body);
    if (response.ok) {
      // The server answers the fresh picture, never the body: what lands on screen is what the
      // door read back. A 200 IS SAVED even when that fresh read failed, so the field still clears.
      const fresh = await pictureOf(response);
      if (fresh !== null) {
        announce(fresh);
        outcome = { saved: true, refusal: null };
      } else {
        announce(await readPicture());
      }
    } else if (response.status === 422) {
      // The door refused before it wrote anything: its sentence goes under the field, and the
      // picture the card already holds is still what the store says.
      outcome = { saved: false, refusal: { slot, words: await refusalWords(response) } };
    } else {
      // A failed write may still have landed (the door writes the slot before it lifts the walls),
      // so the answer is a re-read — and the press says it failed, or a redraw reads as ignored.
      outcome = { saved: false, refusal: { slot, words: await refusalWords(response, FAILED_WORDS) } };
      announce(await readPicture());
    }
  } catch (error) {
    console.error('Error saving a Claude API key:', error);
    outcome = { saved: false, refusal: { slot, words: FAILED_WORDS } };
    announce(await readPicture());
  }

  endWrite();
  return outcome;
}

/** Remove one slot and answer the fresh picture; a failed removal re-reads the store. */
async function removeKey(slot: number): Promise<void> {
  if (writing) return;
  beginWrite(slot);

  try {
    const response = await api.settings.removeClaudeApiKey(slot);
    const fresh = response.ok ? await pictureOf(response) : null;
    announce(fresh ?? await readPicture());
  } catch (error) {
    console.error('Error removing a Claude API key:', error);
    announce(await readPicture());
  }

  endWrite();
}

/**
 * The one reader and writer of the Claude API key store in `src/`. The settings card composes it,
 * and any later surface showing who pays for a plan run composes the same hook, so either can
 * write, both draw the same answer, and the fetch/save/re-read/refusal logic exists once.
 */
export function useClaudeApiKeys(): ClaudeApiCardView {
  // The door's state as the server last answered it: `null` is a read on the wire, and
  // `{unreadable:true}` is a read that failed. Never "not set" — that is a picture with `set:false`.
  const [state, setState] = useState<KeysState>(known);
  // This surface's refusal line: it dies with the surface and with the next press.
  const [refusal, setRefusal] = useState<RefusalLine | null>(null);

  useEffect(() => {
    let live = true;
    const reader = (next: KeysState) => {
      if (live) setState(next);
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered, so a surface opening while a question
    // is already out does not sit on a picture older than the one the module holds.
    reader(known);
    void ask();

    // Coming back is the one moment a key's standing can move under a mounted card; skipped while a
    // write is in flight, whose own answer is already on its way. `visibilitychange` sits beside
    // `focus` because iOS Safari fires no reliable blur/focus on an app switch — one return, merged.
    const onFocus = () => {
      if (writing) return;
      // The second read of a focus/visibility burst answers nothing the first cannot, and the
      // timestamp is not a timer: nothing fires because time passed, only because the page returned.
      const now = Date.now();
      if (now - lastPageAsk < PAGE_ASK_WINDOW_MS) return;
      lastPageAsk = now;
      void ask();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      live = false;
      // Dropped, so an answer arriving after this surface is gone cannot land on the run that
      // replaced it. The ask itself is deliberately NOT cancelled: the question was put to the
      // server, and `ask` still owes its answer to every reader still on screen.
      readers.delete(reader);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    await ask();
  }, []);

  const save = useCallback(async (slot: number, body: ClaudeApiKeySave): Promise<boolean> => {
    // A new press retires the last sentence, whatever this one answers.
    setRefusal(null);
    const outcome = await saveKey(slot, body);
    if (outcome.refusal !== null) setRefusal(outcome.refusal);
    return outcome.saved;
  }, []);

  const remove = useCallback(async (slot: number) => {
    setRefusal(null);
    await removeKey(slot);
  }, []);

  return { ...state, refusal, save, remove, refresh };
}
