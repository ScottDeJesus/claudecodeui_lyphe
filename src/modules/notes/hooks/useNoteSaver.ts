import { useEffect, useLayoutEffect, useMemo } from 'react';

import { COMPOSER_TARGET } from '@/modules/notes/context/NotesContext';
import { api, attemptWrite } from '@/shared/api';
import type { Note, NoteInput, NoteSaveOutcome, NoteSaveStatus } from '@/shared/types';

/**
 * THE NOTES' AUTOSAVE: one writer per open card, each saving what is typed in it so nobody has to
 * press anything.
 *
 * A LANE IS ONE CARD'S WRITER. The blank card has one (`COMPOSER_TARGET`) and every note open for
 * editing has one (its id). A lane keeps the newest typed text, the text the server is known to hold,
 * a quiet-period timer and at most one request in flight.
 *
 * WHEN IT SAVES. About a second after typing stops (`AUTOSAVE_DELAY_MS`), and at once when the owner
 * asks (`flush`): a card left, Done, or a tab or the widget going away. Every request is sent with
 * `keepalive` while the body fits the browser's keepalive budget, so a save on the way out of a page
 * survives the page.
 *
 * THE PAGE GOING AWAY (`leave`) cannot wait for an answer. A lane with nothing in the air sends its
 * newest text at once; a lane with a save already in the air has the loop's NEXT request ahead of it,
 * and that request is sent only after the answer — which a closing page may never see — so the newest
 * text is sent beside the one in flight. A note's id is known, so that is one more update of it; a
 * blank card whose first save is still in flight has no id yet, and what was typed after that save
 * left cannot be sent (a second create would make a second note).
 *
 * ORDER. A lane sends one request at a time and re-reads its newest text when each one lands, looping
 * until what the server holds is what is typed. Typing during a flight therefore costs one more save
 * after it, carrying the newest text — an older text never lands last, because there is never a second
 * request in the air to overtake the first. Callers that `flush` while a flight is up are handed that
 * same flight, which already includes their text — the one exception is the page going away, above.
 *
 * A CLEAN CARD FOLLOWS THE SERVER. A lane remembers the `updatedAt` its note had when the card opened
 * or when its own last save answered. A re-read that brings a NEWER `updatedAt` for a lane with nothing
 * typed and nothing in the air (`rebase`) means another device saved the note since, so the card takes
 * that text rather than keep an old base and overwrite the other device with its next keystroke. A card
 * with typing in it is never touched: the person's text wins, as it always did.
 *
 * WHAT IT NEVER DOES: it never writes text back into a card (the card shows what was typed, not what the
 * server answered, so a re-read or a landed save cannot move the caret or eat a letter), never sends a
 * title that draws as nothing (the last saved version stands, and the card says a title is needed), and
 * never raises more than one toast per run of failures (the next landed save lets it speak again).
 *
 * The blank card's first save is a create; the answer names the note, the lane is bound to it from then
 * on (`onBound`), and every later save is an update of that note. If that note is deleted elsewhere
 * (the update answers 404 `NOTE_NOT_FOUND`) the card is the typist's still, so the lane lets go of the
 * dead id (`onBound(target, null)`) and the next save creates a new note from the text.
 *
 * Used by `NotesProvider`, which owns the drafts and the list; the hook holds no React state of its own,
 * so a save landing redraws only what the provider chooses to redraw.
 */

/** How long typing must pause before the card saves itself. The operator's own number: about a second. */
const AUTOSAVE_DELAY_MS = 1000;

/**
 * The most a `keepalive` request's body may carry here. Browsers cap the bytes of keepalive requests in
 * flight at 64 KiB, and a request over the cap is refused outright; a note this long is saved the
 * ordinary way, which only means it does not outlive a closing page.
 */
const KEEPALIVE_BODY_MAX_BYTES = 60_000;

/**
 * The characters that DRAW AS NOTHING, the mirror of `notes.service.ts`'s own: whitespace (`\s`),
 * format characters — U+200B ZERO WIDTH SPACE and its family, which `\s` misses — and control
 * characters. The service refuses a title that is only these; this writer will not send one.
 *
 * The two classes are one decision written twice — the client build cannot import from `server/`.
 * Change one and change the other.
 */
const DRAWS_AS_NOTHING = /[\s\p{Cf}\p{Cc}]/gu;

type Lane = {
  /** The note this lane writes to; `null` until the blank card's first save creates one. */
  noteId: string | null;
  /** The text the server is known to hold, as it was typed; `null` before the first save. */
  saved: NoteInput | null;
  /**
   * The `updatedAt` the note had when the card opened or its own last save answered; `null` before
   * the first save and when an answer did not carry it. A re-read with a newer one is another writer's.
   */
  baseUpdatedAt: string | null;
  /** The newest typed text. */
  latest: NoteInput;
  /** The text the request now in the air carries, or `null` while none is. */
  sending: NoteInput | null;
  /** The text `leave` last sent beside a request in the air, so a page's two leaving events send it once. */
  leftWith: NoteInput | null;
  /** True for the blank card's lane: its text outlives the note it was saved as (see `onBound`). */
  recreatesWhenGone: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** The running drain, or `null` while the lane is idle. */
  flight: Promise<NoteSaveOutcome> | null;
  /** A failure has raised its toast and no save has landed since, so the next failure stays quiet. */
  complained: boolean;
  /** The card is gone; a drain that finds this stops writing for it. */
  closed: boolean;
};

/** What the saver tells the provider, which owns the state a card draws. Read fresh on every use. */
type NoteSaverDeps = {
  /** A lane's quiet line: what to say, or `null` to say nothing. */
  setStatus: (target: string, status: NoteSaveStatus | null) => void;
  /** The lane is now bound to this note (the blank card's first save landed), or to none (`null`: its note was deleted elsewhere). */
  onBound: (target: string, noteId: string | null) => void;
  /** A create is in the air for the lane (`true`) or has ended, landed or not (`false`). */
  onCreating: (target: string, creating: boolean) => void;
  /** Re-reads the list, resolving once the answer is on screen. */
  refresh: () => Promise<void>;
  /** A save did not land; `sentence` is the server's own words, or `null` when it sent none. */
  onFailure: (sentence: string | null) => void;
};

/** The verbs the provider and its cards call. Their identities never change. */
type NoteSaver = {
  /** Hands the saver the provider's callbacks of the latest render. */
  bind: (deps: NoteSaverDeps) => void;
  /** Starts a lane over a note opened for editing, holding its text and `updatedAt` as they stand. */
  open: (target: string, noteId: string, text: NoteInput, updatedAt: string) => void;
  /** Takes the newest typed text of a card and schedules its save. */
  type: (target: string, draft: NoteInput) => void;
  /** Saves now and answers how it ended. A lane with nothing to send answers `saved`. */
  flush: (target: string) => Promise<NoteSaveOutcome>;
  /** The page is going away: every lane's newest text is sent now, beside a save already in the air. Not awaited. */
  leave: () => void;
  /**
   * A re-read brought `note`. When the lane `target` writes to it, holds nothing typed and has nothing
   * in the air, and the note is NEWER than the lane's base, the lane takes the note's text and answers
   * it for the card to show; otherwise `null` and nothing changes.
   */
  rebase: (target: string, note: Note) => NoteInput | null;
  /** True when what is typed is what the server holds (or there is no lane). */
  isClean: (target: string) => boolean;
  /** True once the lane writes to a note — an edit always is; the blank card is after its first save. */
  isBound: (target: string) => boolean;
  /** Ends a lane: its timer is cleared and a drain in flight stops writing. */
  close: (target: string) => void;
  /** Ends every lane except the blank card's and the listed ids' — the cards that are no longer open. */
  retain: (openIds: string[]) => void;
  /** Ends every lane, on the provider's unmount. */
  dispose: () => void;
};

const sameText = (a: NoteInput, b: NoteInput | null): boolean =>
  b !== null && a.title === b.title && a.description === b.description;

const drawsSomething = (text: string): boolean => text.replace(DRAWS_AS_NOTHING, '') !== '';

const keepaliveOptions = (draft: NoteInput) =>
  new Blob([JSON.stringify(draft)]).size <= KEEPALIVE_BODY_MAX_BYTES ? { keepalive: true } : undefined;

/** The id and `updatedAt` a landed save answered with; each `null` when the body does not carry it. */
async function readSavedNote(response: Response): Promise<{ id: string | null; updatedAt: string | null }> {
  try {
    const body = (await response.json()) as { data?: { id?: unknown; updatedAt?: unknown } };
    return {
      id: typeof body.data?.id === 'string' ? body.data.id : null,
      updatedAt: typeof body.data?.updatedAt === 'string' ? body.data.updatedAt : null,
    };
  } catch {
    return { id: null, updatedAt: null };
  }
}

/**
 * What a lane with unsaved text says: it is saving, unless no title is there to save under. A blank
 * card with nothing in it says nothing; words with no title, or a saved note whose title was cleared,
 * say a title is needed.
 */
function pendingStatus(lane: Lane): NoteSaveStatus | null {
  if (drawsSomething(lane.latest.title)) return 'saving';
  const nothingTyped = lane.noteId === null && !drawsSomething(lane.latest.description);
  return nothingTyped ? null : 'titleNeeded';
}

function newLane(noteId: string | null, text: NoteInput | null, updatedAt: string | null, recreatesWhenGone: boolean): Lane {
  return {
    noteId,
    saved: text,
    baseUpdatedAt: updatedAt,
    latest: text ?? { title: '', description: '' },
    sending: null,
    leftWith: null,
    recreatesWhenGone,
    timer: null,
    flight: null,
    complained: false,
    closed: false,
  };
}

/** How one save ended: landed (the note's id and the `updatedAt` it answered), the note gone, or not landed. */
type WriteResult = { kind: 'landed'; noteId: string; updatedAt: string | null } | { kind: 'gone' } | { kind: 'failed' };

/** The 404 `NOTE_NOT_FOUND` the service answers an update of a note that no longer exists. */
const NOTE_GONE_CODE = 'NOTE_NOT_FOUND';

/** One save, create or update. */
async function writeDraft(lane: Lane, draft: NoteInput, deps: NoteSaverDeps): Promise<WriteResult> {
  const noteId = lane.noteId;
  const options = keepaliveOptions(draft);
  const attempt = await attemptWrite(() =>
    noteId === null ? api.notes.create(draft, options) : api.notes.update(noteId, draft, options),
  );

  if (!attempt.landed) {
    // The blank card's note was deleted on another device. What is typed in the card is still the
    // typist's, so the card is saved again as a new note — no failure, no toast — instead of failing on
    // a note that is gone for as long as the card stays open.
    if (noteId !== null && lane.recreatesWhenGone && attempt.code === NOTE_GONE_CODE) return { kind: 'gone' };
    if (!lane.complained) {
      lane.complained = true;
      deps.onFailure(attempt.sentence);
    }
    return { kind: 'failed' };
  }

  lane.complained = false;
  const saved = await readSavedNote(attempt.response);
  if (noteId !== null) return { kind: 'landed', noteId, updatedAt: saved.updatedAt };

  // A create that landed but did not say which note it made cannot be retried — the retry would make
  // a second one — so it is reported as a failure, and the text stays in the card.
  if (saved.id === null) {
    deps.onFailure(null);
    return { kind: 'failed' };
  }
  return { kind: 'landed', noteId: saved.id, updatedAt: saved.updatedAt };
}

/**
 * Runs until what the server holds is what is typed, then re-reads the list once (the list on screen
 * comes from a read, never from a save's answer) and says `Saved`.
 */
async function drain(target: string, lane: Lane, deps: NoteSaverDeps): Promise<NoteSaveOutcome> {
  let wrote = false;
  // Written since the list was last re-read.
  let unread = false;

  for (;;) {
    if (lane.closed) return 'saved';

    const draft = lane.latest;
    if (!sameText(draft, lane.saved)) {
      if (!drawsSomething(draft.title)) {
        if (unread) await deps.refresh();
        deps.setStatus(target, pendingStatus(lane));
        return 'blocked';
      }

      deps.setStatus(target, 'saving');
      const creating = lane.noteId === null;
      if (creating) deps.onCreating(target, true);
      lane.sending = draft;
      const result = await writeDraft(lane, draft, deps);
      lane.sending = null;
      if (creating) deps.onCreating(target, false);

      if (result.kind === 'gone') {
        // Let go of the dead id; the next turn of the loop creates a new note from the same text.
        lane.noteId = null;
        lane.saved = null;
        lane.baseUpdatedAt = null;
        deps.onBound(target, null);
        continue;
      }
      if (result.kind === 'failed') {
        if (unread) void deps.refresh();
        deps.setStatus(target, null);
        return 'failed';
      }

      lane.saved = draft;
      lane.baseUpdatedAt = result.updatedAt;
      wrote = true;
      unread = true;
      if (lane.noteId === null) {
        lane.noteId = result.noteId;
        deps.onBound(target, result.noteId);
      }
      continue;
    }

    if (unread) {
      unread = false;
      await deps.refresh();
      continue;
    }

    if (wrote) deps.setStatus(target, 'saved');
    return 'saved';
  }
}

function createNoteSaver(): NoteSaver {
  const lanes = new Map<string, Lane>();

  // The provider's callbacks of the latest render, bound by `bind` in a layout effect — before any
  // keystroke, timer or event can reach a verb below.
  let bound: NoteSaverDeps | null = null;
  const readDeps = (): NoteSaverDeps => {
    if (bound === null) throw new Error('The notes saver was used before its provider bound it.');
    return bound;
  };

  const clearTimer = (lane: Lane) => {
    if (lane.timer !== null) clearTimeout(lane.timer);
    lane.timer = null;
  };

  const close = (target: string) => {
    const lane = lanes.get(target);
    if (!lane) return;
    lane.closed = true;
    clearTimer(lane);
    lanes.delete(target);
  };

  const flush = (target: string): Promise<NoteSaveOutcome> => {
    const lane = lanes.get(target);
    if (!lane) return Promise.resolve('saved');
    clearTimer(lane);
    // A drain already up will read the newest text before it ends, so this caller waits on it.
    if (lane.flight) return lane.flight;
    const flight = drain(target, lane, readDeps()).finally(() => {
      lane.flight = null;
    });
    lane.flight = flight;
    return flight;
  };

  return {
    bind(deps) {
      bound = deps;
    },

    open(target, noteId, text, updatedAt) {
      close(target);
      lanes.set(target, newLane(noteId, text, updatedAt, false));
    },

    type(target, draft) {
      // The blank card's lane is made by its first keystroke; a note's is made by opening it, so a
      // late keystroke into a card that has since closed finds nothing and is dropped.
      let lane = lanes.get(target);
      if (!lane && target === COMPOSER_TARGET) {
        lane = newLane(null, null, null, true);
        lanes.set(target, lane);
      }
      if (!lane) return;

      lane.latest = draft;
      clearTimer(lane);
      if (sameText(draft, lane.saved)) {
        // Typed back to what the server holds: nothing is owed.
        readDeps().setStatus(target, lane.flight ? 'saving' : null);
        return;
      }
      readDeps().setStatus(target, pendingStatus(lane));
      lane.timer = setTimeout(() => {
        lane.timer = null;
        void flush(target);
      }, AUTOSAVE_DELAY_MS);
    },

    flush,

    leave() {
      for (const [target, lane] of [...lanes]) {
        // Nothing in the air: the ordinary flush starts its request before this call returns.
        if (lane.flight === null) {
          void flush(target);
          continue;
        }
        // A save is in the air and the loop's next request would go out only after its answer, which a
        // closing page may never see: send the newest text beside it. Only a note's own lane can — the
        // id is known — and only text the request in the air does not already carry.
        const newest = lane.latest;
        const noteId = lane.noteId;
        if (noteId === null || !drawsSomething(newest.title)) continue;
        if (sameText(newest, lane.sending) || sameText(newest, lane.saved) || sameText(newest, lane.leftWith)) continue;
        lane.leftWith = newest;
        void attemptWrite(() => api.notes.update(noteId, newest, keepaliveOptions(newest)));
      }
    },

    rebase(target, note) {
      const lane = lanes.get(target);
      if (!lane || lane.noteId !== note.id || lane.flight !== null || lane.timer !== null) return null;
      if (lane.baseUpdatedAt === null || !sameText(lane.latest, lane.saved)) return null;
      // Both are ISO-8601 UTC with milliseconds, so the strings order as times; an older answer (a read
      // that left before this card's own save) is never another writer's.
      if (note.updatedAt <= lane.baseUpdatedAt) return null;
      const text = { title: note.title, description: note.description };
      lane.latest = text;
      lane.saved = text;
      lane.baseUpdatedAt = note.updatedAt;
      readDeps().setStatus(target, null);
      return text;
    },

    isClean(target) {
      const lane = lanes.get(target);
      return !lane || sameText(lane.latest, lane.saved);
    },

    isBound(target) {
      return typeof lanes.get(target)?.noteId === 'string';
    },

    close,

    retain(openIds) {
      const keep = new Set([COMPOSER_TARGET, ...openIds]);
      for (const target of [...lanes.keys()]) {
        if (!keep.has(target)) close(target);
      }
    },

    dispose() {
      for (const target of [...lanes.keys()]) close(target);
    },
  };
}

/**
 * The notes' autosave for one provider: the verbs of `NoteSaver`, with identities that never change,
 * reading the provider's latest callbacks at each use. Called once by `NotesProvider`.
 */
export function useNoteSaver(deps: NoteSaverDeps): NoteSaver {
  const saver = useMemo(() => createNoteSaver(), []);
  // The callbacks of the LATEST render, so the verbs never close over a stale `refresh`. Bound in a
  // layout effect: before any event or timer can call a verb, and never while rendering.
  useLayoutEffect(() => {
    saver.bind(deps);
  });
  useEffect(() => () => saver.dispose(), [saver]);
  return saver;
}
