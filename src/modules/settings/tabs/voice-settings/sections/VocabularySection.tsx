import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVocabulary } from '@/modules/settings/hooks/useVocabulary';
import { VocabularyEntryRow } from '@/modules/settings/tabs/voice-settings/sections/VocabularyEntryRow';
import type { VocabularyEntry } from '@/shared/types';
import { Button, SettingsCard, SettingsSection } from '@/shared/ui';

const NEW_WORD: VocabularyEntry = { spelling: '', pronunciation: '', misheard: [] };

/**
 * Settings > Voice > Vocabulary: the house words, as an editable table, one row per word. A word is its spelling, how it sounds,
 * and the spellings a transcriber gives it by mistake. One list serves three jobs: both transcribers are told the spellings, the
 * misheard forms in every transcript are replaced with them (the chat mic's and Kaylee's presses alike, whether or not fillers
 * are cleaned), and Kaylee's voice says each word the way it sounds. The list is the account's, kept on the server and read on
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
  const { entries, saving, error, save, retry } = useVocabulary();
  // The word being composed: it is not in the list, and not on the server, until he adds it; null when none is.
  const [draft, setDraft] = useState<VocabularyEntry | null>(null);
  // The row the last save was made from (its place in the list, or the draft): a refusal is drawn there. A refused save leaves the list as it was, so the place still names the same row.
  const [editedRow, setEditedRow] = useState<number | 'draft' | null>(null);

  const replaceAt = (index: number, next: VocabularyEntry) => {
    if (entries === null) return;
    setEditedRow(index);
    void save(entries.map((entry, at) => (at === index ? next : entry)));
  };

  const deleteAt = (index: number) => {
    if (entries === null) return;
    setEditedRow(index);
    void save(entries.filter((_entry, at) => at !== index));
  };

  const addWord = async (word: VocabularyEntry) => {
    if (entries === null || saving) return;
    setEditedRow('draft');
    if (await save([...entries, word])) setDraft(null);
  };

  return (
    <SettingsSection
      title={t('voiceSettings.vocabulary.title', { defaultValue: 'Vocabulary' })}
      description={t('voiceSettings.vocabulary.description', {
        defaultValue: "Words of your own that a transcriber mishears. It writes them as spelled, any misheard form (whole words, any case) is corrected, and Kaylee says each one the way it sounds. Separate several misheard forms with commas.",
      })}
    >
      <div data-vocabulary-section={entries?.length ?? ''}>
        <SettingsCard divided>
          {entries === null ? (
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
              {entries.length === 0 && draft === null && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('voiceSettings.vocabulary.empty', { defaultValue: 'No words yet: nothing is corrected, and Kaylee says everything as written.' })}
                </p>
              )}
              {entries.map((entry, index) => (
                <VocabularyEntryRow
                  key={entry.spelling}
                  entry={entry}
                  saving={saving}
                  onChange={(next) => replaceAt(index, next)}
                  onDelete={() => deleteAt(index)}
                  refusal={editedRow === index ? error : null}
                />
              ))}
              {draft !== null && (
                <VocabularyEntryRow
                  entry={draft}
                  saving={saving}
                  onChange={setDraft}
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
