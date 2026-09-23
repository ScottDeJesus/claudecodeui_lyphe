import {
  Activity,
  Brain,
  Clock,
  Coins,
  FolderTree,
  GitBranch,
  Globe,
  HeartPulse,
  KanbanSquare,
  ListTodo,
  MessageSquare,
  Orbit,
  Terminal,
} from 'lucide-react';
import type { ComponentType, Dispatch, SetStateAction } from 'react';
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
  shouldShowMemoryTab: boolean;
  /** How many memories are waiting, for the tab's count pill. Zero draws no pill at all. */
  memoryPendingCount: number;
  shouldShowRunnerTab: boolean;
  /** How many runs are on the lane, for the tab's count pill. Zero draws no pill at all. */
  runnerCount: number;
  shouldShowHealTab: boolean;
  /** How much live friction the ledger holds, for the tab's count pill. Zero draws no pill at all. */
  healCount: number;
  /** Run after the tab actually changes — the mobile drawer closes on it. */
  onTabChange?: () => void;
};

type BuiltInTab = {
  id: AppTab;
  labelKey: string;
  /** Drawn instead of the label. The translated label stays the tab's accessible name. */
  icon: ComponentType<{ className?: string; strokeWidth?: string | number }>;
};

// One glyph per view, each naming the thing the view actually shows rather than an action:
// a speech bubble for the conversation, a terminal for the shell, a file tree for the files,
// a branch for git, lanes for the board, a globe for the browser, a checklist for tasks, a
// brain for memory, an orbit for the sky, a pulse for the runner — the one view whose
// subject is something moving on its own — a clock for what the box runs on a schedule, and a
// heartbeat for the heal reflex, the view whose subject is the house mending itself, and coins
// for Jev, the view whose subject is what the house spends on asking.

// Row one — views of THIS project: what each one shows changes with the project selected.
const PROJECT_BASE_TABS: BuiltInTab[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: FolderTree },
  { id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

// Row two — the house: surfaces that read the same whichever project is open.
const HOUSE_BASE_TABS: BuiltInTab[] = [
  // Always visible, and so carrying no gate at all — the convention chat, files and git
  // already keep. The board is global, not per project or per session: it is here whatever
  // the workspace is pointed at.
  { id: 'kanban', labelKey: 'tabs.kanban', icon: KanbanSquare },
  // Global in the same way the board is — the sky is not a per-project or per-session view —
  // and so it carries no gate either.
  { id: 'universe', labelKey: 'tabs.universe', icon: Orbit },
  // The registry is about the box itself, not the open project, so it too carries no gate.
  { id: 'schedules', labelKey: 'tabs.schedules', icon: Clock },
];

const BROWSER_TAB: BuiltInTab = { id: 'browser', labelKey: 'tabs.browser', icon: Globe };

const TASKS_TAB: BuiltInTab = { id: 'tasks', labelKey: 'tabs.tasks', icon: ListTodo };

const MEMORY_TAB: BuiltInTab = { id: 'memory', labelKey: 'tabs.memory', icon: Brain };

const RUNNER_TAB: BuiltInTab = { id: 'runner', labelKey: 'tabs.runner', icon: Activity };

const HEAL_TAB: BuiltInTab = { id: 'heal', labelKey: 'tabs.heal', icon: HeartPulse };

// Ungated, like the board: Jev's spend is a fact about the box whatever project is open, and a
// tab the operator opens to make a money decision must not hide on a quiet day.
const JEV_TAB: BuiltInTab = { id: 'jev', labelKey: 'tabs.jev', icon: Coins };

/**
 * Rendered by ProjectSidebarRegion, under the wordmark, to show the built-in workspace tabs plus
 * any enabled plugin tabs — in TWO rows, split by kind.
 *
 * Row one is this project: Chat, Shell, Files, Git, Browser, Tasks — views whose content changes
 * with the project selected. Row two is the house: Kanban, Universe, Schedules, Memory, Runner,
 * Heal, Jev, then plugin tabs — surfaces that read the same whichever project is open, which is why
 * every count dot the strip carries lives there. One row held both kinds until it outgrew the
 * sidebar: measured at 328px (a 304px strip, 36px a glyph), nine tabs made 340px of content and
 * the ninth sat past the edge with no affordance at all, three more tabs still to come. Split by
 * kind, each row answers one question, and neither is near its width at today's gates.
 *
 * Both rows are `underline`, the sidebar's register, and share ONE `activeTab`: the row that
 * does not hold it draws no indicator. Neither row wraps — a row that reflowed would move every
 * tab a hand already knows the position of each time one is toggled — and a row that outgrows
 * its width collapses its trailing tabs behind the strip's own More trigger (`overflowLabel`,
 * Tabs.tsx), never the tab a person is standing in.
 *
 * The built-in tabs are icon-only — a glyph each, named by `title` and `aria-label`. Plugin tabs
 * keep their words: a plugin supplies a display name and no glyph, and a guessed icon would name
 * it wrong.
 */
export default function WorkspaceTabs({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  shouldShowShellTab,
  shouldShowMemoryTab,
  memoryPendingCount,
  shouldShowRunnerTab,
  runnerCount,
  shouldShowHealTab,
  healCount,
  onTabChange,
}: WorkspaceTabsProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  // Every gate arrives as a prop. This component reading a preference context of its own would
  // be a second source for a decision `useWorkspaceTabGates` has already made — and the two would
  // disagree the moment one of them is given a different rule.
  const projectTabs: BuiltInTab[] = [
    ...PROJECT_BASE_TABS.filter((tab) => tab.id !== 'shell' || shouldShowShellTab),
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
  ];
  const houseTabs: BuiltInTab[] = [
    ...HOUSE_BASE_TABS,
    ...(shouldShowMemoryTab ? [MEMORY_TAB] : []),
    ...(shouldShowRunnerTab ? [RUNNER_TAB] : []),
    ...(shouldShowHealTab ? [HEAL_TAB] : []),
    JEV_TAB,
  ];

  // Three tabs carry a count, and each only while there is something to count: `undefined` is what
  // tells `Tabs` to draw no pill at all, so a queue that has just been emptied — or a lane whose
  // last run has just ended under the person standing in the tab — leaves a bare glyph rather
  // than a zero nobody needs to read. All three tabs are sticky, so each outlives its own count.
  const countFor = (id: AppTab): number | undefined => {
    if (id === 'memory') return memoryPendingCount > 0 ? memoryPendingCount : undefined;
    if (id === 'runner') return runnerCount > 0 ? runnerCount : undefined;
    if (id === 'heal') return healCount > 0 ? healCount : undefined;
    return undefined;
  };

  const toStripTab = (tab: BuiltInTab) => ({
    id: tab.id as string,
    label: t(tab.labelKey),
    icon: tab.icon,
    count: countFor(tab.id),
  });

  // Plugin tabs keep their place at the end of the house row, after every built-in one, so a newly
  // enabled plugin never moves the tab a person's hand already knows the position of.
  const pluginTabs = plugins.filter((plugin) => plugin.enabled).map((plugin) => ({
    id: `plugin:${plugin.name}`,
    label: plugin.displayName,
  }));

  const choose = (id: string) => {
    setActiveTab(id as AppTab);
    onTabChange?.();
  };
  const moreLabel = t('tabs.more');

  return (
    // Stacked 8px apart, with no heading and no rule: the gap alone has to say which row an
    // indicator belongs to. It hangs 7px under its own glyph (the tab's bottom padding), and at
    // the strip's own 2px gap it sat 9px over the next row's glyph — measured, and read as
    // belonging to either row. At 8px it is 7 against 15, and the pair still sits closer together
    // than the 10px the header leaves before its search field, so they read as one block of two.
    // The rows' glyphs spread to different widths and never line up into a grid's columns.
    <div className="flex flex-col gap-2">
      <Tabs
        tabs={projectTabs.map(toStripTab)}
        active={activeTab}
        onChange={choose}
        ariaLabel={t('tabs.project')}
        variant="underline"
        overflowLabel={moreLabel}
      />
      <Tabs
        tabs={[...houseTabs.map(toStripTab), ...pluginTabs]}
        active={activeTab}
        onChange={choose}
        ariaLabel={t('tabs.house')}
        variant="underline"
        overflowLabel={moreLabel}
      />
    </div>
  );
}
