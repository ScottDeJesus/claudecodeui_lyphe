import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { NoteDraftsContext, NotesContext, type NoteDraftsValue, type NotesValue } from '@/modules/notes/context/NotesContext';
import { api, errorMessage } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { Note, NoteInput } from '@/shared/types';

/** The blank card's target in the write map below. A note id is a UUID, so the word can never be one. */
const COMPOSER_TARGET = 'composer';

/** Nothing typed: the blank card's draft on mount, and again once an add has landed and been re-read. */
const BLANK_DRAFT: NoteInput = { title: '', description: '' };

/**
 * The server's own sentence out of a refusal body, or `null` when the body carried none — or was
 * not JSON at all. Two shapes arrive on this wire and `errorMessage` reads both: a route's plain
 * `error` string, and the error middleware's `{ error: { code, message } }`.
 */
async function refusalSentence(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') return null;
    const envelope = body as { error?: unknown; details?: unknown };
    return errorMessage(envelope.error) ?? errorMessage(envelope.details);
  } catch {
    return null;
  }
}

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
 * True when two drafts are the same two strings: the test that tells the draft a write SENT from a
 * newer one typed while that write was in flight.
 */
function sameDraft(a: NoteInput, b: NoteInput): boolean {
  return a.title === b.title && a.description === b.description;
}

/**
 * THE NOTES LIST'S ONE READER AND WRITER, AND THE DRAFTS THAT OUTLIVE THE PANE THEY WERE TYPED IN.
 *
 * Mounted once by App, inside the auth gate and below WebSocketProvider: `api.notes` is an
 * authenticated route and must never be asked against the login screen, and the two frames that
 * move this list — `notes_changed` and `websocket_reconnected` — arrive on the one socket above it.
 *
 * ONE LIST, TWO HOMES. The Notes tab's pane and the chat gutter's widget draw the same `NotesList`
 * over the same contexts, so a note added in either home is in both, a draft typed in one is still
 * there when the other is opened, and neither can hold a copy of the list the other cannot see.
 *
 * THE READ IS THE LIST. A write answers the note it wrote and nothing reads that body: the list on
 * screen comes from the read that follows the write — which is also why a write's busy mark stays
 * up until that read has returned, and why the draft a write sent is dropped only then — so a card
 * never shows the text it just replaced, and a newer draft typed during the flight is never eaten.
 *
 * A FRAME IS A HINT, NOT A PICTURE. `notes_changed` names no note and no account, so the answer to
 * it is always "read this account's own list again" — and reads overlap (a frame's, a write's, the
 * mount's), so each takes a ticket and answers are published in TICKET order, never arrival order.
 */
export function NotesProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { subscribe } = useWebSocket();

  // The translator of the LATEST render, read through a ref: the six verbs below keep one identity
  // for the app's life (the list memo, and every consumer memoising on these verbs, depends on it),
  // and a verb closing over `t` directly would be rebuilt on every language switch. Read at the
  // press, this speaks whatever language the app is in then.
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

  // What is typed into the blank card and not yet added. Essential: the draft outlives the pane it
  // was typed in — the tab and the gutter widget are two homes for one card — so it cannot live in
  // the form.
  const [composer, setComposer] = useState<NoteInput>(BLANK_DRAFT);

  // What is typed over a note and not yet saved, by note id. Essential: a card is in edit mode
  // exactly while it has an entry here, so the draft survives a re-render, a scroll and a switch of
  // home, and only a save, a cancel or a landed write takes the entry away.
  const [edits, setEdits] = useState<Record<string, NoteInput>>({});

  // The blank card's add is in flight. Essential: the card reads `busy` from here, from the press
  // until the re-read that follows the write has returned.
  const [adding, setAdding] = useState(false);

  // The notes with a save or a delete in flight. Essential: each card's own buttons carry their own
  // busy state, so one note's write never marks another's.
  const [writing, setWriting] = useState<Record<string, true>>({});

  // Mount flag: a read or a write that lands after this provider is gone must not set state or
  // raise a toast about a list nobody is looking at any more.
  const mountedRef = useRef(true);

  // The list as the last read left it, mirrored so `refresh` can judge an answer — and drop the
  // edits of notes it no longer holds — without depending on the state it publishes: a `refresh`
  // rebuilt on every published list would re-subscribe the socket below.
  const notesRef = useRef<Note[] | null>(null);

  // Which read this is. Reads overlap — a frame's, a write's, the mount's — so each takes a ticket.
  const newestReadRef = useRef(0);
  // The newest ticket that has ANSWERED. An older answer landing after a newer one is dropped
  // rather than published: a read that left BEFORE a write's re-read must not land after it and put
  // the pre-write list back on screen.
  const newestAnswerRef = useRef(0);

  // The write in flight per target — the blank card, or a note's id. A second press on a target
  // that is already writing answers this promise and starts no second write; the entry leaves when
  // the promise settles, which is after the re-read that follows a write that landed.
  const writesInFlightRef = useRef(new Map<string, Promise<boolean>>());

  /**
   * A good answer, applied wholesale: the list IS the answer, so it replaces what was held rather
   * than merging with it. Any edit draft whose note is absent from it has nothing left to edit —
   * the card it belonged to is gone, deleted here or in another tab — so the entry goes with it.
   */
  const apply = useCallback((next: Note[]) => {
    if (!mountedRef.current) return;
    notesRef.current = next;
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
   * ONE WRITE PER TARGET. The promise is on the map before a second press can see it, and `mark`
   * puts the busy flag up synchronously with the press — the button reads `busy` on the next
   * render — so two presses cannot become two writes.
   */
  const writeOnce = useCallback((
    target: string,
    mark: () => void,
    write: () => Promise<boolean>,
  ): Promise<boolean> => {
    const held = writesInFlightRef.current.get(target);
    if (held) return held;
    mark();
    const promise = write().finally(() => {
      writesInFlightRef.current.delete(target);
    });
    writesInFlightRef.current.set(target, promise);
    return promise;
  }, []);

  /**
   * One write, and the one place a refused write becomes a sentence. The verdict is `response.ok`
   * alone — the note in the body is not read, because the list comes from the re-read and not from
   * this answer — and a refusal's body is read for the SERVER'S OWN WORDS, which go under the
   * toast when it carried any. A write that landed says nothing here.
   */
  const sendNoteWrite = useCallback(async (request: () => Promise<Response>, titleKey: string): Promise<boolean> => {
    let sentence: string | null = null;
    try {
      const response = await request();
      if (response.ok) return true;
      sentence = await refusalSentence(response);
    } catch {
      // No answer at all — this app's own network — so there is no server sentence to carry; the
      // toast still says the write did not land.
    }
    // Raised only while this provider is still mounted: a write that failed after the app moved on
    // is nobody's to read.
    if (mountedRef.current) {
      toast({
        tone: 'warn',
        title: tRef.current(titleKey),
        ...(sentence === null ? {} : { message: sentence }),
      });
    }
    return false;
  }, [toast]);

  /** The blank card's add. The draft it sent is emptied only once its re-read has returned —
   *  whichever way that went — so the card never shows, not even for one frame, the text it just
   *  added; a draft typed while the write was in flight is newer than the write and stands. */
  const add = useCallback((draft: NoteInput): Promise<boolean> => writeOnce(
    COMPOSER_TARGET,
    () => setAdding(true),
    async () => {
      const landed = await sendNoteWrite(() => api.notes.create(draft), 'notes.toast.saveFailed');
      if (!landed) {
        setAdding(false);
        return false;
      }
      await refresh();
      // Only the draft this write SENT is cleared, and only while the composer still holds it
      // verbatim: typing that began while the write was in flight is newer than the write and must
      // not be eaten. An untouched composer is exactly the draft that was sent, so the card still
      // never shows the text it just added.
      setComposer((live) => (sameDraft(live, draft) ? BLANK_DRAFT : live));
      setAdding(false);
      return true;
    },
  ), [writeOnce, sendNoteWrite, refresh]);

  /** A note's save. The edit draft it sent is dropped only once its re-read has returned, so the
   *  form never falls back to the old text between the write and the list that replaces it; a draft
   *  typed during the flight is newer than the write and leaves the card in edit mode holding it. */
  const saveEdit = useCallback((id: string, draft: NoteInput): Promise<boolean> => writeOnce(
    id,
    () => setWriting((live) => ({ ...live, [id]: true })),
    async () => {
      const landed = await sendNoteWrite(() => api.notes.update(id, draft), 'notes.toast.saveFailed');
      if (!landed) {
        setWriting((live) => withoutKey(live, id));
        return false;
      }
      await refresh();
      // The blank card's rule, for a note's own entry: dropped only while it still holds the draft
      // this write sent, never over a newer one typed during the flight.
      setEdits((live) => {
        const entry = live[id];
        return entry !== undefined && sameDraft(entry, draft) ? withoutKey(live, id) : live;
      });
      setWriting((live) => withoutKey(live, id));
      return true;
    },
  ), [writeOnce, sendNoteWrite, refresh]);

  /** A note's delete. Its edit draft — if one is somehow open — goes with it, also once the re-read
   *  has returned: the card must not draw a form over a note the list no longer holds. */
  const remove = useCallback((id: string): Promise<boolean> => writeOnce(
    id,
    () => setWriting((live) => ({ ...live, [id]: true })),
    async () => {
      const landed = await sendNoteWrite(() => api.notes.remove(id), 'notes.toast.deleteFailed');
      if (!landed) {
        setWriting((live) => withoutKey(live, id));
        return false;
      }
      await refresh();
      setEdits((live) => withoutKey(live, id));
      setWriting((live) => withoutKey(live, id));
      return true;
    },
  ), [writeOnce, sendNoteWrite, refresh]);

  /** `null` leaves edit mode and drops what was typed; anything else stores the draft as it is. */
  const setEdit = useCallback((id: string, draft: NoteInput | null) => {
    setEdits((live) => (draft === null ? withoutKey(live, id) : { ...live, [id]: draft }));
  }, []);

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

  // Anything that reads the list re-draws when a read lands. The six verbs keep one identity, so in
  // practice only `notes` and `unreachable` ever make a new value here.
  const value = useMemo<NotesValue>(() => ({
    notes,
    unreachable,
    refresh,
    setComposer,
    setEdit,
    add,
    saveEdit,
    remove,
  }), [notes, unreachable, refresh, setComposer, setEdit, add, saveEdit, remove]);

  // A keystroke re-draws the one form that holds the draft, and nothing behind it.
  const draftsValue = useMemo<NoteDraftsValue>(() => ({
    composer,
    edits,
    adding,
    writing,
  }), [composer, edits, adding, writing]);

  return (
    <NotesContext.Provider value={value}>
      <NoteDraftsContext.Provider value={draftsValue}>{children}</NoteDraftsContext.Provider>
    </NotesContext.Provider>
  );
}
