import { useTranslation } from 'react-i18next';

import type { VoiceProvider } from '@/shared/types';
import { Field, SegmentedControl } from '@/shared/ui';

type VoiceProviderPickerProps = {
  /** Which service hears the chat's mic and speaks its read-aloud: 'gemini' (the default) or 'openai' (the OpenAI-compatible backend). */
  value: VoiceProvider;
  onChange: (value: VoiceProvider) => void;
};

/**
 * The chat's voice provider: Gemini or OpenAI-compatible, as the kit's SegmentedControl (a radio group, the arrows moving
 * the choice) in the kit's Field, labelled "Voice service" with "Which service hears the chat's mic and speaks its read-aloud."
 * under it. Composed for the settings module's VoiceSettingsTab, at the head of the backend section, above the OpenAI-compatible
 * fields, which stand only while 'openai' is picked. It governs the chat's mic and its read-aloud: Kaylee hears and speaks
 * through Gemini whatever it says.
 */
export function VoiceProviderPicker({ value, onChange }: VoiceProviderPickerProps) {
  const { t } = useTranslation('settings');
  const label = t('voiceSettings.provider.label', { defaultValue: 'Voice service' });

  return (
    <Field label={label} helper={t('voiceSettings.provider.help', { defaultValue: "Which service hears the chat's mic and speaks its read-aloud." })}>
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
