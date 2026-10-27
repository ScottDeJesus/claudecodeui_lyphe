import { useTranslation } from 'react-i18next';

import { Field, SegmentedControl } from '@/shared/ui';

type VoiceProviderPickerProps = {
  /** Which service turns the chat's mic into text: 'openai' (the OpenAI-compatible backend, today's) or 'gemini'. */
  value: 'openai' | 'gemini';
  onChange: (value: 'openai' | 'gemini') => void;
};

/**
 * The chat's mic provider: OpenAI-compatible or Gemini, as the kit's SegmentedControl (a radio group, the arrows moving
 * the choice) in the kit's Field, labelled "Speech to text" with "Which service turns the chat's mic into text." under it.
 * Composed for the settings module's VoiceSettingsTab, at the head of the voice-input section, above the OpenAI-compatible
 * fields; `.verify/kaylee-talk-scaffold.mjs` draws it on each value. It governs the chat's mic alone: Kaylee hears through
 * Gemini whatever it says, and read-aloud stays on the OpenAI-compatible backend, so on Gemini only the speech-to-text
 * model field goes and read-aloud's fields stay.
 */
export function VoiceProviderPicker({ value, onChange }: VoiceProviderPickerProps) {
  const { t } = useTranslation('settings');
  const label = t('voiceSettings.provider.label', { defaultValue: 'Speech to text' });

  return (
    <Field label={label} helper={t('voiceSettings.provider.help', { defaultValue: "Which service turns the chat's mic into text." })}>
      {/* A block around the tray, so the field's column does not stretch it: the tray is as wide as its two words. */}
      <div>
        <SegmentedControl
          label={label}
          value={value}
          onChange={onChange}
          options={[
            { value: 'openai', label: t('voiceSettings.provider.openai', { defaultValue: 'OpenAI-compatible' }) },
            { value: 'gemini', label: t('voiceSettings.provider.gemini', { defaultValue: 'Gemini' }) },
          ]}
        />
      </div>
    </Field>
  );
}
