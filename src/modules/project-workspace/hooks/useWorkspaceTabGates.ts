import { useBrowserUseEnabled } from '@/modules/browser-use';
import { useCerberusNeeds } from '@/modules/cerberus';
import { useDispatcherPlans } from '@/modules/dispatcher';
import { useHeal } from '@/modules/heal';
import { useMemoryIntake } from '@/modules/memory-intake';
import { useTasksSettings } from '@/modules/task-master';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { AppTab, Tone } from '@/shared/types';

export type WorkspaceTabGates = {
  shouldShowTasksTab: boolean;
  shouldShowBrowserTab: boolean;
  shouldShowShellTab: boolean;
  /** True while the Memory tab belongs on the bar — the sticky rule below decides it. */
  shouldShowMemoryTab: boolean;
  /** How many memories are waiting. Zero whenever the lane could not be read, so the pill and the gate agree. */
  memoryPendingCount: number;
  /** How many plans the lane DRAWS, for the tab's count pill. Paused and queued plans are counted: they are still plans. A hidden one is not. */
  runnerCount: number;
  /**
   * How many prompts the drawn plans are waiting on (`useDispatcherPlans.waiting`), for the tab's
   * attention mark: the strip draws the Roadmap tab's dot amber and says the count in words while
   * this is above zero. Zero leaves the tab exactly as it was.
   */
  runnerWaiting: number;
  /** What the drawn plans are doing (`useDispatcherPlans.tone`), the colour of the tab's dot: blue while anything runs, green only once all of it is finished. */
  runnerTone: Tone | null;
  /** True while the Heal tab belongs on the bar — the same sticky, data-gated rule the Memory tab takes. */
  shouldShowHealTab: boolean;
  /** How much live friction the ledger holds, for the tab's count pill. */
  healCount: number;
  /** How many checks need a person right now, for the Cerberus tab's count pill. Zero until the first read answers. The tab itself is never gated: it is on the bar whatever the fleet says. */
  cerberusNeeds: number;
};

/**
 * Which optional tabs are on the old two-row strip (WorkspaceTabs), and the counts it draws.
 *
 * ProjectSidebarRegion is the one reader left: it takes the gates here and hands them to the strip as
 * props, so the strip never computes a gate of its own. The palette and the main region read the
 * views list (`useWorkspaceViews`) instead, which carries no count and no data-gated tab.
 *
 * The Memory tab is STICKY, which is the whole reason `activeTab` is an argument: once it is the
 * tab a person is standing in it stays on the bar until they choose another one, so filing the
 * last pending memory empties the panel rather than taking the tab out from under them. The Heal
 * tab is the SECOND such data-gated, sticky tab and takes that rule whole: it appears while the
 * ledger holds live friction and stays while it is the selected tab. The Roadmap tab is not gated by
 * data at all — it is the operator's home, ungated like Universe.
 *
 * `useBrowserUseEnabled` is not a context but a per-call-site hook holding its own `useState` and its
 * own fetch, so the Browser tab appears a frame after the others while that fetch lands.
 */
export function useWorkspaceTabGates(activeTab: AppTab): WorkspaceTabGates {
  const { hideShellTab } = useUiPreferences();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const browserUseEnabled = useBrowserUseEnabled();
  const { pendingCount } = useMemoryIntake();
  // The dispatcher's plans ARE the Roadmap tab's In flight list — the arcs' decks and the cards they
  // hold. The pill counts the cards drawn, and `waiting` rides alongside as the tab's ATTENTION: the
  // asks those cards owe the operator, which the pill (a count of plans) cannot say. Neither gates
  // the tab: it is on the bar with an empty lane too.
  const { count: runnerCount, waiting: runnerWaiting, tone: runnerTone } = useDispatcherPlans();
  // The live count off the Heal tab's own context — the one poll of the ledger, read here in the
  // sidebar as well as in the panel. Zero until a read has landed AND while one is failing, so the
  // pill and the gate can never disagree; an unreadable ledger is not friction, and the tab is
  // reachable all the same by pressing where it sat.
  const { summary } = useHeal();
  const healCount = summary?.live ?? 0;
  // The fleet's count off Cerberus's own provider — the one read of the overview, shared with the tab's
  // header, so the strip's pill and the tab's headline are the same number. Zero until a read has landed.
  const cerberusNeeds = useCerberusNeeds();

  return {
    shouldShowTasksTab: Boolean(tasksEnabled && isTaskMasterInstalled),
    shouldShowBrowserTab: browserUseEnabled,
    shouldShowShellTab: !hideShellTab,
    shouldShowMemoryTab: pendingCount > 0 || activeTab === 'memory',
    memoryPendingCount: pendingCount,
    runnerCount,
    runnerWaiting,
    runnerTone,
    shouldShowHealTab: healCount > 0 || activeTab === 'heal',
    healCount,
    cerberusNeeds,
  };
}
