import { PlugZapIcon, StickyNoteIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNoteDrafts, useNotes } from '@/modules/notes/context/NotesContext';
import { NoteCard } from '@/modules/notes/NoteCard';
import { NoteForm } from '@/modules/notes/NoteForm';
import type { Note } from '@/shared/types';
import { Card, ConfirmDialog, EmptyState, Spinner } from '@/shared/ui';

/**
 * The notes wall's grid, and this file's own constant: each column is at least 18rem wide and the
 * columns share the leftover width (`1fr`), and a container narrower than 18rem gets one column as
 * wide as the container — a wall card is 18rem and up, a card in a narrow gutter or phone pane is the
 * full pane. `items-start` is what keeps a tall note from stretching its neighbours to its own height.
 */
const NOTES_WALL_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] items-start gap-4';

/**
 * THE NOTES, ONE CARD PER NOTE, THE BLANK CARD FIRST. Used by `src/modules/notes/NotesPanel` (the
 * Notes tab's pane) and by `src/modules/notes/NotesWidgetBody` (the chat gutter's widget) — it is
 * ONE list in two homes, so a card, a delete and the wall's grid read the same at either width.
 *
 * THE THREE UNREAD STATES ARE NOT THE EMPTY ONE, and the order below says so: `notes === null` is
 * "no read has answered", which is a spinner until one fails and then an unreachable box with the
 * way to ask again; `[]` is an answer, and shows the blank card with the empty words under it. A
 * failed read over a list that once answered keeps that list — the provider hands it back unchanged
 * — because the last good reading is worth more than a box about this minute's network.
 *
 * THE DELETE IS A QUESTION, NOT A KEYSTROKE. A card's Delete opens the kit's `ConfirmDialog` on that
 * note and writes nothing; the dialog's Delete is what calls the provider, and its `Keep it`, its
 * backdrop and its Escape all just put the question down.
 *
 * THE KEYBOARD COMES HOME TWICE: an add that landed and a delete that landed both leave the reader
 * with a shorter list and a control that has left the screen, so both hand it to the blank card's
 * title — the one control that is always there and always the next thing to type in.
 */
export function NotesList() {
  const { t } = useTranslation();
  const { notes, unreachable, refresh, setComposer, add, remove } = useNotes();
  const { composer, adding, writing } = useNoteDrafts();

  // The note the delete dialog is asking about, or `null` while no question is up. Essential: the
  // dialog is the list's own — one list serves both homes — so the question outlives the card that
  // asked it, and it holds the note itself because the dialog's message draws its title.
  const [deleting, setDeleting] = useState<Note | null>(null);

  // The blank card's title: where an add that landed and a delete that landed both hand the
  // keyboard, and the one field a person writes in next.
  const composerTitleRef = useRef<HTMLInputElement>(null);

  const onSubmitAdd = async () => {
    const landed = await add(composer);
    if (landed) requestAnimationFrame(() => composerTitleRef.current?.focus());
  };

  // A press on a card's Delete only asks: this holds the note the dialog is asking about, and
  // nothing is written until the dialog's own Delete is pressed.
  const onAskDelete = (note: Note) => setDeleting(note);

  const onConfirmDelete = async () => {
    const note = deleting;
    if (note === null) return;
    const landed = await remove(note.id);
    // A delete that did not land leaves the question up — the note is still there, and the reader
    // who tried is the one who should decide what happens next.
    if (landed) {
      setDeleting(null);
      requestAnimationFrame(() => composerTitleRef.current?.focus());
    }
  };

  const onRetry = () => {
    void refresh();
  };

  if (notes === null) {
    return (
      <div className="flex items-center justify-center px-4 py-10">
        {unreachable ? (
          <EmptyState
            icon={PlugZapIcon}
            title={t('notes.unreachable')}
            actionLabel={t('notes.retry')}
            onAction={onRetry}
          />
        ) : (
          <Spinner label={t('notes.reading')} />
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* `min-w-0` on every item, and it is load-bearing: a grid item's `min-width: auto` would
          widen its track to the longest unbreakable thing inside it, and the one unbroken URL among
          the fixtures would push the whole wall sideways. Zero lets the track win, and the card's
          own `break-words` splits the token. */}
      <ul data-notes-list aria-label={t('notes.title')} className={NOTES_WALL_GRID}>
        <li data-note-composer className="min-w-0">
          <Card className="min-w-0 p-4">
            <NoteForm
              draft={composer}
              onChange={setComposer}
              onSubmit={onSubmitAdd}
              submitLabel={t('notes.form.add')}
              busy={adding}
              titleRef={composerTitleRef}
            />
          </Card>
        </li>
        {notes.map((note) => (
          <li key={note.id} data-note-id={note.id} className="min-w-0">
            <NoteCard note={note} onDelete={onAskDelete} />
          </li>
        ))}
      </ul>
      {/* Under the wall, and after the blank card: the empty words point UP at the card this list
          still draws, which is the one thing there is to do about it. Centred rather than left to
          fill, so the dashed frame sits around the sentence and not around the pane — the same
          shape the unreachable box above wears, because both are the body saying "nothing here". */}
      {notes.length === 0 && (
        <div className="flex items-center justify-center px-4 py-10">
          <EmptyState icon={StickyNoteIcon} title={t('notes.empty.title')} message={t('notes.empty.message')} />
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('notes.delete.title')}
        message={t('notes.delete.message', { title: deleting?.title ?? '' })}
        // Keep it first, Delete last: the irreversible answer is the one the eye reaches second.
        actions={[
          { label: t('notes.delete.cancel'), variant: 'outline', onSelect: () => setDeleting(null) },
          {
            label: t('notes.delete.confirm'),
            variant: 'destructive',
            busy: deleting !== null && writing[deleting.id] === true,
            onSelect: () => {
              void onConfirmDelete();
            },
          },
        ]}
        onDismiss={() => setDeleting(null)}
      />
    </div>
  );
}
