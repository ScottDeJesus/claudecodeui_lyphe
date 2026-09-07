import { memo, useMemo } from 'react';

import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { CommandPalette } from '@/modules/command-palette';
import { useBrowserUseEnabled } from '@/modules/browser-use';
import { useTasksSettings } from '@/modules/task-master';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { AppTab } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to bind this module's project state to the command-palette module. */
function ProjectCommandPalette() {
  const {
    selectedProject,
    handleNewSession,
    openSettings,
    setActiveTab,
  } = useProjectCommandState();

  const { hideShellTab } = useUiPreferences();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const browserUseEnabled = useBrowserUseEnabled();

  // Every gate WorkspaceTabs applies to a built-in tab, applied once here, so the palette can
  // only offer a jump to a tab that is actually on the bar. Browser is included even though
  // NAV_TABS has no row for it yet: a list that quietly omits a gate is a list that puts the
  // next row someone adds behind a filter nobody remembers writing. Plugin tabs are the one
  // exclusion — they are discovered at runtime and the palette has no rows for them at all.
  // Memoised because a fresh array on every render would defeat the memo() below.
  const visibleTabs = useMemo<AppTab[]>(() => {
    const tabs: AppTab[] = ['chat', 'files', 'git'];
    if (!hideShellTab) tabs.push('shell');
    if (tasksEnabled && isTaskMasterInstalled) tabs.push('tasks');
    if (browserUseEnabled) tabs.push('browser');
    return tabs;
  }, [browserUseEnabled, hideShellTab, isTaskMasterInstalled, tasksEnabled]);

  return (
    <CommandPalette
      selectedProject={selectedProject}
      onStartNewChat={handleNewSession}
      onOpenSettings={openSettings}
      onShowTab={setActiveTab}
      visibleTabs={visibleTabs}
    />
  );
}

export default memo(ProjectCommandPalette);
