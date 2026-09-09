import { memo, useMemo } from 'react';

import { CommandPalette } from '@/modules/command-palette';
import { useProjectCommandState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceTabGates } from '@/modules/project-workspace/hooks/useWorkspaceTabGates';
import type { AppTab } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to bind this module's project state to the command-palette module. */
function ProjectCommandPalette() {
  const {
    selectedProject,
    handleNewSession,
    openSettings,
    activeTab,
    setActiveTab,
  } = useProjectCommandState();

  const {
    shouldShowShellTab,
    shouldShowTasksTab,
    shouldShowBrowserTab,
    shouldShowMemoryTab,
  } = useWorkspaceTabGates(activeTab);

  // Every gate comes off the one hook the tab strip reads, so the palette can never disagree
  // with the bar about which tabs exist — it used to recompute three of them from the same
  // contexts, which is a second source for a decision already made, and the Memory tab's sticky
  // rule cannot be recomputed privately at all without a second copy of the rule. Browser is
  // still offered even though NAV_TABS has no row for it yet: a list that quietly omits a gate
  // is a list that puts the next row someone adds behind a filter nobody remembers writing.
  // Plugin tabs remain the one exclusion — they are discovered at runtime and the palette has no
  // rows for them at all. Memoised because a fresh array on every render would defeat the memo().
  const visibleTabs = useMemo<AppTab[]>(() => {
    const tabs: AppTab[] = ['chat', 'files', 'git'];
    if (shouldShowShellTab) tabs.push('shell');
    if (shouldShowTasksTab) tabs.push('tasks');
    if (shouldShowBrowserTab) tabs.push('browser');
    if (shouldShowMemoryTab) tabs.push('memory');
    return tabs;
  }, [shouldShowBrowserTab, shouldShowMemoryTab, shouldShowShellTab, shouldShowTasksTab]);

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
