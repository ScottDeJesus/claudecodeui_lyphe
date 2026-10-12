import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { Button, Input } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';

type CheckLabelEditorProps = {
  /** The name it opens with: the check's label, or '' for a check that has none. */
  value: string;
  /** Enter or Save, with the trimmed name. '' clears the name, and the key shows again. */
  onSave: (label: string) => void;
  /** Escape or Cancel. Nothing is written. */
  onCancel: () => void;
  /** True while the write is in flight: the field holds still and neither button presses. */
  busy: boolean;
};

/**
 * "NAME THIS CHECK", inline: a field with Save and Cancel where the check's name stood. Enter saves
 * (the form's own submit) and Escape cancels. It is mounted only while it is open, so the field
 * opens with the name selected whole: typing replaces it, and an arrow key keeps it.
 *
 * It CLAIMS ESCAPE in front of the sheet (`OWNS_ESCAPE`, `shared/ui/overlayEscape`). The sheet
 * listens on its window's capture phase, marks the key and stands down for any claim drawn inside
 * it, so the first Escape cancels this edit and the next one closes the sheet. The claim is honest
 * because the root renders only while the editor is open, and it is dropped while a save is in
 * flight, when the edit cannot be cancelled: a press then closes the sheet, and the write lands, or
 * raises its toast, either way. The key is heard on the host DOCUMENT, not on the field, as `Select`
 * and `Menu` hear theirs, because the claim stands while the editor is open and focus may have moved
 * to a row or the strip. A key heard only on the field would leave that Escape dead: the sheet would
 * stand down and nothing would act on it.
 *
 * Save stays off while it would change nothing, so Enter on an untouched name writes nothing.
 * Emptying a name that was there says what saving it will do. The field sets no length of its own:
 * the server keeps the one rule for a name's length, and a name past it comes back as the write's
 * toast in the server's own words.
 *
 * What a save writes is the caller's: `CheckSheet` wires `onSave` to the label write and `onCancel`
 * to closing the editor, and drops the editor into `SelectedCheck`'s name slot while it is open.
 *
 * Used by the cerberus module's `CheckSheet`.
 */
export function CheckLabelEditor({ value, onSave, onCancel, busy }: CheckLabelEditorProps) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // What the person has typed, seeded from the name it opened with. Essential: it is the edit in
  // progress, which nothing else holds until Save hands it on.
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Bound again whenever Cancel or busy changes, so the key never answers with a stale prop.
  useEffect(() => {
    if (busy) return undefined;
    const hostDocument = hostWindow.document;
    const cancelOnEscape = (event: KeyboardEvent) => {
      // An Escape that ends an IME composition is the composition's, not the edit's.
      if (event.key !== 'Escape' || event.isComposing) return;
      onCancel();
    };
    hostDocument.addEventListener('keydown', cancelOnEscape);
    return () => hostDocument.removeEventListener('keydown', cancelOnEscape);
  }, [hostWindow, onCancel, busy]);

  const trimmed = draft.trim();
  const unchanged = trimmed === value.trim();
  const clears = trimmed === '' && !unchanged;

  return (
    <form
      {...(busy ? {} : OWNS_ESCAPE)}
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !unchanged) onSave(trimmed);
      }}
    >
      <Input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        readOnly={busy}
        aria-busy={busy || undefined}
        aria-label={t('cerberus.sheet.nameThis')}
        aria-describedby={clears ? hintId : undefined}
        className="h-9 min-w-0 flex-[1_1_15rem]"
      />
      <span className="flex flex-none gap-1.5">
        <Button type="submit" size="sm" disabled={busy || unchanged}>
          {t('cerberus.sheet.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cerberus.sheet.cancel')}
        </Button>
      </span>
      {clears && (
        <p id={hintId} className="basis-full text-xs text-muted-foreground">
          {t('cerberus.sheet.clearsName')}
        </p>
      )}
    </form>
  );
}
