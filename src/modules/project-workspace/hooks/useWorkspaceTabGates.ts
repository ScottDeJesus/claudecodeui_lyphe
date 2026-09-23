import { useBrowserUseEnabled } from '@/modules/browser-use';
import { useHeal } from '@/modules/heal';
import { useMemoryIntake } from '@/modules/memory-intake';
import { useArcs, useRunnerRuns } from '@/modules/plan-runner';
import { useTasksSettings } from '@/modules/task-master';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { AppTab } from '@/shared/types';

export type WorkspaceTabGates = {
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  shouldShowShellTab: boolean;
  /** True while the Memory tab belongs on the bar — the sticky rule below decides it. */
  shouldShowMemoryTab: boolean;
  /** How many memories are waiting. Zero whenever the lane could not be read, so the pill and the gate agree. */
  memoryPendingCount: number;
  /** True while the Runner tab belongs on the bar — the same sticky rule the Memory tab takes. */
  shouldShowRunnerTab: boolean;
  /** How many runs the lane is carrying, for the tab's count pill. Paused runs are counted: they are still runs. */
  runnerCount: number;
  /** True while the Heal tab belongs on the bar — the same sticky, data-gated rule the Memory and Runner tabs take. */
  shouldShowHealTab: boolean;
  /** How much live friction the ledger holds, for the tab's count pill. */
  healCount: number;
  /**
   * Always true. The Universe tab is GLOBAL — not per project or per session, exactly as the
   * kanban board is — so it is here whatever the workspace is pointed at and nothing can take it
   * off the bar. The gate exists only so the strip, the palette and the pane read the same shape.
   */
  shouldShowUniverseTab: boolean;
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
 * snap-back effect exists for it, because the gate itself never turns off mid-act. The Runner tab
 * is the SECOND DATA-gated, sticky tab and takes that rule whole: it appears while a run is in
 * motion OR an arc the runner is still walking is unfinished — the arc deck draws in that same
 * pane — it stays while it is the selected tab even once the last run ends and the last arc is
 * finished, and it has no snap-back effect either. The Heal tab is the THIRD and takes the same rule whole: it appears
 * while the ledger holds live friction and stays while it is the selected tab. The other three are
 * PREFERENCE-gated and keep their snap-backs in WorkspaceMain.
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
  const { count: runnerCount } = useRunnerRuns();
  // The deck's own count, off the same bus the runs come from: an arc the runner has not finished
  // keeps the Runner tab on the bar by itself, because the gallery lives in that tab's pane.
  const { count: arcCount } = useArcs();
  // The live count off the Heal tab's own context — the one poll of the ledger, read here in the
  // sidebar, the main region and the palette as well as in the panel. Zero until a read has landed
  // AND while one is failing, so the pill and the gate can never disagree; an unreadable ledger is
  // not friction, and the tab is reachable all the same by pressing where it sat.
  const { summary } = useHeal();
  const healCount = summary?.live ?? 0;

  return {
    shouldShowTasksTab: Boolean(tasksEnabled && isTaskMasterInstalled),
    shouldShowBrowserTab: browserUseEnabled,
    shouldShowShellTab: !hideShellTab,
    shouldShowMemoryTab: pendingCount > 0 || activeTab === 'memory',
    memoryPendingCount: pendingCount,
    shouldShowRunnerTab: runnerCount > 0 || arcCount > 0 || activeTab === 'runner',
    runnerCount,
    shouldShowHealTab: healCount > 0 || activeTab === 'heal',
    healCount,
    // The literal true, never a reading: the Universe tab is global, the way the kanban board is.
    shouldShowUniverseTab: true,
    preferencesSettled,
  };
}
