import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionSettingsSection } from '@/modules/companion';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useVoiceConfig } from '@/modules/settings/hooks/useVoiceConfig';
import { useVoiceSettings } from '@/modules/settings/hooks/useVoiceSettings';
import { GeminiVoiceSection } from '@/modules/settings/tabs/voice-settings/sections/GeminiVoiceSection';
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
 * Rendered by Settings for the "voice" tab: voice on or off; with it on, the chat mic's provider (VoiceProviderPicker)
 * heading the voice-input section. That section is the OpenAI-compatible backend, which read-aloud uses whatever the
 * picker says, so all of it stands on Gemini too but the speech-to-text model, the one field that is the chat mic's alone.
 * Then, whether or not voice is on, Gemini (GeminiVoiceSection), because Kaylee hears and speaks through Gemini always,
 * and her own section.
 */
export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { config, update } = useVoiceConfig();
  const voiceEnabled = preferences.voiceEnabled;
  const { settings: voiceSettings, keyStatus, saving, error, providerRefusal, saveSettings, saveKey, clearKey, retry } = useVoiceSettings();
  // The speech-to-text model field is the chat mic's alone, so it stands only while the OpenAI-compatible backend is
  // picked. Before the settings are read the picker says OpenAI-compatible too, which is the server's default.
  const pickedProvider = voiceSettings?.provider ?? 'openai';
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
            {/* Three columns once the speech-to-text model is gone, so read-aloud's three fields close the row. */}
            <div className={openaiPicked ? 'grid grid-cols-1 gap-4 sm:grid-cols-4' : 'grid grid-cols-1 gap-4 sm:grid-cols-3'}>
              {openaiPicked && (
                <Field
                  label={t('voiceSettings.sttModel')}
                  placeholder="whisper-1"
                  value={config.sttModel}
                  onChange={(e) => update({ sttModel: e.target.value })}
                />
              )}
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
          </div>
        </SettingsSection>
      )}

      {/* Whether or not voice is on: Kaylee hears and speaks through Gemini whatever the picker says. */}
      <GeminiVoiceSection
        keyStatus={keyStatus}
        transcriptionModel={voiceSettings?.gemini.transcriptionModel ?? ''}
        saving={saving}
        error={error}
        onSaveKey={saveKey}
        onClearKey={clearKey}
        onTranscriptionModel={(model) => saveSettings({ gemini: { transcriptionModel: model } })}
        // FILL(fill): speech model read — `speechModel={voiceSettings?.gemini.speechModel}`: the stored name; undefined while the settings are unread, so no row stands over a value the page cannot see.
        // FILL(fill): speech model save — `onSpeechModel={(model) => saveSettings({ gemini: { speechModel: model } })}`.
        // FILL(fill): voice read — `voice={voiceSettings?.gemini.voice}`, Kore until he picks another.
        // FILL(fill): voice save — `onVoice={(name) => saveSettings({ gemini: { voice: name } })}`.
        // FILL(fill): sound tags read — `soundTags={voiceSettings?.gemini.soundTags}`: the server's list in its order; the page keeps no copy of Google's set.
        // FILL(fill): sound tags save — `onSoundTags={(tags) => saveSettings({ gemini: { soundTags: tags } })}`, straight through: `saving` turns true in the same press (useVoiceSettings' queue does), which the add field reads to keep his word until the answer; `null` restores Google's set.
        onRetry={retry}
      />

      {/* Kaylee's own section, whether or not voice is on: she is typed to as much as she is spoken to, and it reads and saves for itself. */}
      <CompanionSettingsSection />
    </div>
  );
}
