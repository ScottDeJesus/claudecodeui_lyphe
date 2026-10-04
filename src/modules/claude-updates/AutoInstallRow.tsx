import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ClaudeAutoInstall } from '@/shared/claude-update-types';
import { SettingRow, Switch } from '@/shared/ui';

type AutoInstallRowProps = {
  autoInstall: ClaudeAutoInstall;
  /** The position the operator asked for. The position drawn is always the report's, never this. */
  onChange: (enabled: boolean) => void;
};

/**
 * Used by the claude-updates settings tab: the switch that lets the app install an update itself, and
 * the one line that says why an update on offer has not installed yet.
 *
 * It composes `SettingRow` and the library `Switch` — the pair `SettingsToggle` wraps — rather than
 * `SettingsToggle` itself: that component belongs to the settings module, which already renders this
 * tab, so importing it back would make the two modules depend on each other.
 *
 * The status line exists only while `waiting` is set, and the server sets it only while an update is
 * on offer and the switch is on — so the line never explains a wait that is not happening.
 */
export function AutoInstallRow({ autoInstall, onChange }: AutoInstallRowProps) {
  const { t } = useTranslation('settings');
  const label = t('updates.autoInstall.label', { defaultValue: 'Install updates automatically' });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <SettingRow
        icon={<Download className="h-4 w-4" />}
        label={label}
        description={t('updates.autoInstall.description', {
          defaultValue: 'Only when no Claude session is working. Checked every 5 minutes.',
        })}
      >
        <Switch checked={autoInstall.enabled} onChange={onChange} label={label} />
      </SettingRow>
      {autoInstall.waiting !== null && (
        <p role="status" className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t('updates.autoInstall.waiting', {
            reason: autoInstall.waiting,
            defaultValue: 'Not installed yet — {{reason}}',
          })}
        </p>
      )}
    </div>
  );
}
