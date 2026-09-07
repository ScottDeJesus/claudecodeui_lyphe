import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '@/shared/ui';
import type { ProjectSortOrder } from '@/shared/types';
import { LanguageSelector } from '@/modules/i18n';
import { useTasksSettings } from '@/modules/task-master';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
};

/** Rendered by Settings for the "appearance" tab, covering theme, language, which tabs the workspace shows and project sorting. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { hideShellTab } = useUiPreferences();
  const setPreference = useSetUiPreference();
  // "Hide the Tasks tab" is the Tasks tab's own enable switch, read from the one store that
  // already owns it. A second boolean here would let the two controls disagree.
  const { tasksEnabled, setTasksEnabled, isTaskMasterInstalled } = useTasksSettings();

  // The Tasks tab needs TaskMaster installed before it can exist at all, so without it this
  // switch cannot do the thing it names. It says so and stops taking clicks rather than moving
  // and changing nothing — the same honesty the Tasks settings tab gives the same store, which
  // hides its switch behind that check and explains itself instead. `null` is the check still
  // in flight, and reads as "not yet known" rather than "no", so the row does not flicker.
  const tasksTabUnavailable = isTaskMasterInstalled === false;

  return (
    <div className="space-y-8">
      <SettingsSection title={t('appearanceSettings.darkMode.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.darkMode.label')}
            description={t('appearanceSettings.darkMode.description')}
          >
            <DarkModeToggle ariaLabel={t('appearanceSettings.darkMode.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearance.workspaceTabs.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearance.workspaceTabs.hideShell.label')}
            description={t('appearance.workspaceTabs.hideShell.description')}
          >
            <SettingsToggle
              checked={hideShellTab}
              onChange={(value) => setPreference('hideShellTab', value)}
              ariaLabel={t('appearance.workspaceTabs.hideShell.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearance.workspaceTabs.hideTasks.label')}
            description={t(
              tasksTabUnavailable
                ? 'appearance.workspaceTabs.hideTasks.unavailable'
                : 'appearance.workspaceTabs.hideTasks.description',
            )}
          >
            <SettingsToggle
              checked={!tasksEnabled}
              onChange={(value) => setTasksEnabled(!value)}
              ariaLabel={t('appearance.workspaceTabs.hideTasks.label')}
              disabled={tasksTabUnavailable}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
