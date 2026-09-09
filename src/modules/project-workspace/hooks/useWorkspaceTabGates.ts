import { useBrowserUseEnabled } from '@/modules/browser-use';
import { useMemoryIntake } from '@/modules/memory-intake';
import { useTasksSettings } from '@/modules/task-master';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { AppTab } from '@/shared/types';

export type WorkspaceTabGates = {
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  shouldShowShellTab: boolean;
  /** True while the Memory tab belongs on the bar — the sticky rule below decides it. */
  shouldShowMemoryTab: boolean;
  /** How many memories are waiting. Zero whenever Descent could not be read, so the pill and the gate agree. */
  memoryPendingCount: number;
  /** True once the UI preference store has answered — the snap-back effects wait on it. */
  preferencesSettled: boolean;
};

/**
 * Which optional workspace tabs are on the bar.
 *
 * The strip and the panes it switches between live in different regions now — the tabs render in
 * the sidebar, the panes in the main region — so the gates are read HERE and nowhere else.
 * Two components each computing them from `useTasksSettings` / `useBrowserUseEnabled` /
 * `useUiPreferences` / `useMemoryIntake` would be two sources for one decision, and they would
 * disagree the moment one of them is given a different rule; every reading below comes off the
 * same source in the same order, so a strip and a pane cannot diverge about the RULE a tab
 * exists by.
 *
 * One reading is weaker than that, and it is worth naming rather than papering over:
 * `useBrowserUseEnabled` is not a context but a per-call-site hook holding its own `useState`
 * and its own fetch, so the three callers below hold three independent copies of that one
 * boolean and can disagree for the frame between their fetches landing. Pre-existing, and the
 * cure is a context for it — never a fourth private reading here.
 *
 * The Memory tab is STICKY, which is the whole reason `activeTab` is an argument: once it is the
 * tab a person is standing in it stays on the bar until they choose another one, so filing the
 * last pending memory empties the panel rather than taking the tab out from under them — and no
 * snap-back effect exists for it, because the gate itself never turns off mid-act. The other
 * three are PREFERENCE-gated and keep their snap-backs in WorkspaceMain.
 *
 * Three call sites read this now — WorkspaceMain, ProjectSidebarRegion and ProjectCommandPalette
 * — each passing its own `activeTab`. The palette used to recompute the gates privately from the
 * same contexts; it does not any more, so there are three callers and exactly one rule.
 */
export function useWorkspaceTabGates(activeTab: AppTab): WorkspaceTabGates {
  const { hideShellTab, settled: preferencesSettled } = useUiPreferences();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const browserUseEnabled = useBrowserUseEnabled();
  const { pendingCount } = useMemoryIntake();

  return {
    shouldShowTasksTab: Boolean(tasksEnabled && isTaskMasterInstalled),
    shouldShowBrowserTab: browserUseEnabled,
    shouldShowShellTab: !hideShellTab,
    shouldShowMemoryTab: pendingCount > 0 || activeTab === 'memory',
    memoryPendingCount: pendingCount,
    preferencesSettled,
  };
}
