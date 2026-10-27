import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { GeminiNameField } from '@/modules/settings/tabs/voice-settings/sections/GeminiNameField';
import { SoundTagsField } from '@/modules/settings/tabs/voice-settings/sections/SoundTagsField';
import type { GeminiKeyStatus } from '@/shared/types';
import { Banner, Button, ConfirmDialog, Input, SettingRow, SettingsCard, SettingsSection, Spinner, WholeWords } from '@/shared/ui';

type GeminiVoiceSectionProps = {
  /**
   * Which key Gemini uses for this account, never the key itself: his own stored one (`last4` its last four characters),
   * the house's, or none. Null while the account's voice settings are still being read.
   */
  keyStatus: GeminiKeyStatus | null;
  /** The Gemini model that transcribes, as stored: free text, 1-80 of letters, digits, `.`, `_` and `-`. */
  transcriptionModel: string;
  /** A save of the key or the model is out: Save, Replace and Clear wait for it. */
  saving: boolean;
  /**
   * The server's sentence for the last refused save; while `keyStatus` is null, for the read that failed. Null when none.
   */
  error: string | null;
  /** Stores this key as his, replacing any he stored before. */
  onSaveKey: (key: string) => void;
  /** Forgets his stored key: the house's is used again, if the house has one. Called once he confirms. */
  onClearKey: () => void;
  /** Stores the transcription model, trimmed and well formed. */
  onTranscriptionModel: (model: string) => void;
  /**
   * The Gemini model that speaks her sentences, as stored: free text, 1-80 of letters, digits, `.`, `_` and `-`. Drawn,
   * with `onSpeechModel`, as the row after the transcription model; absent, there is no row.
   */
  speechModel?: string;
  /** Stores the speech model, trimmed and well formed. */
  onSpeechModel?: (model: string) => void;
  /**
   * The Gemini voice she speaks in, as stored (Kore by default): free text, 1-40 of letters, digits, `_` and `-`. Drawn,
   * with `onVoice`, after the speech model; absent, there is no row.
   */
  voice?: string;
  /** Stores the voice, trimmed and well formed. */
  onVoice?: (voice: string) => void;
  /**
   * Her sound tags, the one list her register teaches and her filter keeps, as the server holds it. Drawn, with
   * `onSoundTags`, as the card's last row (SoundTagsField); absent, there is no row.
   */
  soundTags?: string[];
  /** Saves the whole list; null restores Google's set. */
  onSoundTags?: (tags: string[] | null) => void;
  /** Reads the settings again after a read that failed: the failed read's Banner offers it as Try again. */
  onRetry?: () => void;
};

/** A key the server takes: 20-200 printable ASCII characters, no whitespace (`saveGeminiKey`'s own rule: the key rides an HTTP header). */
const KEY_SHAPE = /^[\x21-\x7e]{20,200}$/;
/** A model name the server takes (`saveVoiceSettings`' own rule, `MODEL_PATTERN`), for the transcription and the speech model. */
const MODEL_SHAPE = /^[A-Za-z0-9._-]{1,80}$/;
/** A voice name the server takes (`saveVoiceSettings`' own rule, `VOICE_PATTERN`). */
const VOICE_SHAPE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Settings > Voice > Gemini, shown whatever the chat mic's provider, because Kaylee hears and speaks through Gemini either
 * way. Composed for the settings module's VoiceSettingsTab, after the voice-input section and before her own;
 * `.verify/kaylee-talk-scaffold.mjs` draws it for each key source, refused and waiting, and
 * `.verify/kaylee-voice-scaffold.mjs` with her voice's rows.
 *
 * THE KEY ROW leads, because whether Gemini works and on whose key is the first thing to know. Under "API key" its line
 * says which key is in use: "✓ Using your key ending 1a2b", "✓ Using the house's key" (green: Gemini works), or
 * "▲ No key: Gemini is off" (amber: she cannot hear). Under that, the card's full width: a password field, then Save —
 * Replace once his own key is stored — and Clear, only then. Enter saves too. The field empties the moment a key is sent,
 * so a key never stands in the page after its save, and is never shown back beyond the four characters the line names.
 * A key that cannot be one (under 20 characters, or with a space) says so under the field and is not sent. Clear asks
 * first, as Settings does before it deletes any stored key: a key forgotten here cannot be shown again.
 *
 * THE NAME ROWS, each a GeminiNameField: the transcription model (placeholder gemini-3.8-flash), then, given theirs, her
 * voice's two — the speech model (placeholder gemini-3.8-flash-tts; its helper names gemini-3.8-flash-lite-tts as the
 * cheap choice) and the voice (placeholder Kore). Each is free text saved when the field is left or on Enter, only when
 * it changed and is a name the server takes; one that is not says why in place of its helper. Each follows the stored
 * value while he is not editing it.
 *
 * THE SOUND TAGS, given them, close the card (SoundTagsField): the chips of her allow-list with add, remove and Restore
 * Google's set, which saves `null`.
 *
 * THE CARD'S LAST LINE says "Saving…" while a save is out and the server's refusal after one is refused. Before the
 * settings are read the card is a waiting row; a read that failed is a warn Banner with the server's sentence and Try
 * again, as her own section below draws its own, and no fields: a field offered over a value the page cannot see is how a
 * good value gets overwritten.
 */
export function GeminiVoiceSection({
  keyStatus, transcriptionModel, saving, error, onSaveKey, onClearKey, onTranscriptionModel,
  speechModel, onSpeechModel, voice, onVoice, soundTags, onSoundTags, onRetry,
}: GeminiVoiceSectionProps) {
  const { t } = useTranslation('settings');
  const idBase = useId();
  // The key as he pastes it, until Save sends it. Held only here and emptied by the send: the page never holds a key after.
  const [typedKey, setTypedKey] = useState('');
  // Whether Clear's question is up: the question is the press's first half, so a key is never forgotten by one slip.
  const [confirmingClear, setConfirmingClear] = useState(false);

  const title = t('voiceSettings.gemini.title', { defaultValue: 'Gemini' });
  const description = t('voiceSettings.gemini.description', {
    defaultValue: "Kaylee hears and speaks through Gemini. The chat's mic uses it when picked above.",
  });

  if (keyStatus === null) {
    return (
      <SettingsSection title={title} description={description}>
        <div data-gemini-voice={error === null ? 'loading' : 'failed'}>
          {error === null ? (
            <SettingsCard className="flex items-center justify-center px-4 py-8">
              <Spinner size={24} label={t('voiceSettings.gemini.loading', { defaultValue: 'Reading your Gemini settings…' })} />
            </SettingsCard>
          ) : (
            <Banner
              tone="warn"
              action={onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>{t('voiceSettings.gemini.retry', { defaultValue: 'Try again' })}</Button>
              )}
            >
              {t('voiceSettings.gemini.loadFailed', { defaultValue: "Your Gemini settings couldn't be read: {{reason}}", reason: error })}
            </Banner>
          )}
        </div>
      </SettingsSection>
    );
  }

  const stored = keyStatus.source === 'stored';
  const keyInvalid = typedKey.length > 0 && !KEY_SHAPE.test(typedKey);
  const modelInvalid = t('voiceSettings.gemini.modelInvalid', { defaultValue: 'A model name is 1–80 letters, digits, dots, dashes or underscores.' });

  const saveKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || typedKey.length === 0 || keyInvalid) return;
    onSaveKey(typedKey);
    setTypedKey('');
  };

  const forgetKey = () => {
    setConfirmingClear(false);
    onClearKey();
  };

  const keyLine = {
    stored: { tone: 'positive', glyph: '✓', words: t('voiceSettings.gemini.keyStored', { defaultValue: 'Using your key ending {{last4}}', last4: keyStatus.last4 ?? '' }) },
    house: { tone: 'positive', glyph: '✓', words: t('voiceSettings.gemini.keyHouse', { defaultValue: "Using the house's key" }) },
    none: { tone: 'warn', glyph: '▲', words: t('voiceSettings.gemini.keyNone', { defaultValue: 'No key: Gemini is off' }) },
  }[keyStatus.source];

  return (
    <SettingsSection title={title} description={description}>
      <div data-gemini-voice="ready">
        <SettingsCard divided>
          <div>
            <SettingRow
              label={t('voiceSettings.gemini.key', { defaultValue: 'API key' })}
              description={(
                <span id={`${idBase}-key-status`} data-tone={keyLine.tone} data-gemini-key={keyStatus.source} className="font-medium text-tone-ink">
                  <span aria-hidden="true">{keyLine.glyph} </span>
                  {keyLine.words}
                </span>
              )}
              className="pb-3"
            >
              {null}
            </SettingRow>
            <form onSubmit={saveKey} className="flex flex-wrap items-center gap-2 px-4 pb-4">
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={typedKey}
                placeholder={stored
                  ? t('voiceSettings.gemini.keyReplacePlaceholder', { defaultValue: 'Paste a new key to replace it' })
                  : t('voiceSettings.gemini.keyPlaceholder', { defaultValue: 'Paste a Gemini API key' })}
                aria-label={t('voiceSettings.gemini.keyField', { defaultValue: 'Gemini API key' })}
                aria-describedby={keyInvalid ? `${idBase}-key-invalid` : `${idBase}-key-status`}
                invalid={keyInvalid}
                data-gemini-key-field=""
                onChange={(event) => setTypedKey(event.target.value)}
                className="min-w-0 flex-1 basis-48"
              />
              {/* One group, so a narrow card puts both buttons under the field together instead of stranding Clear. */}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" busy={saving} disabled={typedKey.length === 0 || keyInvalid}>
                  {stored
                    ? t('voiceSettings.gemini.replace', { defaultValue: 'Replace' })
                    : t('voiceSettings.gemini.save', { defaultValue: 'Save' })}
                </Button>
                {stored && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    busy={saving}
                    aria-label={t('voiceSettings.gemini.clearLabel', { defaultValue: 'Clear your Gemini key' })}
                    onClick={() => setConfirmingClear(true)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t('voiceSettings.gemini.clear', { defaultValue: 'Clear' })}
                  </Button>
                )}
              </div>
              {keyInvalid && (
                <p id={`${idBase}-key-invalid`} role="alert" data-tone="warn" className="basis-full text-xs font-medium text-tone-ink">
                  <span aria-hidden="true">▲ </span>
                  {t('voiceSettings.gemini.keyInvalid', { defaultValue: 'A Gemini key is 20–200 plain ASCII characters with no spaces.' })}
                </p>
              )}
            </form>
          </div>
          <GeminiNameField
            label={t('voiceSettings.gemini.model', { defaultValue: 'Transcription model' })}
            help={t('voiceSettings.gemini.modelHelp', { defaultValue: 'The Gemini model that writes down what is said, by its exact name.' })}
            invalid={modelInvalid}
            stored={transcriptionModel}
            placeholder="gemini-3.8-flash"
            shape={MODEL_SHAPE}
            hook="model"
            saving={saving}
            onSave={onTranscriptionModel}
          />
          {speechModel !== undefined && onSpeechModel && (
            <GeminiNameField
              label={t('voiceSettings.gemini.speechModel', { defaultValue: 'Speech model' })}
              // The cheap model's name is one word: held whole, never broken at a hyphen across two lines.
              help={<WholeWords>{t('voiceSettings.gemini.speechModelHelp', {
                defaultValue: 'The Gemini model that speaks her sentences, by its exact name. gemini-3.8-flash-lite-tts is the cheap choice.',
              })}</WholeWords>}
              invalid={modelInvalid}
              stored={speechModel}
              placeholder="gemini-3.8-flash-tts"
              shape={MODEL_SHAPE}
              hook="speech-model"
              saving={saving}
              onSave={onSpeechModel}
            />
          )}
          {voice !== undefined && onVoice && (
            <GeminiNameField
              label={t('voiceSettings.gemini.voice', { defaultValue: 'Voice' })}
              help={t('voiceSettings.gemini.voiceHelp', { defaultValue: 'The Gemini voice she speaks in, by its exact name.' })}
              invalid={t('voiceSettings.gemini.voiceInvalid', { defaultValue: 'A voice name is 1–40 letters, digits, dashes or underscores.' })}
              stored={voice}
              placeholder="Kore"
              shape={VOICE_SHAPE}
              hook="voice"
              saving={saving}
              onSave={onVoice}
            />
          )}
          {soundTags !== undefined && onSoundTags && <SoundTagsField tags={soundTags} saving={saving} onChange={onSoundTags} />}
        </SettingsCard>

        {/* Always mounted, so the line appearing never reads as the card moving. */}
        <p data-gemini-voice-save={saving ? 'saving' : error !== null ? 'refused' : 'idle'} className="mt-2 min-h-4 px-1 text-xs">
          {saving && <span className="text-muted-foreground">{t('voiceSettings.gemini.saving', { defaultValue: 'Saving…' })}</span>}
          {!saving && error !== null && (
            <span role="alert" data-tone="warn" className="font-medium text-tone-ink">
              <span aria-hidden="true">▲ </span>
              {error}
            </span>
          )}
        </p>
      </div>

      <ConfirmDialog
        // Open only while his own key is stored: a key cleared meanwhile (another page) leaves nothing to ask about.
        open={confirmingClear && stored}
        // Raised over the Settings modal, a body portal at z-9999: at the default z-50 the question would open behind it.
        wrapperClassName="z-[10000]"
        title={t('voiceSettings.gemini.clearTitle', { defaultValue: 'Forget your Gemini key?' })}
        message={t('voiceSettings.gemini.clearMessage', {
          defaultValue: "The key ending {{last4}} is removed and can't be shown again. Gemini goes back to the house's key, or is off if the house has none.",
          last4: keyStatus.last4 ?? '',
        })}
        actions={[
          { label: t('voiceSettings.gemini.cancel', { defaultValue: 'Cancel' }), variant: 'outline', onSelect: () => setConfirmingClear(false) },
          { label: t('voiceSettings.gemini.clearConfirm', { defaultValue: 'Forget the key' }), variant: 'destructive', onSelect: forgetKey },
        ]}
        onDismiss={() => setConfirmingClear(false)}
      />
    </SettingsSection>
  );
}
