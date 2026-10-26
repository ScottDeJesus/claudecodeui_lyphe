import {
  Clock,
  Coins,
  FolderTree,
  GitBranch,
  Globe,
  Inbox,
  KanbanSquare,
  ListTodo,
  MessageSquare,
  Orbit,
  Radar,
  Route,
  StickyNote,
  Terminal,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlugins } from '@/modules/plugins';
import { useTasksSettings } from '@/modules/task-master';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import type { WorkspaceView } from '@/shared/types';

// One glyph per view, each naming the thing the view actually shows rather than an action, in the
// rail's order: a speech bubble for the conversation; a file tree for the files; a branch for git;
// a globe for the browser; a terminal for the shell; a checklist for tasks; a route for the
// roadmap, the path the work is on; lanes for the board; a clock for what the box runs on a
// schedule; a sticky note for the notes a person jots down and comes back to; an orbit for the
// sky; a radar for Cerberus, the view whose subject is the fleet's health — what is being watched,
// and what needs a person; coins for the API view, whose subject is what the house spends on
// third-party services — Jev and DeepSeek; a tray for the Inbox, where what waits on the operator is
// collected.
//
// A plugin supplies a display name and no glyph, and a guessed icon would name it wrong, so its
// view carries `icon: null` and the rail draws a letter disc.

/** What a built-in view is before the language and the gates have their say: its label is `tabs.<id>`. */
type BuiltInView = Omit<WorkspaceView, 'label'>;

// Chat leads the rail in a run of its own.
const CHAT_VIEW: BuiltInView = { id: 'chat', group: 'chat', icon: MessageSquare, keywords: 'chat messages conversation' };

// The tools run: three views that are always on it, then the gated two. A gated view joins at the END of
// its run, so turning one on never moves a glyph the hand already knows. Browser is ungated — its panel
// says "Browser is disabled", with a door into its Settings tab, when the feature is off.
const OPEN_TOOL_VIEWS: BuiltInView[] = [
  { id: 'files', group: 'tools', icon: FolderTree, keywords: 'files file tree explorer' },
  { id: 'git', group: 'tools', icon: GitBranch, keywords: 'git diff branches' },
  { id: 'browser', group: 'tools', icon: Globe, keywords: 'browser web agents sessions chromium watch' },
];
const SHELL_VIEW: BuiltInView = { id: 'shell', group: 'tools', icon: Terminal, keywords: 'shell terminal console' };
const TASKS_VIEW: BuiltInView = { id: 'tasks', group: 'tools', icon: ListTodo, keywords: 'tasks taskmaster' };

// The Roadmap view (the `runner` id) leads the plans run: the operator lives there, so it is on the
// rail whatever the lane holds. Kanban, Schedules and Notes are global too — none describes the open
// project — and so carry no gate either.
const PLAN_VIEWS: BuiltInView[] = [
  { id: 'runner', group: 'plans', icon: Route, keywords: 'roadmap milestone epic feature task goal path in flight runner feature epic task run live plan phases' },
  { id: 'kanban', group: 'plans', icon: KanbanSquare, keywords: 'kanban board lanes cards backlog' },
  { id: 'schedules', group: 'plans', icon: Clock, keywords: 'schedules cron jobs registry scheduled prompts sync' },
  { id: 'notes', group: 'plans', icon: StickyNote, keywords: 'notes note cards jot write memo' },
];

// Facts about the house whichever project is open, so ungated: a monitor that hid on a quiet day
// could never say "All quiet", and a view opened to make a money decision must not hide either.
const HOUSE_VIEWS: BuiltInView[] = [
  { id: 'universe', group: 'house', icon: Orbit, keywords: 'universe galaxy stars repos map graph' },
  { id: 'cerberus', group: 'house', icon: Radar, keywords: 'cerberus fleet health monitoring checks wardens nodes' },
  { id: 'api', group: 'house', icon: Coins, keywords: 'api jev deepseek spend balance burn tokens consumers usage outings typesafe' },
];

// The foot of the rail, after the plugins: the Inbox, everything waiting on the operator — the memories sessions
// proposed, the live friction, the asks the roadmap is stopped on. A view of the house, so ungated like the
// ones above it: an Inbox that hid on a quiet day could never say that nothing waits.
const FOOT_VIEWS: BuiltInView[] = [
  { id: 'inbox', group: 'foot', icon: Inbox, keywords: 'inbox memory heal roadmap waiting asks proposals friction' },
];

/**
 * Read by project-workspace's ProjectCommandPalette (its Navigate rows) and WorkspaceMain (the panes' gates and
 * snap-backs): the one list of the workspace's views, in rail order, with the preference gates that shaped it.
 * The list carries no count — badges are the rail's alone — so a reader of it does not re-render when a count
 * moves. `views` keeps one identity until a gate, the plugin list or the language really changes.
 */
export function useWorkspaceViews(): {
  views: WorkspaceView[];
  shouldShowShellTab: boolean;
  shouldShowTasksTab: boolean;
  preferencesSettled: boolean;
} {
  const { t } = useTranslation();
  const { hideShellTab, settled: preferencesSettled } = useUiPreferences();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { plugins } = usePlugins();

  const shouldShowShellTab = !hideShellTab;
  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);

  // `t` changes identity with the language, so it stands in for "the language" in the deps.
  const views = useMemo<WorkspaceView[]>(() => {
    const builtIn: BuiltInView[] = [
      CHAT_VIEW,
      ...OPEN_TOOL_VIEWS,
      ...(shouldShowShellTab ? [SHELL_VIEW] : []),
      ...(shouldShowTasksTab ? [TASKS_VIEW] : []),
      ...PLAN_VIEWS,
      ...HOUSE_VIEWS,
    ];
    const pluginViews: WorkspaceView[] = plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => ({
        id: `plugin:${plugin.name}`,
        label: plugin.displayName,
        group: 'plugins',
        icon: null,
        keywords: `plugin ${plugin.name}`,
      }));
    const named = (run: BuiltInView[]): WorkspaceView[] => run.map((view) => ({ ...view, label: t(`tabs.${view.id}`) }));
    return [...named(builtIn), ...pluginViews, ...named(FOOT_VIEWS)];
  }, [shouldShowShellTab, shouldShowTasksTab, plugins, t]);

  return { views, shouldShowShellTab, shouldShowTasksTab, preferencesSettled };
}
