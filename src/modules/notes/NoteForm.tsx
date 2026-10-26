import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';

import type { NoteInput, NoteSaveStatus } from '@/shared/types';
import { Button, Input } from '@/shared/ui';

/**
 * The title's ceiling, the mirror of `notes.service.ts`'s own: a longer title is refused there, and
 * the field stops accepting the keystroke that would cross it here.
 */
const TITLE_MAX_LENGTH = 200;

/** The description's ceiling, the mirror of `notes.service.ts`'s own. */
const DESCRIPTION_MAX_LENGTH = 20000;

/** The words of each quiet saving line, by key under `notes.form`. */
const STATUS_WORDS: Record<NoteSaveStatus, string> = {
  saving: 'notes.form.saving',
  saved: 'notes.form.saved',
  titleNeeded: 'notes.form.titleNeeded',
};

type NoteFormProps = {
  draft: NoteInput;
  onChange: (draft: NoteInput) => void;
  /** Finish this note now: Enter in the title, Ctrl/⌘+Enter in the description, and the Done button. */
  onDone: () => void;
  /** Whether the Done button is drawn. The blank card has nothing to close until it has become a note. */
  showDone: boolean;
  /** Focus moved off the card and stayed in the page, or the card is going away: the owner saves, and lets go if it is the blank card. */
  onLeave: () => void;
  /** Focus left with the window (an app switch) or the page is hiding: the owner saves and keeps the card exactly as it is. */
  onSaveNow: () => void;
  /** The card's quiet saving line, or `undefined` for none. */
  status: NoteSaveStatus | undefined;
  /** The title input, for the owner that has to put the keyboard on it. */
  titleRef?: RefObject<HTMLInputElement>;
};

/**
 * The notes module's one form: a title, a description and the quiet line that says how saving is going.
 * There is no button that saves — the owner's autosave does, about a second after typing stops — and
 * the one button, Done, only closes the card.
 *
 * READ BY TWO OWNERS, READING NO CONTEXT OF ITS OWN. `NotesList` draws it in the blank card over the
 * composer, and `NoteCard` draws it over a note in edit mode — so every keystroke leaves through
 * `onChange`, and who holds the draft, who saves it and what finishing means are the owner's business,
 * not this form's. It is controlled in both fields, so a draft that outlives its card's re-render is the
 * provider's state and never this component's, and nothing the server answers can move its caret.
 *
 * LEAVING. A card is left when focus moves to something outside the form (`onBlur`, which also fires when
 * a phone's keyboard closes) and when the form unmounts (a tab changing, the widget folding). A blur
 * that comes with the WINDOW losing focus — an app switch — only asks the owner to save: the card keeps
 * its place, and the person finds the caret where it was. Moving between the form's own title,
 * description and Done is not leaving.
 *
 * THE KEYBOARD. Enter in the title finishes the note — a one-line field that does nothing on Enter is a
 * field that has stopped feeling like one. In the description Enter is a new line, because a description is
 * written in paragraphs, and Ctrl+Enter or ⌘+Enter finishes it for a keyboard reader who does not want to
 * reach for the button. No Escape: a fullscreen widget's Escape belongs to the gutter layout.
 *
 * AN IME'S ENTER IS THE IME'S. While a composition is being built (a Japanese, Korean or Chinese
 * title), the Enter that commits the composed word arrives as a keydown this form would otherwise
 * take for finishing — so both handlers return before it, as the house's two other Enter-as-send
 * handlers do (`useChatComposerState.ts`, `KanbanMetisConversation.tsx`).
 */
export function NoteForm({ draft, onChange, onDone, showDone, onLeave, onSaveNow, status, titleRef }: NoteFormProps) {
  const { t } = useTranslation();

  // The owner's `onLeave` of the LATEST render, so the unmount below calls the one the card has now.
  const onLeaveRef = useRef(onLeave);
  useLayoutEffect(() => {
    onLeaveRef.current = onLeave;
  }, [onLeave]);
  useEffect(() => () => onLeaveRef.current(), []);

  return (
    <form
      data-note-form
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(event) => {
        // A one-field form would submit itself on Enter; the title's keydown below has already taken it.
        event.preventDefault();
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        // `document.hasFocus()` is false when the window itself lost focus: the card stays as it is.
        if (document.hasFocus()) onLeave();
        else onSaveNow();
      }}
    >
      <Input
        ref={titleRef}
        data-note-title
        value={draft.title}
        maxLength={TITLE_MAX_LENGTH}
        placeholder={t('notes.form.title')}
        aria-label={t('notes.form.title')}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
        // The composition guard comes first, so the Enter that commits an IME's word is left to the IME.
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {/* Painted the way the board's card drawer paints its own description area
          (`kanban/card-drawer/DrawerBody.tsx`): `vv-input` for the field's ground, `resize-y` so a
          long note is written in a box its writer sized. */}
      <textarea
        data-note-description
        rows={3}
        value={draft.description}
        maxLength={DESCRIPTION_MAX_LENGTH}
        placeholder={t('notes.form.descriptionPlaceholder')}
        aria-label={t('notes.form.description')}
        onChange={(event) => onChange({ ...draft, description: event.target.value })}
        onKeyDown={(event) => {
          // The title's guard, for the same reason: no keystroke of a composition in progress is
          // this form's to take.
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onDone();
          }
        }}
        className="vv-input w-full resize-y px-3 py-2 text-sm"
      />
      <div className="flex min-h-4 flex-wrap items-center gap-2">
        {showDone && (
          <Button type="button" variant="outline" size="sm" data-note-done onClick={onDone}>
            {t('notes.form.done')}
          </Button>
        )}
        {/* Quiet on purpose: muted, small, and a polite live region — never a toast for a save that
            worked. The line keeps its height when empty, so `Saving…` appearing moves nothing. */}
        <p data-note-status={status ?? ''} aria-live="polite" className="min-w-0 text-xs text-muted-foreground">
          {status === undefined ? '' : t(STATUS_WORDS[status])}
        </p>
      </div>
    </form>
  );
}
