import { createContext, useContext } from 'react';

import type { Note, NoteInput, NoteSaveStatus } from '@/shared/types';

/**
 * The two values the notes module publishes, and the two readers that guard them. No component
 * lives here: the provider is its own file so this one can be imported by anything that only reads
 * (`react(only-export-components)` would warn about a hook exported beside the provider).
 *
 * SPLIT IN TWO ON PURPOSE, because the two change at different rates: the list changes when a read
 * lands, and every card draws from it again; a draft changes on a keystroke, and only the form
 * holding it redraws — so a letter typed into the blank card never re-renders the wall behind it.
 *
 * `null` on purpose, not a filled-in default: a default object makes the readers' guards
 * unreachable and lets a consumer mounted outside the provider read a list nobody reads for
 * (`MemoryIntakeContext.tsx` is the shape being kept).
 */

/**
 * The blank card's target in the autosave's lane map. A note id is a UUID, so the word can never be
 * one. Read by the provider and the saver, and by the list for the blank card's quiet line.
 */
export const COMPOSER_TARGET = 'composer';

/**
 * The account's notes and the verbs that read, type into and write them. `notes` is `null` until a read
 * answers — "not asked yet", which a screen has to tell apart from an answer of nothing — and the
 * verbs keep one identity for the app's life, so nothing that memoises on them is rebuilt by a
 * keystroke or a language switch somewhere else.
 *
 * THERE IS NO SAVE VERB A PERSON CALLS. A card saves itself about a second after typing stops
 * (`changeComposer`, `changeEdit`), and the verbs named `...Now` and `finish...` are what a card's
 * leaving calls: focus moving off it, Done, its tab or widget going away.
 */
export type NotesValue = {
  /** The account's notes, newest first. `null` until a read has answered. */
  notes: Note[] | null;
  /** True while no read has ever answered and the last one failed. A read that fails after a good one keeps the list it had. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  /** The blank card's typing: kept, and saved as a new note once it has a title and typing pauses. */
  changeComposer: (draft: NoteInput) => void;
  /** Opens a note for editing over its text as it stands. */
  openEdit: (note: Note) => void;
  /** An open note's typing: kept, and saved about a second after it stops. */
  changeEdit: (id: string, draft: NoteInput) => void;
  /** Saves what is typed in the blank card now, leaving it as it is. */
  saveComposerNow: () => Promise<void>;
  /** Saves what is typed in an open note now, leaving it open. */
  saveEditNow: (id: string) => Promise<void>;
  /**
   * The blank card is left (Done, Enter, focus moving off, its tab or widget going away): it saves
   * now, and once it holds a saved note the card lets go of it — a fresh blank card takes its place
   * and the note is one of the wall's own. Answers `true` when it let go, `false` when it did not
   * (nothing typed, no title, or the save did not land — the draft stays).
   */
  finishComposer: () => Promise<boolean>;
  /**
   * Done on an open note: it saves now and closes. Answers `true` when it closed. It closes only once
   * everything typed is saved: a save that did not land, and a title that draws as nothing (nothing can
   * be sent under it, and the card's quiet line says a title is needed), leave it open with its text.
   */
  finishEdit: (id: string) => Promise<boolean>;
  /** Answers `true` when the delete landed. On `false` it has already raised the toast. */
  remove: (id: string) => Promise<boolean>;
};

/**
 * What is typed and not yet written, and what each card says about its saving. Separate from
 * `NotesValue` because the two change for different reasons: this one on every keystroke, the list on
 * every read. `composer` and `edits` are the drafts themselves; `writing` marks the deletes in flight.
 */
export type NoteDraftsValue = {
  /** What is typed in the blank card. */
  composer: NoteInput;
  /**
   * The note the blank card has become, once its first save landed — it stays that note's card, its
   * text and caret untouched, until it is left. `null` while the card is still blank or unsaved.
   */
  composerNoteId: string | null;
  /**
   * The ids of the notes the wall held when the blank card's first save left, while that save's answer
   * is still on its way; `null` otherwise. The wall hides any note outside it, because the new note can
   * reach the list (through the server's frame) before the answer names it.
   */
  createBaseline: ReadonlySet<string> | null;
  /** What is typed over a note, by note id. A card is in edit mode exactly while it has an entry. */
  edits: Record<string, NoteInput>;
  /** The notes with a delete in flight. */
  writing: Record<string, true>;
  /** Each card's quiet saving line, by `COMPOSER_TARGET` or note id. A card with no entry says nothing. */
  saveStates: Record<string, NoteSaveStatus>;
};

export const NotesContext = createContext<NotesValue | null>(null);

export const NoteDraftsContext = createContext<NoteDraftsValue | null>(null);

/**
 * The list and its verbs. Read by the module's own `NotesList`, `NoteCard` and `NotesPanel`, and —
 * through the module's barrel — by `src/modules/chat-gutters`, which draws the widget's count.
 */
export function useNotes(): NotesValue {
  const value = useContext(NotesContext);
  if (!value) {
    throw new Error('useNotes must be used within a NotesProvider');
  }
  return value;
}

/**
 * The drafts and the saving lines. Read by the module's own `NotesList` and `NoteCard` alone —
 * the two homes draw the same list, so both need what is typed into it, and no screen outside the
 * module ever does.
 */
export function useNoteDrafts(): NoteDraftsValue {
  const value = useContext(NoteDraftsContext);
  if (!value) {
    throw new Error('useNoteDrafts must be used within a NotesProvider');
  }
  return value;
}
