import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { VocabularyEntry } from '@/shared/types';
import { Button, Chip, ConfirmDialog, Input } from '@/shared/ui';

type VocabularyEntryRowProps = {
  entry: VocabularyEntry;
  /** A save is out: every press waits for it, because the next list is made from the one drawn. */
  saving: boolean;
  /** Hands on the whole entry as it would now read. For a saved row the section saves the list with it; for the draft it keeps it. */
  onChange: (next: VocabularyEntry) => void;
  /** Deletes this saved entry (asked first). Absent on the draft. */
  onDelete?: () => void;
  /**
   * Set only on the row being composed: nothing is sent until Add word, which hands the word over WITH the forms typed into its
   * field and not yet added; Cancel drops it.
   */
  draft?: { onSave: (word: VocabularyEntry) => void; onCancel: () => void };
  /** The server's sentence for a refused save made from THIS row, drawn in the row so it is never off screen; null when there is none. */
  refusal?: string | null;
};

/** What he typed in the form the server stores: trimmed, inner spaces collapsed. */
const tidied = (typed: string): string => typed.trim().replace(/\s+/g, ' ');

/** The forms in a typed line: split at commas and line breaks, tidied, blanks and ones the entry already has (any case) or its own spelling left out. */
function newForms(typed: string, entry: VocabularyEntry): string[] {
  const known = new Set([entry.spelling, ...entry.misheard].map((form) => form.toLowerCase()));
  const fresh: string[] = [];
  for (const piece of typed.split(/[,\n]/)) {
    const form = tidied(piece);
    if (form === '' || known.has(form.toLowerCase())) continue;
    known.add(form.toLowerCase());
    fresh.push(form);
  }
  return fresh;
}

type CommitFieldProps = {
  label: string;
  /** The server's value for the field: what it shows until he types. */
  value: string;
  placeholder?: string;
  saving: boolean;
  /** A change of the tidied text. `allowEmpty` fields send an empty one too (a blank pronunciation means "as written"). */
  onCommit: (text: string) => void;
  allowEmpty?: boolean;
  hook: string;
};

/**
 * One text field of a row that is saved as he leaves it (Tab, a click away, or Enter) and never per keystroke, because a save
 * replaces the whole list. Escape puts the server's value back. He sees his text until the save settles; a refused one then
 * snaps back to the server's value, and the sentence in the row says why. The field is read-only while any save is out: an edit
 * made then would be built from the list as drawn, which is the one from before that save, and would replace it.
 */
function CommitField({ label, value, placeholder, saving, onCommit, allowEmpty = false, hook }: CommitFieldProps) {
  // What he has typed and not yet committed; null while the field shows the server's value.
  const [typed, setTyped] = useState<string | null>(null);
  // The commit is out: the typed text stays until the answer settles, so the field never flips back for the moment the save is in flight.
  const [sent, setSent] = useState(false);

  // Set while rendering, which React re-runs at once: no frame draws the typed text past the answer.
  if (sent && !saving) {
    setSent(false);
    setTyped(null);
  }

  const commit = () => {
    if (typed === null) return;
    const text = tidied(typed);
    if (text === value || (text === '' && !allowEmpty)) {
      setTyped(null);
      return;
    }
    setSent(true);
    onCommit(text);
  };

  return (
    <label className="block min-w-0 flex-1 basis-40 space-y-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <Input
        value={typed ?? value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        data-vocabulary-field={hook}
        readOnly={saving}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setTyped(null);
          }
        }}
      />
    </label>
  );
}

/**
 * Settings > Voice > Vocabulary: one house word as a row of its own. Its SPELLING, how it SOUNDS (Kaylee's voice says this in
 * its place; blank means as written), and the forms a transcriber MISHEARS it as, each a chip that removes itself, with a field
 * to add more (Enter adds; commas add several). Composed for this folder's VocabularySection, which draws one per saved entry
 * and one more, with `draft`, while a new word is being composed.
 *
 * A saved row saves as he changes it: a field when he leaves it, a form when it is added or removed. Nothing is optimistic; while
 * any save is out every press waits (`busy`, which keeps focus where a disabled button would drop it) and every field is
 * read-only. A save the server refuses is explained in the row it was made from (`refusal`), under the fields it touched.
 * Deleting a word asks first, because it takes its misheard forms with it.
 */
export function VocabularyEntryRow({ entry, saving, onChange, onDelete, draft, refusal = null }: VocabularyEntryRowProps) {
  const { t } = useTranslation('settings');
  // The forms he is typing, until the entry holds them: kept through a refused add, so nothing he typed is lost.
  const [formText, setFormText] = useState('');
  // The forms last sent, until the answer settles: once no save is out, the field empties if the entry holds them all.
  const [sentForms, setSentForms] = useState<string[] | null>(null);
  // Whether the delete question is up, so a slip never drops a word.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (sentForms !== null && !saving) {
    setSentForms(null);
    if (sentForms.every((form) => entry.misheard.includes(form))) setFormText('');
  }

  const addForms = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const fresh = newForms(formText, entry);
    if (fresh.length === 0) {
      setFormText('');
      return;
    }
    setSentForms(fresh);
    onChange({ ...entry, misheard: [...entry.misheard, ...fresh] });
  };

  const saveDraft = () => {
    if (!draft || saving) return;
    // Forms typed into the field and not yet added ride along: "Add word" under them means this word with those forms, never the word alone.
    draft.onSave({ ...entry, misheard: [...entry.misheard, ...newForms(formText, entry)] });
  };

  const removeForm = (gone: string) => {
    if (saving) return;
    onChange({ ...entry, misheard: entry.misheard.filter((form) => form !== gone) });
  };

  const name = entry.spelling || t('voiceSettings.vocabulary.newWord', { defaultValue: 'new word' });

  return (
    <div data-vocabulary-entry={entry.spelling || ''} data-vocabulary-draft={draft ? '' : undefined} className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <CommitField
          label={t('voiceSettings.vocabulary.spelling', { defaultValue: 'Spelling' })}
          value={entry.spelling}
          placeholder={t('voiceSettings.vocabulary.spellingPlaceholder', { defaultValue: 'lypheCli' })}
          saving={saving}
          hook="spelling"
          onCommit={(spelling) => onChange({ ...entry, spelling })}
        />
        <CommitField
          label={t('voiceSettings.vocabulary.pronunciation', { defaultValue: 'Sounds like' })}
          value={entry.pronunciation}
          placeholder={entry.spelling || t('voiceSettings.vocabulary.pronunciationPlaceholder', { defaultValue: 'life C-L-I' })}
          saving={saving}
          allowEmpty
          hook="pronunciation"
          onCommit={(pronunciation) => onChange({ ...entry, pronunciation })}
        />
        {onDelete && (
          <Button
            variant="outline"
            size="sm"
            busy={saving}
            aria-label={t('voiceSettings.vocabulary.delete', { defaultValue: 'Delete {{word}}', word: name })}
            data-vocabulary-delete=""
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <span className="block text-xs font-medium text-foreground">
          {t('voiceSettings.vocabulary.misheard', { defaultValue: 'Misheard as' })}
        </span>
        {entry.misheard.length > 0 && (
          <div role="group" aria-label={t('voiceSettings.vocabulary.misheard', { defaultValue: 'Misheard as' })} className="flex flex-wrap gap-1.5 [@media(pointer:coarse)]:gap-2">
            {entry.misheard.map((form) => (
              <Chip
                key={form}
                size="sm"
                action
                busy={saving}
                ariaLabel={t('voiceSettings.vocabulary.removeForm', { defaultValue: 'Remove {{form}}', form })}
                onClick={() => removeForm(form)}
                // 44px under a finger, the touch floor: every chip here is a press that removes at once.
                className="[@media(pointer:coarse)]:min-h-11"
              >
                <span data-vocabulary-form={form}>{form}</span>
                <X aria-hidden="true" className="-mr-1 size-3 shrink-0" />
              </Chip>
            ))}
          </div>
        )}
        <form onSubmit={addForms} className="flex flex-wrap items-center gap-2">
          <Input
            value={formText}
            placeholder={t('voiceSettings.vocabulary.formPlaceholder', { defaultValue: 'Add a misheard form, like life CLI' })}
            autoComplete="off"
            spellCheck={false}
            aria-label={t('voiceSettings.vocabulary.formField', { defaultValue: 'A misheard form of {{word}}', word: name })}
            data-vocabulary-form-field=""
            onChange={(event) => setFormText(event.target.value)}
            className="min-w-0 flex-1 basis-48"
          />
          <Button type="submit" size="sm" busy={saving} disabled={formText.trim() === ''}>
            {t('voiceSettings.vocabulary.addForm', { defaultValue: 'Add' })}
          </Button>
        </form>
      </div>

      {refusal !== null && (
        <p role="alert" data-tone="warn" data-vocabulary-refusal="" className="text-xs font-medium text-tone-ink">
          <span aria-hidden="true">▲ </span>
          {refusal}
        </p>
      )}

      {draft && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Never `disabled`: leaving the spelling field commits it a moment before this press lands, so a refusal here is read at the press. */}
          <Button size="sm" busy={saving || entry.spelling === ''} data-vocabulary-save-word="" onClick={saveDraft}>
            {t('voiceSettings.vocabulary.saveWord', { defaultValue: 'Add word' })}
          </Button>
          <Button variant="ghost" size="sm" busy={saving} onClick={draft.onCancel}>
            {t('voiceSettings.gemini.cancel', { defaultValue: 'Cancel' })}
          </Button>
        </div>
      )}

      {onDelete && (
        <ConfirmDialog
          open={confirmingDelete}
          // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
          wrapperClassName="z-[10000]"
          title={t('voiceSettings.vocabulary.deleteTitle', { defaultValue: 'Delete {{word}}?', word: name })}
          message={t('voiceSettings.vocabulary.deleteMessage', {
            defaultValue: 'It goes from the vocabulary, with its misheard forms: they are no longer corrected, and Kaylee says it as it is written.',
          })}
          actions={[
            { label: t('voiceSettings.gemini.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirmingDelete(false) },
            {
              label: t('voiceSettings.vocabulary.deleteConfirm', { defaultValue: 'Delete' }),
              variant: 'destructive',
              onSelect: () => {
                setConfirmingDelete(false);
                onDelete();
              },
            },
          ]}
          onDismiss={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
