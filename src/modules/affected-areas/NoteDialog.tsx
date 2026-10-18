import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MARK_NOTE_MAX } from '@/shared/constants';
import { Button, DialogFrame, TextArea } from '@/shared/ui';

type NoteDialogProps = {
  /** What the note is on, after the title: "2. Containment", "New area 4". */
  subject: string;
  /** The note already kept for the next press, which the field opens on; '' when there is none. */
  note: string;
  /** Keep the note (trimmed; '' takes it away) for the press that follows, and close. */
  onKeep: (note: string) => void;
  /** Cancel, the ✕, Escape and the backdrop: close and keep the note as it was. */
  onDismiss: () => void;
};

/**
 * ADD A NOTE: a small field in Verve's framed dialog, "A note on *2. Containment*", at most 500 characters (the
 * engine's own cap, so a kept note is never one it turns back). Keep the note holds it for the next press on the
 * area — Confirm, Rename to… or Not a change, or Missed one's Save — which sends it with the mark; nothing is sent
 * from here. The count of characters sits under the field from the first one typed.
 *
 * A dialog, not a field in the bar: a note is the rare press, and the bar stays one row of answers. Mounted only
 * while it is open (`DialogFrame`), so it opens clean on the kept note every time.
 *
 * Used by the affected-areas module's `MarkBar` and `MissedDraw`.
 */
export function NoteDialog({ subject, note, onKeep, onDismiss }: NoteDialogProps) {
  const { t } = useTranslation();
  const helpId = useId();
  // What is typed, before Keep the note: the dialog's own draft, which Cancel drops and the bar never sees.
  const [draft, setDraft] = useState(note);

  return (
    <DialogFrame size="md" title={t('affectedAreas.mark.noteTitle')} accent={{ words: subject }} onDismiss={onDismiss} data-mark-note-dialog="">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onKeep(draft.trim());
        }}
      >
        <div className="flex flex-col gap-1.5">
          <TextArea
            value={draft}
            rows={4}
            maxLength={MARK_NOTE_MAX}
            aria-label={t('affectedAreas.mark.noteLabel')}
            aria-describedby={helpId}
            placeholder={t('affectedAreas.mark.notePlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p id={helpId} className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
            <span>{t('affectedAreas.mark.noteHelp')}</span>
            <span className="tabular-nums">{t('affectedAreas.mark.noteCount', { used: draft.length, max: MARK_NOTE_MAX })}</span>
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" className="max-md:h-11" onClick={onDismiss}>
            {t('buttons.cancel')}
          </Button>
          <Button type="submit" className="max-md:h-11">
            {t('affectedAreas.mark.keepNote')}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}
