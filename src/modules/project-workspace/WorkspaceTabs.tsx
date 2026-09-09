import {
  Brain,
  FolderTree,
  GitBranch,
  Globe,
  ListTodo,
  MessageSquare,
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
// a branch for git, a globe for the browser, a checklist for tasks, a brain for memory.
const BASE_TABS: BuiltInTab[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'shell', labelKey: 'tabs.shell', icon: Terminal },
  { id: 'files', labelKey: 'tabs.files', icon: FolderTree },
  { id: 'git',   labelKey: 'tabs.git',   icon: GitBranch },
];

const BROWSER_TAB: BuiltInTab = { id: 'browser', labelKey: 'tabs.browser', icon: Globe };

const TASKS_TAB: BuiltInTab = { id: 'tasks', labelKey: 'tabs.tasks', icon: ListTodo };

const MEMORY_TAB: BuiltInTab = { id: 'memory', labelKey: 'tabs.memory', icon: Brain };

/**
 * Rendered by ProjectSidebarRegion, under the wordmark, to show the built-in workspace tabs plus
 * any enabled plugin tabs.
 *
 * The built-in tabs are icon-only — a glyph each, named by `title` and `aria-label` — which is
 * what lets seven of them share the sidebar's width. Plugin tabs keep their words: a plugin
 * supplies a display name and no glyph, and a guessed icon would name it wrong.
 *
 * The strip still scrolls sideways rather than wrapping, because plugin tabs are words and a row
 * that reflows moves every tab a hand already knows the position of each time one is toggled.
 */
export default function WorkspaceTabs({
  activeTab,
  setActiveTab,
  shouldShowTasksTab,
  shouldShowBrowserTab,
  shouldShowShellTab,
  shouldShowMemoryTab,
  memoryPendingCount,
  onTabChange,
}: WorkspaceTabsProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  // Every gate arrives as a prop. This component reading a preference context of its own would
  // be a second source for a decision `useWorkspaceTabGates` has already made — and the two would
  // disagree the moment one of them is given a different rule.
  const builtInTabs: BuiltInTab[] = [
    ...BASE_TABS.filter((tab) => tab.id !== 'shell' || shouldShowShellTab),
    ...(shouldShowBrowserTab ? [BROWSER_TAB] : []),
    ...(shouldShowTasksTab ? [TASKS_TAB] : []),
    ...(shouldShowMemoryTab ? [MEMORY_TAB] : []),
  ];

  // Plugin tabs keep their place at the end of the strip, after every built-in one, so a newly
  // enabled plugin never moves the tab a person's hand already knows the position of.
  const tabs = [
    // Only the Memory tab carries a count, and only while there is something to count:
    // `undefined` is what tells `Tabs` to draw no pill at all, so a queue that has just been
    // emptied leaves a bare label rather than a zero nobody needs to read.
    ...builtInTabs.map((tab) => ({
      id: tab.id as string,
      label: t(tab.labelKey),
      icon: tab.icon,
      count: tab.id === 'memory' && memoryPendingCount > 0 ? memoryPendingCount : undefined,
    })),
    ...plugins.filter((plugin) => plugin.enabled).map((plugin) => ({
      id: `plugin:${plugin.name}`,
      label: plugin.displayName,
    })),
  ];

  return (
    <div className="scrollbar-hide overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
      <Tabs
        tabs={tabs}
        active={activeTab}
        onChange={(id) => {
          setActiveTab(id as AppTab);
          onTabChange?.();
        }}
        ariaLabel={t('tabs.views', { defaultValue: 'Workspace views' })}
        variant="underline"
      />
    </div>
  );
}
