import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionSettingsForm } from '@/modules/companion/CompanionSettingsForm';
import { TalkBindingField } from '@/modules/companion/TalkBindingField';
import { useCompanionSettings } from '@/modules/companion/hooks/useCompanionSettings';
import { useTalkBindingCapture } from '@/modules/companion/hooks/useTalkBindingCapture';
import type { CompanionSettings } from '@/shared/companion-types';
import { Banner, Button, SettingsCard, SettingsSection, Spinner } from '@/shared/ui';

type CompanionSettingsViewProps = {
  /** Her settings as the section's own read returned them; null while it loads, and after a read that failed. */
  settings: CompanionSettings | null;
  /** The read failed. The section says so and offers Try again; it never offers fields over settings it cannot see. */
  loadFailed: boolean;
  onRetry: () => void;
  /** Saves a partial and resolves once the server holds it; `register: null` restores the original register. */
  onSave: (patch: Partial<CompanionSettings> | { register: null }) => Promise<void>;
  /**
   * The talk button's row (TalkBindingField), drawn in a card of its own above her fields once they are read: how he
   * talks to her comes before who she is. Absent, nothing is drawn for it.
   */
  talkBinding?: ReactNode;
};

/**
 * Settings > Voice > Companion, drawn: the section title, then the talk button's binding in a card of its own when it is
 * given, then her four fields (CompanionSettingsForm) in the settings tab's own card. Before they are read, a waiting row
 * in that card; a read that failed is a warn Banner with Try again, and no fields, because a field offered over a setting
 * the section cannot see is how a good value gets overwritten.
 *
 * Exported for this file's CompanionSettingsSection and for `.verify/companion-panel-scaffold.mjs`, which draws each of
 * these states, and `.verify/kaylee-talk-scaffold.mjs`, which draws the talk button's row in its card.
 */
export function CompanionSettingsView({ settings, loadFailed, onRetry, onSave, talkBinding }: CompanionSettingsViewProps) {
  const { t } = useTranslation('settings');

  let body;
  if (settings !== null) {
    body = (
      <>
        {talkBinding && <SettingsCard className="mb-3">{talkBinding}</SettingsCard>}
        <CompanionSettingsForm settings={settings} onSave={onSave} />
      </>
    );
  } else if (loadFailed) {
    body = (
      <Banner tone="warn" action={<Button variant="outline" size="sm" onClick={onRetry}>{t('voiceSettings.companion.retry')}</Button>}>
        {t('voiceSettings.companion.loadFailed')}
      </Banner>
    );
  } else {
    body = (
      <SettingsCard className="flex items-center justify-center px-4 py-8">
        <Spinner size={24} label={t('voiceSettings.companion.loading')} />
      </SettingsCard>
    );
  }

  return (
    <SettingsSection title={t('voiceSettings.companion.title')} description={t('voiceSettings.companion.description')}>
      <div data-companion-settings={settings !== null ? 'ready' : loadFailed ? 'failed' : 'loading'}>{body}</div>
    </SettingsSection>
  );
}

/**
 * Her Settings section, self-contained: what the settings module's VoiceSettingsTab renders after its own sections,
 * whether or not voice is on. It does its own read and its own save, so it works wherever Settings renders, and hands
 * both to CompanionSettingsView.
 */
export function CompanionSettingsSection() {
  const { settings, loadFailed, retry, save } = useCompanionSettings();
  // Bind's capture: the next key or mouse button is saved as `talkBinding` through this section's own save, or its refusal is shown.
  const capture = useTalkBindingCapture((talkBinding) => save({ talkBinding }));

  return (
    <CompanionSettingsView
      settings={settings}
      loadFailed={loadFailed}
      onRetry={retry}
      onSave={save}
      talkBinding={
        <TalkBindingField
          label={settings?.talkBinding?.label ?? null}
          capturing={capture.capturing}
          refusal={capture.refusal}
          onBind={capture.begin}
          onClear={capture.clear}
          onCancel={capture.cancel}
        />
      }
    />
  );
}
