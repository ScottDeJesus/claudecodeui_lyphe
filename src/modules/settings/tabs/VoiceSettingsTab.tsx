import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionSettingsSection } from '@/modules/companion';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useVoiceConfig } from '@/modules/settings/hooks/useVoiceConfig';
import { useVoiceSettings } from '@/modules/settings/hooks/useVoiceSettings';
import { GeminiVoiceSection } from '@/modules/settings/tabs/voice-settings/sections/GeminiVoiceSection';
import { TranscriptCleanupSection } from '@/modules/settings/tabs/voice-settings/sections/TranscriptCleanupSection';
import { VocabularySection } from '@/modules/settings/tabs/voice-settings/sections/VocabularySection';
import { VoiceProviderPicker } from '@/modules/settings/tabs/voice-settings/sections/VoiceProviderPicker';
import { SettingRow, SettingsCard, SettingsSection } from '@/shared/ui';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

/**
 * Rendered by Settings for the "voice" tab: voice on or off; with it on, the chat's provider (VoiceProviderPicker: Gemini or
 * an OpenAI-compatible backend, for the mic and read-aloud alike) heading the backend section. The OpenAI-compatible fields
 * under it (base URL, key, speech-to-text model, speech model, voice, format) stand only while that provider is picked: on
 * Gemini the server hears on its own speech-to-text service, then on its own key, and speaks on that key, in the speech model and voice of the Gemini section below, so those
 * fields would change nothing. Then, whether or not voice is on, the transcript-cleanup switch (it governs the chat mic and
 * Kaylee's presses alike), the vocabulary of house words (VocabularySection: misheard spellings corrected for both ears, and
 * how Kaylee says each), Gemini (GeminiVoiceSection), because Kaylee speaks through Gemini always and hears through it whenever the local speech-to-text service gives no words, and her own section.
 */
export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { config, update } = useVoiceConfig();
  const voiceEnabled = preferences.voiceEnabled;
  const { settings: voiceSettings, keyStatus, saving, error, providerRefusal, saveSettings, saveKey, clearKey, retry } = useVoiceSettings();
  // The OpenAI-compatible fields stand only while that backend is picked. Before the settings are read the picker says Gemini,
  // which is the server's default.
  const pickedProvider = voiceSettings?.provider ?? 'gemini';
  const openaiPicked = pickedProvider === 'openai';

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <SettingsCard>
          <SettingRow label={t('voiceSettings.enable')} description={t('voiceSettings.enableDescription')}>
            <SettingsToggle
              checked={voiceEnabled}
              onChange={(v) => setPreference('voiceEnabled', v)}
              ariaLabel={t('voiceSettings.enable')}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsSection>

      {voiceEnabled && (
        <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
          <div className="space-y-4">
            {/* The option already picked sends nothing: the picker calls onChange for it too, and a save of what the server holds is a write, a re-read and two requests more. */}
            <VoiceProviderPicker value={pickedProvider} onChange={(provider) => { if (provider !== pickedProvider) void saveSettings({ provider }); }} />
            {providerRefusal !== null && (
              <p role="alert" data-tone="warn" data-voice-provider-refused="" className="text-xs font-medium text-tone-ink">
                <span aria-hidden="true">▲ </span>
                {providerRefusal}
              </p>
            )}
            {openaiPicked && (
              <>
                <Field
                  label={t('voiceSettings.baseUrl')}
                  placeholder="https://api.openai.com/v1"
                  value={config.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                />
                <Field
                  label={t('voiceSettings.apiKey')}
                  type="password"
                  autoComplete="off"
                  placeholder="sk-…"
                  value={config.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <Field
                    label={t('voiceSettings.sttModel')}
                    placeholder="whisper-1"
                    value={config.sttModel}
                    onChange={(e) => update({ sttModel: e.target.value })}
                  />
                  <Field
                    label={t('voiceSettings.ttsModel')}
                    placeholder="tts-1"
                    value={config.ttsModel}
                    onChange={(e) => update({ ttsModel: e.target.value })}
                  />
                  <Field
                    label={t('voiceSettings.voice')}
                    placeholder="alloy"
                    value={config.ttsVoice}
                    onChange={(e) => update({ ttsVoice: e.target.value })}
                  />
                  <Field
                    label={t('voiceSettings.format')}
                    placeholder="mp3"
                    value={config.ttsFormat}
                    onChange={(e) => update({ ttsFormat: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
              </>
            )}
          </div>
        </SettingsSection>
      )}

      {/* Whether or not voice is on, and whichever provider is picked: it cleans what the chat's mic and Kaylee's presses hear. */}
      <TranscriptCleanupSection
        checked={voiceSettings?.cleanTranscripts}
        saving={saving}
        onChange={(cleanTranscripts) => { void saveSettings({ cleanTranscripts }); }}
      />

      {/* Whether or not voice is on, whichever provider is picked: the words both ears correct and Kaylee's voice respells. It reads and saves for itself. */}
      <VocabularySection />

      {/* Whether or not voice is on: Kaylee speaks through Gemini, and hears through it when the local speech-to-text service gives no words, whatever the picker says. */}
      <GeminiVoiceSection
        keyStatus={keyStatus}
        transcriptionModel={voiceSettings?.gemini.transcriptionModel ?? ''}
        saving={saving}
        error={error}
        onSaveKey={saveKey}
        onClearKey={clearKey}
        onTranscriptionModel={(model) => saveSettings({ gemini: { transcriptionModel: model } })}
        speechModel={voiceSettings?.gemini.speechModel}
        onSpeechModel={(model) => saveSettings({ gemini: { speechModel: model } })}
        voice={voiceSettings?.gemini.voice}
        onVoice={(name) => saveSettings({ gemini: { voice: name } })}
        soundTags={voiceSettings?.gemini.soundTags}
        // `null` restores Google's set; `saving` turns true in the same press, which the add field reads to keep his word until the answer.
        onSoundTags={(tags) => saveSettings({ gemini: { soundTags: tags } })}
        onRetry={retry}
      />

      {/* Kaylee's own section, whether or not voice is on: she is typed to as much as she is spoken to, and it reads and saves for itself. */}
      <CompanionSettingsSection />
    </div>
  );
}
