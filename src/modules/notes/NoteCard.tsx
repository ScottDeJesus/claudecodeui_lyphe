import { PencilIcon, Trash2Icon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useNoteDrafts, useNotes } from '@/modules/notes/context/NotesContext';
import { NoteForm } from '@/modules/notes/NoteForm';
import type { Note, NoteInput } from '@/shared/types';
import { Button, Card } from '@/shared/ui';

type NoteCardProps = {
  note: Note;
  /** The list's Delete: it opens the dialog on this note, and writes nothing itself. */
  onDelete: (note: Note) => void;
};

/**
 * One note as the notes wall draws it: the title, the two verbs, and the description when it has
 * one — or the form over it while the note is in edit mode.
 *
 * Used by `src/modules/notes/NotesList`, the one list both homes mount (the Notes tab's pane and
 * the chat gutter's Notes widget), so a note is composed once and reads the same in either place.
 *
 * READ MODE IS THE COMPOSITION, NOT A PREVIEW. Title and description are text nodes — nothing here
 * renders markdown or HTML — the description keeps the writer's line breaks (`whitespace-pre-wrap`),
 * both wrap (`break-words`), and neither is clamped: a note is short because a person wrote a short
 * one, and a card that hid half a long one would be a card that lied about its own contents.
 *
 * EDIT MODE IS THE DRAFT'S, NOT THIS CARD'S. `edits[note.id]` is the whole test — a card is in edit
 * mode exactly while the provider holds a draft for it — so the text survives a re-render, a scroll
 * and a switch of home, and a save or a cancel is what takes the entry away.
 *
 * THE KEYBOARD TRAVELS WITH THE MODE: Edit presses put it on the form's title (the line a person
 * came to change), and Save and Cancel hand it back to the Edit button they came from, so a
 * keyboard reader is never dropped on `<body>` by a button that left with the mode it ended.
 *
 * THE VERBS ARE A THUMB'S, NOT A MOUSE'S: 40px until `sm` and 32 after, the house's corner-button
 * floor (`LaneCardHead`'s CORNER_BUTTON, `CardFold`) — on a phone these two are the card's only
 * controls, and a thumb is not aiming at a 16px glyph.
 */
export function NoteCard({ note, onDelete }: NoteCardProps) {
  const { t } = useTranslation();
  const { setEdit, saveEdit } = useNotes();
  const { edits, writing } = useNoteDrafts();

  // The draft this card is editing, if it is editing one at all.
  const draft = edits[note.id];

  // The two ends of the hand-offs above: the form's title, and this card's own Edit button.
  const titleRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  const onEdit = () => {
    setEdit(note.id, { title: note.title, description: note.description });
    requestAnimationFrame(() => titleRef.current?.focus());
  };

  const onEditChange = (next: NoteInput) => {
    setEdit(note.id, next);
  };

  const onSubmitEdit = async () => {
    if (draft === undefined) return;
    const landed = await saveEdit(note.id, draft);
    // A save that landed takes the form away with it, so the keyboard follows it back to Edit; one
    // that did not leaves the form standing with the draft still in it, and the keyboard with it.
    if (landed) requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const onCancelEdit = () => {
    setEdit(note.id, null);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const editLabel = t('notes.card.edit', { title: note.title });
  const deleteLabel = t('notes.card.delete', { title: note.title });

  return (
    <Card className="min-w-0 p-4">
      {draft !== undefined ? (
        <NoteForm
          draft={draft}
          onChange={onEditChange}
          onSubmit={onSubmitEdit}
          onCancel={onCancelEdit}
          submitLabel={t('notes.form.save')}
          busy={writing[note.id] === true}
          titleRef={titleRef}
        />
      ) : (
        <>
          <div className="flex items-start gap-1">
            <h3 className="min-w-0 flex-1 break-words text-sm font-medium">{note.title}</h3>
            <Button
              ref={editButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground sm:h-8 sm:w-8"
              aria-label={editLabel}
              title={editLabel}
              data-note-edit
              onClick={onEdit}
            >
              <PencilIcon aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
              aria-label={deleteLabel}
              title={deleteLabel}
              data-note-delete
              onClick={() => onDelete(note)}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          </div>
          {note.description !== '' && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{note.description}</p>
          )}
        </>
      )}
    </Card>
  );
}
