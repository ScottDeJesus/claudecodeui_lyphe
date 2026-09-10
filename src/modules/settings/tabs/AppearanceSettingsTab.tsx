import { useTranslation } from 'react-i18next';

import { DarkModeToggle, Select, Stepper } from '@/shared/ui';
import type { AgentSettingsProject, ProjectSortOrder } from '@/shared/types';
import { LanguageSelector } from '@/modules/i18n';
import { useTasksSettings } from '@/modules/task-master';
import { useSetUiPreference, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useTheme } from '@/shared/context/ThemeContext';
import { useChatFontSize } from '@/shared/hooks/useChatFontSize';
import { useSimpleChatListPreferences } from '@/shared/hooks/useSimpleChatListPreferences';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  projects?: AgentSettingsProject[];
};

/** Rendered by Settings for the "appearance" tab, covering theme, language, which tabs the workspace shows, the simple chat list and project sorting. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  projects = [],
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  // The sun-follow switch reads the same theme context the Dark Mode switch beside it writes,
  // so the two can never disagree about who is in charge of the colour.
  const { followsSun, setFollowsSun } = useTheme();
  const { hideShellTab, showRawParameters, showThinking, sendByCtrlEnter } = useUiPreferences();
  // The transcript's reading size, read and written through the one hook the chat pane reads —
  // so the stepper and the messages can never disagree about how big the text is.
  const chatFontSize = useChatFontSize();
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

  // The simple chat list's own switch and default project, read and written through the one
  // hook every consumer (sidebar, settings, chat composer) shares — never uiPreferences, whose
  // typed boolean reducer has no room for a project id.
  const {
    enabled: simpleChatListEnabled,
    projectId: simpleChatProjectId,
    setEnabled: setSimpleChatListEnabled,
    setProjectId: setSimpleChatProjectId,
  } = useSimpleChatListPreferences();

  // Sorted by display name so the picker reads alphabetically regardless of the order
  // `projects` arrived in; the value stays `project.name` — the id the sidebar resolves by.
  const simpleChatProjectOptions = [...projects]
    .map((project) => ({ value: project.name, label: project.displayName ?? project.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

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
          <SettingsRow
            label={t('appearanceSettings.followSun.label')}
            description={t('appearanceSettings.followSun.description')}
          >
            <SettingsToggle
              checked={followsSun}
              onChange={setFollowsSun}
              ariaLabel={t('appearanceSettings.followSun.label')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearance.text.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearance.text.chatFontSize.label')}
            description={t('appearance.text.chatFontSize.description')}
          >
            <Stepper
              value={t('appearance.text.chatFontSize.value', { size: chatFontSize.size })}
              onDecrease={chatFontSize.decrease}
              onIncrease={chatFontSize.increase}
              canDecrease={chatFontSize.canDecrease}
              canIncrease={chatFontSize.canIncrease}
              decreaseLabel={t('appearance.text.chatFontSize.decrease')}
              increaseLabel={t('appearance.text.chatFontSize.increase')}
              ariaLabel={t('appearance.text.chatFontSize.label')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* These three moved here whole when the quick-settings drawer went. They were the only
          settings that drawer alone could reach, so deleting its handle without rehoming them
          would have made three switches unreachable rather than tidier. */}
      <SettingsSection title={t('appearance.toolDisplay.title')}>
        <SettingsCard divided>
          <SettingsRow label={t('appearance.toolDisplay.showThinking')}>
            <SettingsToggle
              checked={showThinking}
              onChange={(value) => setPreference('showThinking', value)}
              ariaLabel={t('appearance.toolDisplay.showThinking')}
            />
          </SettingsRow>

          <SettingsRow label={t('appearance.toolDisplay.showRawParameters')}>
            <SettingsToggle
              checked={showRawParameters}
              onChange={(value) => setPreference('showRawParameters', value)}
              ariaLabel={t('appearance.toolDisplay.showRawParameters')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearance.inputSettings.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearance.inputSettings.sendByCtrlEnter')}
            description={t('appearance.inputSettings.sendByCtrlEnterDescription')}
          >
            <SettingsToggle
              checked={sendByCtrlEnter}
              onChange={(value) => setPreference('sendByCtrlEnter', value)}
              ariaLabel={t('appearance.inputSettings.sendByCtrlEnter')}
            />
          </SettingsRow>
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

      <SettingsSection title={t('appearance.sidebar.title')}>
        <SettingsCard divided>
          <SettingsRow
            label={t('appearance.sidebar.simpleChatList.label')}
            description={t('appearance.sidebar.simpleChatList.description')}
          >
            <SettingsToggle
              checked={simpleChatListEnabled}
              onChange={setSimpleChatListEnabled}
              ariaLabel={t('appearance.sidebar.simpleChatList.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearance.sidebar.simpleChatProject.label')}
            description={t('appearance.sidebar.simpleChatProject.description')}
          >
            <Select
              ariaLabel={t('appearance.sidebar.simpleChatProject.label')}
              value={simpleChatProjectId ?? ''}
              options={simpleChatProjectOptions}
              placeholder={t('appearance.sidebar.simpleChatProject.label')}
              onChange={(next) => setSimpleChatProjectId(next || null)}
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
