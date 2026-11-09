import { useTranslation } from 'react-i18next';

import { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
import { useCompanionMaterial } from '@/modules/companion/hooks/useCompanionMaterial';
import type { CompanionMaterial, CompanionPresence } from '@/shared/types';
import { SegmentedControl, SettingRow, SettingsCard } from '@/shared/ui';

/** The preview's presence: idle, so the core breathes and the loop drifts, and nothing is read or said. */
const IDLE_PRESENCE: CompanionPresence = { state: 'idle', session: null, files: null, walk: null };
/** The preview's square: large enough for the raymarched core, the tier her panel and the station draw her in. */
const PREVIEW_SIZE_PX = 136;

type CompanionMaterialSettingsProps = {
  /** Her name as he set it: the preview's accessible name and the card's words. */
  name: string;
};

/**
 * Her face card on Settings: the Astrolabe instrument she is drawn as, live, and the material it is made of — Mercury (chrome, the
 * default), Tube (amber glass, for slow and reflective sessions) or Wire (a cyan wireframe, for fast debugging). Used by this module's
 * CompanionSettingsSection, in CompanionSettingsView's `face` slot. The choice is the `companionMaterial` preference, so it follows him to
 * every device, and her button and the station change with it at once.
 */
export function CompanionMaterialSettings({ name }: CompanionMaterialSettingsProps) {
  const { t } = useTranslation('settings');
  const { material, setMaterial } = useCompanionMaterial();
  const title = t('voiceSettings.companion.material.title', { defaultValue: 'Her material' });
  const options: { value: CompanionMaterial; label: string; detail: string }[] = [
    { value: 'mercury', label: t('voiceSettings.companion.material.mercury', { defaultValue: 'Mercury' }), detail: t('voiceSettings.companion.material.mercuryDetail', { defaultValue: 'Polished chrome. The default.' }) },
    { value: 'tube', label: t('voiceSettings.companion.material.tube', { defaultValue: 'Tube' }), detail: t('voiceSettings.companion.material.tubeDetail', { defaultValue: 'Amber vacuum-tube glass, for slow, reflective sessions.' }) },
    { value: 'wire', label: t('voiceSettings.companion.material.wire', { defaultValue: 'Wire' }), detail: t('voiceSettings.companion.material.wireDetail', { defaultValue: 'A cyan wireframe, for fast debugging.' }) },
  ];
  const chosen = options.find((option) => option.value === material) ?? options[0];

  return (
    <div data-companion-material={material}>
      <SettingsCard className="[container-type:inline-size]">
        <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-4 p-4 [@container(min-width:30rem)]:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div data-companion-material-preview="" className="mx-auto size-[8.5rem] rounded-full bg-background">
            <CompanionAvatar presence={IDLE_PRESENCE} voice={null} sentences={null} look={null} material={material} name={name} size={PREVIEW_SIZE_PX} />
          </div>
          <div className="min-w-0 space-y-3">
            <SettingRow
              label={title}
              description={t('voiceSettings.companion.material.description', {
                name,
                defaultValue: '{{name}} is drawn as an instrument, not a face: a chrome core that breathes, lobes with her voice and locks onto what she reads. Choose what it is made of.',
              })}
              className="min-w-0 p-0"
            >
              {null}
            </SettingRow>
            <SegmentedControl label={title} options={options.map(({ value, label }) => ({ value, label }))} value={material} onChange={setMaterial} />
            <p role="status" className="text-pretty text-xs leading-relaxed text-muted-foreground">{chosen.detail}</p>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
