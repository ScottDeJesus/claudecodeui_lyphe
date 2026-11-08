import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVocabulary } from '@/modules/settings/hooks/useVocabulary';
import { VocabularyEntryRow } from '@/modules/settings/tabs/voice-settings/sections/VocabularyEntryRow';
import type { VocabularyEntry, VocabularyRow } from '@/shared/types';
import { Button, SettingsCard, SettingsSection } from '@/shared/ui';

const NEW_WORD: VocabularyEntry = { spelling: '', pronunciation: '', misheard: [] };

/**
 * Settings > Voice > Vocabulary: the house words, as an editable table, one row per word. A word is its spelling, how it sounds,
 * and the spellings a transcriber gives it by mistake. One list serves three jobs: the transcribers are told the spellings (the
 * home server as one line, Gemini, the backup, in its instruction), the misheard forms in every transcript are replaced with them
 * (the chat mic's and Kaylee's presses alike, whether or not fillers are cleaned), and Kaylee's voice says each word the way it sounds. The list is the account's, kept on the server and read on
 * every press, so a change applies at once. It stands whether or not voice is on. Composed for the settings module's
 * VoiceSettingsTab, after the transcript-cleanup switch; it reads and saves for itself (`useVocabulary`).
 *
 * Saved as he changes it, the way the tab's other fields are: a refused list leaves the table as it was and the server's own
 * sentence stands in the row the edit was made from, beside what he changed (the table is several windows tall, so a line under
 * it would be off screen for every row but the last); under the table stands only "Saving…", always mounted so the line
 * appearing never reads as the card moving. A new word is composed in a row of its own and joins the list, saved, when he adds
 * it, with any forms he typed and had not yet added.
 */
export function VocabularySection() {
  const { t } = useTranslation('settings');
  const { rows, saving, error, save, rowFor, retry } = useVocabulary();
  // The word being composed: it is not in the list, and not on the server, until he adds it; null when none is.
  const [draft, setDraft] = useState<VocabularyEntry | null>(null);
  // The row a refused save was made from (its id, or the draft): a refusal is drawn there. Set when the answer comes, because saves queue and an answer can arrive after another row has been edited.
  const [editedRow, setEditedRow] = useState<number | 'draft' | null>(null);

  /** Saves what `change` makes of the list when this save's turn comes; a refusal is filed under `place`, the row it was made from. */
  const saveFrom = async (place: number | 'draft', change: (current: VocabularyRow[]) => VocabularyRow[]): Promise<boolean> => {
    const landed = await save(change);
    if (!landed) setEditedRow(place);
    return landed;
  };

  const changeEntry = (id: number, change: (entry: VocabularyEntry) => VocabularyEntry) => {
    // The row keeps its id: a rename is the same row with a new spelling, so it stays mounted and its field keeps the focus. Found by id, never by place: a save asked for before this one may have moved the rows.
    void saveFrom(id, (current) => current.map((row) => (row.id === id ? { ...row, entry: change(row.entry) } : row)));
  };

  const deleteRow = (id: number) => {
    void saveFrom(id, (current) => current.filter((row) => row.id !== id));
  };

  const addWord = async (word: VocabularyEntry) => {
    if (rows === null || saving) return;
    if (await saveFrom('draft', (current) => [...current, rowFor(word)])) setDraft(null);
  };

  return (
    <SettingsSection
      title={t('voiceSettings.vocabulary.title', { defaultValue: 'Vocabulary' })}
      description={t('voiceSettings.vocabulary.description', {
        defaultValue: "Words of your own that a transcriber mishears. It writes them as spelled, any misheard form (whole words, any case) is corrected, and Kaylee says each one the way it sounds. Separate several misheard forms with commas.",
      })}
    >
      <div data-vocabulary-section={rows?.length ?? ''}>
        <SettingsCard divided>
          {rows === null ? (
            <div className="flex flex-wrap items-center gap-3 p-4 text-sm text-muted-foreground">
              {error === null ? t('voiceSettings.vocabulary.loading', { defaultValue: 'Loading…' }) : (
                <>
                  <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
                    <span aria-hidden="true">▲ </span>
                    {error}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => { void retry(); }}>
                    {t('voiceSettings.gemini.retry', { defaultValue: 'Try again' })}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              {rows.length === 0 && draft === null && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('voiceSettings.vocabulary.empty', { defaultValue: 'No words yet: nothing is corrected, and Kaylee says everything as written.' })}
                </p>
              )}
              {rows.map((row) => (
                <VocabularyEntryRow
                  // The row's own id, never its spelling: a key made of the spelling would remount the row when a rename is saved and drop the focus from the field being typed in.
                  key={row.id}
                  entry={row.entry}
                  saving={saving}
                  onChange={(change) => changeEntry(row.id, change)}
                  onDelete={() => deleteRow(row.id)}
                  refusal={editedRow === row.id ? error : null}
                />
              ))}
              {draft !== null && (
                <VocabularyEntryRow
                  entry={draft}
                  saving={saving}
                  onChange={(change) => setDraft((current) => (current === null ? current : change(current)))}
                  draft={{ onSave: (word) => { void addWord(word); }, onCancel: () => setDraft(null) }}
                  refusal={editedRow === 'draft' ? error : null}
                />
              )}
              {draft === null && (
                <div className="p-4">
                  <Button variant="outline" size="sm" busy={saving} data-vocabulary-add-row="" onClick={() => setDraft(NEW_WORD)}>
                    <Plus aria-hidden="true" />
                    {t('voiceSettings.vocabulary.addRow', { defaultValue: 'Add a word' })}
                  </Button>
                </div>
              )}
            </>
          )}
        </SettingsCard>

        {/* Always mounted, so the line appearing never reads as the card moving. */}
        <p data-vocabulary-save={saving ? 'saving' : 'idle'} className="mt-2 min-h-4 px-1 text-xs">
          {saving && <span className="text-muted-foreground">{t('voiceSettings.gemini.saving', { defaultValue: 'Saving…' })}</span>}
        </p>
      </div>
    </SettingsSection>
  );
}
