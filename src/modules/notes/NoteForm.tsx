import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';

import type { NoteInput } from '@/shared/types';
import { Button, Input } from '@/shared/ui';

/**
 * The title's ceiling, the mirror of `notes.service.ts`'s own: a longer title is refused there, and
 * the field stops accepting the keystroke that would cross it here.
 */
const TITLE_MAX_LENGTH = 200;

/** The description's ceiling, the mirror of `notes.service.ts`'s own. */
const DESCRIPTION_MAX_LENGTH = 20000;

/**
 * The characters that DRAW AS NOTHING, the mirror of `notes.service.ts`'s own: whitespace (`\s`),
 * format characters — U+200B ZERO WIDTH SPACE and its family, which `\s` misses — and control
 * characters. The service refuses a title that is only these; this field will not offer one.
 *
 * The two classes are one decision written twice — the client build cannot import from `server/`.
 * Change one and change the other.
 */
const DRAWS_AS_NOTHING = /[\s\p{Cf}\p{Cc}]/gu;

type NoteFormProps = {
  draft: NoteInput;
  onChange: (draft: NoteInput) => void;
  onSubmit: () => void;
  /** Present on an edit, absent on the blank card. */
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
  /** The title input, for the owner that has to put the keyboard on it. */
  titleRef?: RefObject<HTMLInputElement>;
};

/**
 * The notes module's one form: a title, a description and the one verb that writes them.
 *
 * READ BY TWO OWNERS, READING NO CONTEXT OF ITS OWN. `NotesList` draws it in the blank card over the
 * composer, and `NoteCard` draws it over a note in edit mode — so every keystroke leaves through
 * `onChange`, every submit through `onSubmit`, and who holds the draft and what a submit writes are
 * the owner's business, not this form's. It is controlled in both fields, so a draft that outlives
 * its card's re-render is the provider's state and never this component's.
 *
 * ONE DISABLED RULE, READ ONCE: a title of nothing is not a note, and a write already in flight is
 * not a second write, so the button and both Enter keys ask the same question.
 *
 * THE KEYBOARD. Enter in the title submits — a one-line field that does nothing on Enter is a field
 * that has stopped feeling like one. In the description Enter is a new line, because a description is
 * written in paragraphs, and Ctrl+Enter or ⌘+Enter submits for a keyboard reader who does not want
 * to reach for the button. No Escape: a fullscreen widget's Escape belongs to the gutter layout.
 *
 * AN IME'S ENTER IS THE IME'S. While a composition is being built (a Japanese, Korean or Chinese
 * title), the Enter that commits the composed word arrives as a keydown this form would otherwise
 * take for a submit — so both handlers return before it, as the house's two other Enter-as-send
 * handlers do (`useChatComposerState.ts`, `KanbanMetisConversation.tsx`).
 */
export function NoteForm({ draft, onChange, onSubmit, onCancel, submitLabel, busy, titleRef }: NoteFormProps) {
  const { t } = useTranslation();

  const canSubmit = draft.title.replace(DRAWS_AS_NOTHING, '') !== '' && !busy;

  const submit = () => {
    if (canSubmit) onSubmit();
  };

  return (
    <form
      data-note-form
      className="flex min-w-0 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
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
        // Taken here rather than left to the form's own implicit submission, so the disabled rule
        // is asked in one place and a busy form cannot be submitted by a keystroke. The composition
        // guard comes first, so the Enter that commits an IME's word is left to the IME.
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
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
            submit();
          }
        }}
        className="vv-input w-full resize-y px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" data-note-submit disabled={!canSubmit}>
          {submitLabel}
        </Button>
        {/* Only an edit has anything to back out of; the blank card's draft is discarded by
            emptying it, and a Cancel beside Add would be a button that does nothing. */}
        {onCancel && (
          <Button type="button" variant="ghost" data-note-cancel onClick={onCancel}>
            {t('notes.form.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
