import { createContext, useContext } from 'react';

import type { Note, NoteInput } from '@/shared/types';

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
 * The account's notes and the six verbs that read and write them. `notes` is `null` until a read
 * answers — "not asked yet", which a screen has to tell apart from an answer of nothing — and the
 * six verbs keep one identity for the app's life, so nothing that memoises on them is rebuilt by a
 * keystroke or a language switch somewhere else.
 */
export type NotesValue = {
  /** The account's notes, newest first. `null` until a read has answered. */
  notes: Note[] | null;
  /** True while no read has ever answered and the last one failed. A read that fails after a good one keeps the list it had. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  setComposer: (draft: NoteInput) => void;
  /** `null` leaves edit mode and drops what was typed. */
  setEdit: (id: string, draft: NoteInput | null) => void;
  /** Each of the three answers `true` when the write landed. On `false` it has already raised the toast. */
  add: (draft: NoteInput) => Promise<boolean>;
  saveEdit: (id: string, draft: NoteInput) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
};

/**
 * What is typed and not yet written. Separate from `NotesValue` because the two change for
 * different reasons: this one on every keystroke, the list on every read. `composer` and `edits`
 * are the drafts themselves; `adding` and `writing` are the in-flight marks the forms read as
 * `busy`.
 */
export type NoteDraftsValue = {
  /** What is typed in the blank card and not yet added. */
  composer: NoteInput;
  /** What is typed over a note and not yet saved, by note id. A card is in edit mode exactly while it has an entry. */
  edits: Record<string, NoteInput>;
  /** The blank card's add is in flight. */
  adding: boolean;
  /** The notes with a save or a delete in flight. */
  writing: Record<string, true>;
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
 * The drafts and the in-flight marks. Read by the module's own `NotesList` and `NoteCard` alone —
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
