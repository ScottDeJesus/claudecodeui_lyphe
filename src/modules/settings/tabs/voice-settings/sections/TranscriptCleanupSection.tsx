import { useTranslation } from 'react-i18next';

import SettingsToggle from '@/modules/settings/SettingsToggle';
import { SettingRow, SettingsCard, SettingsSection } from '@/shared/ui';

type TranscriptCleanupSectionProps = {
  /** The account's `cleanTranscripts` as the server last answered; undefined while the settings are unread, so no switch stands over a value the page cannot see. */
  checked: boolean | undefined;
  /** A save is out: the switch waits for the answer, so two quick presses cannot land out of order. */
  saving: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * The one switch that decides whether a transcript has its um, uh and repeated words removed before it is used: "Clean up
 * transcripts". Composed for the settings module's VoiceSettingsTab, standing before the Gemini section whether or not voice
 * is on, because it governs both ears: the chat mic (whichever provider is picked) and Kaylee's talk button and wake-word presses.
 */
export function TranscriptCleanupSection({ checked, saving, onChange }: TranscriptCleanupSectionProps) {
  const { t } = useTranslation('settings');
  const label = t('voiceSettings.cleanTranscripts.label', { defaultValue: 'Clean up transcripts — remove um, uh, repeats' });

  return (
    <SettingsSection title={t('voiceSettings.cleanTranscripts.title', { defaultValue: 'Transcripts' })}>
      <SettingsCard>
        <SettingRow
          label={label}
          description={t('voiceSettings.cleanTranscripts.help', {
            defaultValue: "Filler sounds, stutters and words said twice are taken out of what the chat's mic and Kaylee hear, so the text reads like what you meant to say. Off keeps them as said; the vocabulary below still corrects its words.",
          })}
        >
          <SettingsToggle checked={checked ?? true} onChange={onChange} ariaLabel={label} disabled={checked === undefined || saving} />
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  );
}
