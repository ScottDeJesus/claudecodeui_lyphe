import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tabs } from '@/shared/ui';
import type { AppTab } from '@/shared/types';
import { usePlugins } from '@/modules/plugins';

type WorkspaceTabsProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  shouldShowShellTab: boolean;
};

type BuiltInTab = {
  id: AppTab;
  labelKey: string;
};

const BASE_TABS: BuiltInTab[] = [
  { id: 'chat',  labelKey: 'tabs.chat' },
  { id: 'shell', labelKey: 'tabs.shell' },
  { id: 'files', labelKey: 'tabs.files' },
  { id: 'git',   labelKey: 'tabs.git' },
];

const BROWSER_TAB: BuiltInTab = { id: 'browser', labelKey: 'tabs.browser' };

const TASKS_TAB: BuiltInTab = { id: 'tasks', labelKey: 'tabs.tasks' };

/** Rendered by WorkspaceHeader to show the built-in workspace tabs plus any enabled plugin tabs. */
export default function WorkspaceTabs({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  shouldShowShellTab,
}: WorkspaceTabsProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  // Every gate arrives as a prop. This component reading a preference context of its own
  // would be a second source for a decision WorkspaceMain has already made — and the two
  // would disagree the moment one of them is given a different rule.
  const builtInTabs: BuiltInTab[] = [
    ...BASE_TABS.filter((tab) => tab.id !== 'shell' || shouldShowShellTab),
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
  ];

  // Plugin tabs keep their place at the end of the strip, after every built-in one, so a newly
  // enabled plugin never moves the tab a person's hand already knows the position of.
  const tabs = [
    ...builtInTabs.map((tab) => ({ id: tab.id as string, label: t(tab.labelKey) })),
    ...plugins.filter((plugin) => plugin.enabled).map((plugin) => ({
      id: `plugin:${plugin.name}`,
      label: plugin.displayName,
    })),
  ];

  return (
    <Tabs
      tabs={tabs}
      active={activeTab}
      onChange={(id) => setActiveTab(id as AppTab)}
      ariaLabel={t('tabs.views', { defaultValue: 'Workspace views' })}
    />
  );
}
