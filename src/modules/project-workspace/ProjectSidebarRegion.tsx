import { memo, useCallback } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectSidebarState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { useWorkspaceTabGates } from '@/modules/project-workspace/hooks/useWorkspaceTabGates';
import WorkspaceRail from '@/modules/project-workspace/WorkspaceRail';
import WorkspaceTabs from '@/modules/project-workspace/WorkspaceTabs';
import { Sidebar } from '@/modules/sidebar';
import type { ProjectWorkspaceShellProps, SidebarListState } from '@/shared/types';

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
    runnerCount,
    runnerWaiting,
    runnerTone,
    shouldShowHealTab,
    healCount,
    cerberusNeeds,
  } = useWorkspaceTabGates(activeTab);

  // Choosing a tab on a phone means choosing a pane the drawer is covering, so the drawer gets
  // out of the way. On desktop the sidebar is docked and this closes nothing.
  const handleTabChange = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, setSidebarOpen]);

  // The workspace tab strip, rendered INTO the sidebar as a slot node. The sidebar module never
  // imports project-workspace — the dependency points one way, the way it already did.
  // Drawn with no project selected too: every pane draws now (the house views need no project, and
  // the ones that read it show the choose-a-project body), so none of the strip's buttons is dead.
  const tabs = (
    <WorkspaceTabs
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      shouldShowTasksTab={shouldShowTasksTab}
      shouldShowBrowserTab={shouldShowBrowserTab}
      shouldShowShellTab={shouldShowShellTab}
      shouldShowMemoryTab={shouldShowMemoryTab}
      memoryPendingCount={memoryPendingCount}
      runnerCount={runnerCount}
      runnerWaiting={runnerWaiting}
      runnerTone={runnerTone}
      shouldShowHealTab={shouldShowHealTab}
      healCount={healCount}
      cerberusNeeds={cerberusNeeds}
      onTabChange={handleTabChange}
    />
  );

  // The views rail, rendered INTO the sidebar through its `rail` slot, as the strip above is through `tabs`: the rail is
  // this module's and the list is the sidebar's, so the sidebar tells the rail whether the list is collapsed and never
  // imports it. Stable on `isMobile`, so the sidebar's render does not hand the slot a new function each time.
  const renderRail = useCallback(
    (list: SidebarListState) => <WorkspaceRail list={list} isMobile={isMobile} />,
    [isMobile],
  );

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleBackdropTouch = useCallback((event: ReactTouchEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  // ONE TREE FOR BOTH LAYOUTS. The sidebar is docked from 768px and a drawer below it, and the two
  // used to be two different returns — so crossing 768px (a phone turning to landscape, a window
  // dragged across the line) unmounted the whole sidebar and mounted a new one, and with it the
  // Settings dialog the sidebar hosts: the dialog stayed open (its flag lives above) but every bit
  // of its state started again, the open tab first among them, back on Agents. Here the wrapper's
  // classes change and its children keep their places, so React keeps `Sidebar` mounted: slot 0 is
  // the scrim or nothing, slot 1 is the panel. The drawer's handlers exist on the drawer only — on
  // the docked column a stopped click would never reach the document listeners under it.
  //
  // The drawer is the mobile frame's second layer, so it takes the status-bar offset with the
  // shell (`pwa-status-clear`, src/index.css) — its panel's title row and search field are the
  // chrome that must clear the notch. The scrim deliberately does not: a scrim covers the whole
  // screen, and keeping it full-bleed is what stops a strip of the app showing above the drawer.
  const stopPropagation = isMobile ? (event: ReactMouseEvent | ReactTouchEvent) => event.stopPropagation() : undefined;

  return (
    <div
      className={isMobile
        ? `pwa-status-clear fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
          sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
        }`
        : 'h-full flex-shrink-0 border-r border-border/50'}
    >
      {isMobile && (
        <button
          className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onClick={handleBackdropClick}
          onTouchStart={handleBackdropTouch}
          aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
        />
      )}
      <div
        className={isMobile
          ? `relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-[20.5rem] ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`
          : 'h-full'}
        onClick={stopPropagation}
        onTouchStart={stopPropagation}
      >
        <Sidebar {...sidebarSharedProps} tabs={tabs} rail={renderRail} />
      </div>
    </div>
  );
}

export default memo(ProjectSidebarRegion);
