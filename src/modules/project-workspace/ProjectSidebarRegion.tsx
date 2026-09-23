import { memo, useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { AppSwitcherDock } from '@/modules/app-switcher';
import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceTabGates } from '@/modules/project-workspace/hooks/useWorkspaceTabGates';
import WorkspaceTabs from '@/modules/project-workspace/WorkspaceTabs';
import { Sidebar } from '@/modules/sidebar';
import type { ProjectWorkspaceShellProps } from '@/shared/types';

/** Rendered by ProjectWorkspaceShell to host the sidebar module, docked on desktop and as a drawer on mobile. */
function ProjectSidebarRegion({
  isMobile,
}: Pick<ProjectWorkspaceShellProps, 'isMobile'>) {
  const { t } = useTranslation('common');
  const { sidebarOpen, setSidebarOpen, sidebarSharedProps, activeTab, setActiveTab } = useProjectSidebarState();
  const {
    shouldShowTasksTab,
    shouldShowBrowserTab,
    shouldShowShellTab,
    shouldShowMemoryTab,
    memoryPendingCount,
    shouldShowRunnerTab,
    runnerCount,
    shouldShowHealTab,
    healCount,
  } = useWorkspaceTabGates(activeTab);

  // Choosing a tab on a phone means choosing a pane the drawer is covering, so the drawer gets
  // out of the way. On desktop the sidebar is docked and this closes nothing.
  const handleTabChange = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, setSidebarOpen]);

  // The workspace tab strip, rendered INTO the sidebar as a slot node. The sidebar module never
  // imports project-workspace — the dependency points one way, the way it already did.
  // Gated on a selected project because with none the main region shows its empty state, and a
  // strip that switches between panes that are not there is a row of dead buttons.
  const tabs = sidebarSharedProps.selectedProject ? (
    <WorkspaceTabs
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      shouldShowTasksTab={shouldShowTasksTab}
      shouldShowBrowserTab={shouldShowBrowserTab}
      shouldShowShellTab={shouldShowShellTab}
      shouldShowMemoryTab={shouldShowMemoryTab}
      memoryPendingCount={memoryPendingCount}
      shouldShowRunnerTab={shouldShowRunnerTab}
      runnerCount={runnerCount}
      shouldShowHealTab={shouldShowHealTab}
      healCount={healCount}
      onTabChange={handleTabChange}
    />
  ) : null;

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  if (!isMobile) {
    return (
      <div className="h-full flex-shrink-0 border-r border-border/50">
        <Sidebar {...sidebarSharedProps} tabs={tabs} leading={<AppSwitcherDock />} />
      </div>
    );
  }

  return (
    // The drawer is the mobile frame's second layer, so it takes the status-bar offset with the
    // shell (`pwa-status-clear`, src/index.css) — its panel's title row and search field are the
    // chrome that must clear the notch. The scrim below it deliberately does not: a scrim covers
    // the whole screen, and keeping it full-bleed is what stops a strip of the app showing above
    // the drawer.
    <div
      className={`pwa-status-clear fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
        sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
      }`}
    >
      <button
        className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
        onClick={handleBackdropClick}
        onTouchStart={handleBackdropTouch}
        aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
      />
      <div
        className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-[20.5rem] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onClick={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <Sidebar {...sidebarSharedProps} tabs={tabs} leading={<AppSwitcherDock />} />
      </div>
    </div>
  );
}

export default memo(ProjectSidebarRegion);
