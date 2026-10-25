import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  COMPOSER_TARGET,
  NoteDraftsContext,
  NotesContext,
  type NoteDraftsValue,
  type NotesValue,
} from '@/modules/notes/context/NotesContext';
import { useNoteSaver } from '@/modules/notes/hooks/useNoteSaver';
import { api, attemptWrite } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Note, NoteInput, NoteSaveStatus } from '@/shared/types';

/** Nothing typed: the blank card's draft on mount, and again once the card has let go of the note it became. */
const BLANK_DRAFT: NoteInput = { title: '', description: '' };

/**
 * One record without one key — and the SAME object when the key was not there, so clearing a mark
 * or a draft that is already gone redraws nothing.
 */
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * THE NOTES LIST'S ONE READER, AND THE DRAFTS THAT OUTLIVE THE PANE THEY WERE TYPED IN.
 *
 * Mounted once by App, inside the auth gate and below WebSocketProvider: `api.notes` is an
 * authenticated route and must never be asked against the login screen, and the two frames that
 * move this list — `notes_changed` and `websocket_reconnected` — arrive on the one socket above it.
 *
 * ONE LIST, TWO HOMES. The Notes tab's pane and the chat gutter's widget draw the same `NotesList`
 * over the same contexts, so a note added in either home is in both, a draft typed in one is still
 * there when the other is opened, and neither can hold a copy of the list the other cannot see.
 *
 * NOTHING TYPED IS EVER LOST, AND NOTHING IS PRESSED TO SAVE. Every keystroke into the blank card or
 * an open note is kept here as a draft and handed to the autosave (`useNoteSaver`), which writes it
 * about a second after typing stops and at once when the card is left; this provider owns the state
 * the autosave reports into — the quiet `Saving…` / `Saved` lines, and the note the blank card became.
 *
 * THE BLANK CARD BECOMES THE NOTE. Its first save is a create, and the answer names the note
 * (`composerNoteId`): from then on the very same card — text, focus and caret untouched — is that
 * note's, and the list leaves the note out of its wall until the card lets go of it
 * (`finishComposer`), when a fresh blank card takes the place. While the create's answer is still on
 * its way the card does not know the id yet, so the wall hides every note that was not there when the
 * create left (`createBaseline`) — the server's own frame can bring the new note back before the answer.
 *
 * THE READ IS THE LIST. A write answers the note it wrote and nothing draws from that body: the list on
 * screen comes from the read that follows the write, and an open card draws its draft, never the
 * server's answer — so a card never shows the text it just replaced, a landed save or a re-read
 * cannot move the caret or eat a letter, and a card is closed only after the read that carries its
 * text has returned.
 *
 * A FRAME IS A HINT, NOT A PICTURE. `notes_changed` names no note and no account, so the answer to
 * it is always "read this account's own list again" — and reads overlap (a frame's, a write's, the
 * mount's), so each takes a ticket and answers are published in TICKET order, never arrival order.
 * A read never touches a card with typing in it: that card is neither overwritten nor closed. A card
 * with NOTHING typed since it opened or last saved follows the server instead (`rebaseCleanCards`): a
 * note another device saved shows its new text, so the next keystroke here does not write the old one
 * back over it.
 */
export function NotesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { subscribe } = useWebSocket();

  // The translator of the LATEST render, read through a ref: the verbs below keep one identity
  // for the app's life (the list memo, and every consumer memoising on these verbs, depends on it),
  // and a verb closing over `t` directly would be rebuilt on every language switch. Read at the
  // failure, this speaks whatever language the app is in then.
  const tRef = useRef(t);
  useLayoutEffect(() => {
    tRef.current = t;
  }, [t]);

  // The last list a read applied, or `null` until one answers. Essential rather than derived: it is
  // the only copy of the account's notes between reads, and `null` ("never read") has to look
  // different on screen from an answer of nothing.
  const [notes, setNotes] = useState<Note[] | null>(null);

  // True while NO read has ever answered and the last one failed. Essential: it is what turns the
  // spinner into the unreachable box with its Try again; a failed read after a good one keeps the
  // list on screen, so this never turns true over one.
  const [unreachable, setUnreachable] = useState(false);

  // What is typed into the blank card. Essential: the draft outlives the pane it was typed in — the
  // tab and the gutter widget are two homes for one card — so it cannot live in the form. It is
  // never replaced by what the server answered: the card keeps the typist's own text.
  const [composer, setComposer] = useState<NoteInput>(BLANK_DRAFT);

  // The note the blank card has become, or `null`. Essential: it is what keeps that note out of the
  // wall while its card is still being typed in, and what shows the card's Done. Set when the first
  // save lands, cleared when the card lets go of the note.
  const [composerNoteId, setComposerNoteId] = useState<string | null>(null);

  // The ids the wall held when the blank card's create left, while that create is in the air; `null`
  // otherwise. Essential: the card learns its note's id only from the create's answer, and the server's
  // frame can bring the note into the list first — this is what lets the wall hide it until then.
  const [createBaseline, setCreateBaseline] = useState<ReadonlySet<string> | null>(null);

  // What is typed over a note, by note id. Essential: a card is in edit mode exactly while it has an
  // entry here, so the draft survives a re-render, a scroll and a switch of home, and only Done (or a
  // re-read that finds the note gone) takes the entry away.
  const [edits, setEdits] = useState<Record<string, NoteInput>>({});

  // The notes with a delete in flight. Essential: the delete dialog's own button carries the busy
  // state, so one note's delete never marks another's.
  const [writing, setWriting] = useState<Record<string, true>>({});

  // Each card's quiet saving line, by `COMPOSER_TARGET` or note id. Essential: the autosave runs
  // outside React and this is the only way its `Saving…` / `Saved` / title-needed reaches a card;
  // a card with no entry says nothing.
  const [saveStates, setSaveStates] = useState<Record<string, NoteSaveStatus>>({});

  // Mount flag: a read or a write that lands after this provider is gone must not set state or
  // raise a toast about a list nobody is looking at any more.
  const mountedRef = useRef(true);

  // The list as the last read left it, mirrored so `refresh` can judge an answer without depending
  // on the state it publishes: a `refresh` rebuilt on every published list would re-subscribe the
  // socket below.
  const notesRef = useRef<Note[] | null>(null);

  // Which read this is. Reads overlap — a frame's, a write's, the mount's — so each takes a ticket.
  const newestReadRef = useRef(0);
  // The newest ticket that has ANSWERED. An older answer landing after a newer one is dropped
  // rather than published: a read that left BEFORE a write's re-read must not land after it and put
  // the pre-write list back on screen.
  const newestAnswerRef = useRef(0);

  // `rebaseCleanCards` of the latest render, so `apply` (built before the saver exists) can call it. Only
  // read inside `apply`, never while rendering.
  const rebaseRef = useRef<(next: Note[]) => void>(() => {});

  // The delete in flight per note id. A second press on a note that is already being deleted answers
  // this promise and starts no second delete; the entry leaves when the promise settles, which is
  // after the re-read that follows a delete that landed.
  const deletesInFlightRef = useRef(new Map<string, Promise<boolean>>());

  /**
   * A good answer, applied wholesale: the list IS the answer, so it replaces what was held rather
   * than merging with it. Any edit draft whose note is absent from it has nothing left to edit —
   * the card it belonged to is gone, deleted here or in another tab — so the entry goes with it.
   * A card with typing in it, and the blank card, are left exactly as typed; a card with none follows
   * the list (`rebaseCleanCards`).
   */
  const apply = useCallback((next: Note[]) => {
    if (!mountedRef.current) return;
    notesRef.current = next;
    rebaseRef.current(next);
    setNotes(next);
    setUnreachable(false);
    setEdits((live) => {
      const ids = new Set(next.map((note) => note.id));
      const kept = Object.entries(live).filter(([id]) => ids.has(id));
      return kept.length === Object.keys(live).length ? live : Object.fromEntries(kept);
    });
  }, []);

  /**
   * The list, re-read. The answer is published in ticket order, and only a good answer — a 200
   * whose `data` is an array — replaces the list; anything else, or a throw, leaves it as it was
   * and says "could not be read" only while there is no list yet.
   */
  const refresh = useCallback(async () => {
    const ticket = ++newestReadRef.current;
    let answer: Note[] | null = null;
    try {
      const response = await api.notes.list();
      if (response.ok) {
        const body = (await response.json()) as { data?: unknown };
        if (Array.isArray(body.data)) answer = body.data as Note[];
      }
    } catch {
      // A throw here is this app's own network, or a body that is not JSON — the same "no answer"
      // a refusal leaves behind.
    }
    // A reading, but not the newest one applied: something newer is already on screen, and the
    // list must not go backwards.
    if (ticket < newestAnswerRef.current) return;
    newestAnswerRef.current = ticket;
    if (answer === null) {
      // The last good reading is worth more than a box about this minute's network, so only a list
      // that has never been answered says it could not be read. The next frame, or Try again,
      // reads again.
      if (mountedRef.current && notesRef.current === null) setUnreachable(true);
      return;
    }
    apply(answer);
  }, [apply]);

  /**
   * The one place a refused write becomes a sentence: a warning toast titled in the app's language,
   * with the SERVER'S OWN WORDS under it when it sent any. Raised only while this provider is still
   * mounted — a write that failed after the app moved on is nobody's to read.
   */
  const raiseFailure = useCallback((titleKey: string, sentence: string | null) => {
    if (!mountedRef.current) return;
    toast({
      tone: 'warn',
      title: tRef.current(titleKey),
      ...(sentence === null ? {} : { message: sentence }),
    });
  }, [toast]);

  // The saver's three reports. None depends on a draft, so the writer's verbs keep one identity.
  const setStatus = useCallback((target: string, status: NoteSaveStatus | null) => {
    if (!mountedRef.current) return;
    setSaveStates((live) => {
      if (status === null) return withoutKey(live, target);
      return live[target] === status ? live : { ...live, [target]: status };
    });
  }, []);

  const onBound = useCallback((target: string, noteId: string | null) => {
    if (mountedRef.current && target === COMPOSER_TARGET) setComposerNoteId(noteId);
  }, []);

  // A create leaves: remember which notes the wall holds, so the new one is not drawn beside the card
  // that is making it. The create ends (landed, failed or lost): the memory goes — a landed one has
  // `composerNoteId` by then, in the same batch.
  const onCreating = useCallback((target: string, creating: boolean) => {
    if (!mountedRef.current || target !== COMPOSER_TARGET) return;
    setCreateBaseline(creating ? new Set((notesRef.current ?? []).map((note) => note.id)) : null);
  }, []);

  // One toast per run of failures: the saver stays quiet until a save has landed again.
  const onFailure = useCallback(
    (sentence: string | null) => raiseFailure('notes.toast.saveFailed', sentence),
    [raiseFailure],
  );

  const saver = useNoteSaver({ setStatus, onBound, onCreating, refresh, onFailure });

  /**
   * A re-read has landed: every card with nothing typed in it takes the text of a note another writer
   * saved since (`saver.rebase`), whether it is an open note's card or the blank card's own note.
   * The saver decides; this only puts the answers where the cards draw from.
   */
  const rebaseCleanCards = useCallback((next: Note[]) => {
    const rebased: Record<string, NoteInput> = {};
    let composerText: NoteInput | null = null;
    for (const note of next) {
      const text = saver.rebase(note.id, note);
      if (text !== null) rebased[note.id] = text;
      const typed = saver.rebase(COMPOSER_TARGET, note);
      if (typed !== null) composerText = typed;
    }
    if (Object.keys(rebased).length > 0) {
      setEdits((live) => {
        const out = { ...live };
        for (const [id, text] of Object.entries(rebased)) if (id in out) out[id] = text;
        return out;
      });
    }
    if (composerText !== null) setComposer(composerText);
  }, [saver]);
  useLayoutEffect(() => {
    rebaseRef.current = rebaseCleanCards;
  }, [rebaseCleanCards]);

  /** The blank card's typing: kept as the draft, and handed to the autosave. */
  const changeComposer = useCallback((draft: NoteInput) => {
    setComposer(draft);
    saver.type(COMPOSER_TARGET, draft);
  }, [saver]);

  /** Opens a note for editing over its text as it stands; the autosave holds that text, and the note's `updatedAt`, as what the server has. */
  const openEdit = useCallback((note: Note) => {
    const text: NoteInput = { title: note.title, description: note.description };
    saver.open(note.id, note.id, text, note.updatedAt);
    setEdits((live) => ({ ...live, [note.id]: text }));
  }, [saver]);

  /** An open note's typing. A keystroke that arrives after the card closed finds no entry and is dropped. */
  const changeEdit = useCallback((id: string, draft: NoteInput) => {
    setEdits((live) => (id in live ? { ...live, [id]: draft } : live));
    saver.type(id, draft);
  }, [saver]);

  const saveComposerNow = useCallback(async () => {
    await saver.flush(COMPOSER_TARGET);
  }, [saver]);

  const saveEditNow = useCallback(async (id: string) => {
    await saver.flush(id);
  }, [saver]);

  const finishComposer = useCallback(async (): Promise<boolean> => {
    const outcome = await saver.flush(COMPOSER_TARGET);
    // Let go only of a note that exists and whose newest text is saved: nothing typed, no title, a save
    // that did not land, and typing that began during the save all leave the card exactly as it is.
    if (outcome !== 'saved' || !saver.isBound(COMPOSER_TARGET) || !saver.isClean(COMPOSER_TARGET)) return false;
    saver.close(COMPOSER_TARGET);
    setComposer(BLANK_DRAFT);
    setComposerNoteId(null);
    setSaveStates((live) => withoutKey(live, COMPOSER_TARGET));
    return true;
  }, [saver]);

  const finishEdit = useCallback(async (id: string): Promise<boolean> => {
    const outcome = await saver.flush(id);
    // Closed only when everything typed is saved. A save that did not land, typing that began during
    // it, and a title that draws as nothing (`blocked`: the last saved version stands and nothing under
    // the empty title can be sent) all leave the card open with what was typed, as the blank card does.
    if (outcome !== 'saved' || !saver.isClean(id)) return false;
    saver.close(id);
    setEdits((live) => withoutKey(live, id));
    setSaveStates((live) => withoutKey(live, id));
    return true;
  }, [saver]);

  /**
   * A note's delete: one at a time per note, with its busy mark up from the press until the re-read
   * that follows has returned. The card's autosave is ended first, so a write never chases a note
   * that is going. A failed delete raises the toast and leaves the note and its dialog alone.
   */
  const remove = useCallback((id: string): Promise<boolean> => {
    const held = deletesInFlightRef.current.get(id);
    if (held) return held;
    setWriting((live) => ({ ...live, [id]: true }));
    saver.close(id);
    const promise = (async () => {
      const attempt = await attemptWrite(() => api.notes.remove(id));
      if (!attempt.landed) {
        raiseFailure('notes.toast.deleteFailed', attempt.sentence);
        setWriting((live) => withoutKey(live, id));
        return false;
      }
      await refresh();
      setEdits((live) => withoutKey(live, id));
      setSaveStates((live) => withoutKey(live, id));
      setWriting((live) => withoutKey(live, id));
      return true;
    })().finally(() => {
      deletesInFlightRef.current.delete(id);
    });
    deletesInFlightRef.current.set(id, promise);
    return promise;
  }, [saver, raiseFailure, refresh]);

  // A lane lives exactly while its card is open: when an entry leaves `edits` — Done, a delete, or a
  // re-read that found the note gone — its writer ends with it.
  useEffect(() => {
    saver.retain(Object.keys(edits));
  }, [saver, edits]);

  useEffect(() => {
    mountedRef.current = true;
    // Subscribed BEFORE the first read: a `notes_changed` frame that lands between the two must
    // start its own read rather than be missed, and the tickets above keep the order honest.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'notes_changed' || event.kind === 'websocket_reconnected') void refresh();
    });
    void refresh();
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh, subscribe]);

  // THE PAGE GOING AWAY. A phone switching apps hides the page and a closing tab or a navigation hides
  // it too; either way whatever is typed and unsaved is sent now, with `keepalive`, so the request
  // outlives the page — including text typed while an earlier save was still in the air
  // (`saver.leave`). `pagehide` is the one that fires on a real unload; `visibilitychange` is the one a
  // phone sends when it backgrounds the page and may never unload it.
  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') saver.leave();
    };
    const flushWhenLeaving = () => saver.leave();
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushWhenLeaving);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushWhenLeaving);
    };
  }, [saver]);

  // Anything that reads the list re-draws when a read lands. The verbs keep one identity, so in
  // practice only `notes` and `unreachable` ever make a new value here.
  const value = useMemo<NotesValue>(() => ({
    notes,
    unreachable,
    refresh,
    changeComposer,
    openEdit,
    changeEdit,
    saveComposerNow,
    saveEditNow,
    finishComposer,
    finishEdit,
    remove,
  }), [notes, unreachable, refresh, changeComposer, openEdit, changeEdit, saveComposerNow, saveEditNow, finishComposer, finishEdit, remove]);

  // A keystroke re-draws the one form that holds the draft, and nothing behind it.
  const draftsValue = useMemo<NoteDraftsValue>(() => ({
    composer,
    composerNoteId,
    createBaseline,
    edits,
    writing,
    saveStates,
  }), [composer, composerNoteId, createBaseline, edits, writing, saveStates]);

  return (
    <NotesContext.Provider value={value}>
      <NoteDraftsContext.Provider value={draftsValue}>{children}</NoteDraftsContext.Provider>
    </NotesContext.Provider>
  );
}
