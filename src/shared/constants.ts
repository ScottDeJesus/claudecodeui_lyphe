import {
  Bell,
  Bot,
  Download,
  GitBranch,
  Info,
  KeyRound,
  ListChecks,
  Mic,
  MonitorPlay,
  Palette,
  Plug,
} from 'lucide-react';
import type { ComponentType } from 'react';

import type { RoadmapFeatureWord, RoadmapMilestoneWord } from '@/shared/roadmap-types';
import type { FileStatusCode, LLMProvider, McpProvider, McpScope, McpTransport, SettingsMainTab } from '@/shared/types';
import type { UserPreferenceKey } from '@/shared/userSettings';

/** The four buckets the git changes view sorts working-tree files into. */
type GitStatusFileGroup = 'modified' | 'added' | 'deleted' | 'untracked';

//----------------- BRANDING ------------

/**
 * Font stack used to render the CloudCLI wordmark consistently wherever the brand name
 * appears as text. Apply it inline so the wordmark does not inherit a themed font.
 */
export const CLOUDCLI_WORDMARK_FONT_FAMILY =
  'ui-sans-serif, system-ui, sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Noto Color Emoji';

// ---------------------------

//----------------- APPLICATION VERSION ------------

/**
 * Version of the installed package, baked into the client bundle at build time.
 * Compare it with the version reported by `/health` to detect a package that was
 * updated without restarting the server. Empty outside a Vite build (for example
 * under the `tsx` test runner), where no build-time value is injected.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';

// ---------------------------

//----------------- GIT TAB ------------

/**
 * The repositories the git tab's strip tabs through, in strip order, by absolute path — the
 * comma-separated `VITE_GIT_REPO_PATHS`. The git tab matches them to registered projects; the
 * command palette offers its commit and branch rows only for a project on this list, since those
 * rows bring the git tab forward on it. EMPTY means no list was configured, and every registered
 * project is on the strip.
 */
export const GIT_REPO_PATHS: readonly string[] = String(import.meta.env?.VITE_GIT_REPO_PATHS ?? '')
  .split(',')
  .map((repoPath) => repoPath.trim())
  .filter((repoPath) => repoPath !== '');

// ---------------------------

//----------------- SETTINGS NAVIGATION ------------

/** Shape of one entry in `SETTINGS_MAIN_TABS`; only that constant needs it. */
type SettingsMainTabMeta = {
  id: SettingsMainTab;
  label: string;
  keywords: string;
  icon: ComponentType<{ className?: string }>;
};

/**
 * The ordered list of top-level settings tabs, in the order they are shown. The command palette
 * turns each entry into an "open settings" command.
 *
 * IT IS NOT THE SIDEBAR'S LIST. The settings sidebar keeps its own `NAV_ITEMS`
 * (`SettingsSidebar.tsx`) and the two are kept in step by hand: a tab added here and not there is a
 * palette command that opens a panel the sidebar cannot reach, and one added there and not here is
 * a panel the palette cannot name. `mainTabs.*` in the settings namespace holds the sidebar's
 * labels; these are the palette's.
 */
export const SETTINGS_MAIN_TABS: SettingsMainTabMeta[] = [
  { id: 'agents', label: 'Agents', keywords: 'agents subagents claude code chains model effort launch', icon: Bot },
  { id: 'appearance', label: 'Appearance', keywords: 'appearance theme dark light language', icon: Palette },
  { id: 'git', label: 'Git', keywords: 'git github commits', icon: GitBranch },
  { id: 'tasks', label: 'Tasks', keywords: 'tasks taskmaster', icon: ListChecks },
  { id: 'notifications', label: 'Notifications', keywords: 'notifications alerts push', icon: Bell },
  { id: 'api', label: 'API Tokens', keywords: 'api tokens auth keys', icon: KeyRound },
  { id: 'voice', label: 'Voice', keywords: 'voice speech dictation transcription', icon: Mic },
  { id: 'plugins', label: 'Plugins', keywords: 'plugins extensions integrations', icon: Plug },
  { id: 'browser', label: 'Browser', keywords: 'browser playwright chromium automation', icon: MonitorPlay },
  { id: 'updates', label: 'Updates', keywords: 'updates claude code sdk versions patch notes', icon: Download },
  { id: 'about', label: 'About', keywords: 'about version info', icon: Info },
];

// ---------------------------

//----------------- CHAT REASONING EFFORT ------------

/**
 * Sentinel effort value meaning "use whatever the model defaults to". The composer's model
 * menu renders it as the first choice and the provider state treats it as "no explicit effort".
 */
export const DEFAULT_EFFORT_VALUE = 'default';

// ---------------------------

//----------------- FILE UPLOAD LIMITS ------------

/** Largest single file the upload endpoint accepts, in megabytes. Source of truth for the two derived limits below. */
export const MAX_FILE_UPLOAD_SIZE_MB = 200;

/** `MAX_FILE_UPLOAD_SIZE_MB` in bytes, for comparing against `File.size` before uploading. */
export const MAX_FILE_UPLOAD_SIZE_BYTES = MAX_FILE_UPLOAD_SIZE_MB * 1024 * 1024;

/** Human-readable form of the size limit, shown in the file tree header and in upload errors. */
export const MAX_FILE_UPLOAD_SIZE_LABEL = `${MAX_FILE_UPLOAD_SIZE_MB}MB`;

// ---------------------------

//----------------- GIT CHANGE GROUPS ------------

/** Shape of one entry in `FILE_STATUS_GROUPS`; only that constant needs it. */
type GitStatusGroupEntry = {
  key: GitStatusFileGroup;
  status: FileStatusCode;
};

/**
 * The order in which the git changes view groups files, and the status code each group holds.
 * Both the change list and the status-grouping helper iterate it so the two stay aligned.
 */
export const FILE_STATUS_GROUPS: GitStatusGroupEntry[] = [
  { key: 'modified', status: 'M' },
  { key: 'added', status: 'A' },
  { key: 'deleted', status: 'D' },
  { key: 'untracked', status: 'U' },
];

// ---------------------------

//----------------- GIT DELEGATION ------------

/**
 * The prompt the git panel's "Push my changes" button sends — the WHOLE first message of the
 * conversation it starts, byte for byte.
 *
 * It must stay a bare command name. The estate's push guard
 * (`~/.claude/hooks/enforce_push_via_git_command.py`) authorises a push only for a session
 * whose prompt BEGINS with `/git` — leading whitespace allowed, nothing else — so in production
 * this literal has to start with `/git` or the run reads the changes, writes the commits, and is
 * then refused the one thing the button exists for. Sending the command's expanded text instead
 * of its name fails the same way, and a trailing space or newline is the same class of mistake.
 *
 * An operator knob (`VITE_GIT_DELEGATION_COMMAND`, documented in `.env.example`): pointing it
 * at a command that only reads is how this button is exercised without moving a remote.
 *
 * ⚠ The guard's test is `/git` followed by a word boundary, and a hyphen IS one — so a value
 * like `/git-rehearsal` also mints the 30-minute push grant, inside a session this button starts
 * with `permissionMode: 'bypassPermissions'`. A read-only stand-in is therefore not a read-only
 * SESSION: resuming that conversation inside the window can push without the operator having
 * said `/git`. Keep such a value in place only as long as the run that needs it.
 */
export const GIT_DELEGATION_COMMAND: string =
  import.meta.env?.VITE_GIT_DELEGATION_COMMAND ?? '/git';

// ---------------------------

//----------------- MCP SERVER CAPABILITIES ------------

/** Display name for each provider that can host MCP servers, used in headings and buttons. */
export const MCP_PROVIDER_NAMES: Record<McpProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

/** Scopes each provider can install an MCP server into; drives the scope selector and validation. */
export const MCP_SUPPORTED_SCOPES: Record<McpProvider, McpScope[]> = {
  claude: ['user', 'project', 'local'],
  cursor: ['user', 'project'],
  codex: ['user', 'project'],
  opencode: ['user', 'project'],
};

/** Transports each provider can talk to an MCP server over; drives the transport selector and validation. */
export const MCP_SUPPORTED_TRANSPORTS: Record<McpProvider, McpTransport[]> = {
  claude: ['stdio', 'http', 'sse'],
  cursor: ['stdio', 'http'],
  codex: ['stdio', 'http'],
  opencode: ['stdio', 'http'],
};

/** Transports offered when configuring a global (provider-agnostic) MCP server. */
export const MCP_GLOBAL_SUPPORTED_TRANSPORTS: McpTransport[] = ['stdio', 'http'];

/** Whether a provider honours an MCP server's working-directory setting; the form hides the field when it does not. */
export const MCP_SUPPORTS_WORKING_DIRECTORY: Record<McpProvider, boolean> = {
  claude: false,
  cursor: false,
  codex: true,
  opencode: false,
};

// ---------------------------

//----------------- QUICK SETTINGS PANEL ROWS ------------

/**
 * Class list for one row in the quick settings panel. Shared so plain rows and the clickable
 * toggle row (which appends `cursor-pointer`) stay visually identical.
 */
export const SETTING_ROW_CLASS =
  'flex items-center justify-between p-3 rounded-lg bg-muted/60 hover:bg-accent transition-colors border border-transparent hover:border-border';

// ---------------------------

//----------------- TERMINAL TIMING ------------

/**
 * Delay before the terminal is measured and fitted after it is attached. Gives the browser one
 * layout pass so the initial fit and the resize message sent to the backend use real dimensions.
 */
export const TERMINAL_INIT_DELAY_MS = 100;

// ---------------------------

//----------------- PROVIDER TOOL SETTINGS STORAGE ------------

/**
 * Per-provider preference key holding that provider's tool-permission
 * settings, sent with every `chat.send`.
 *
 * `opencode` intentionally maps to its own key even though no settings UI
 * writes it yet: without the entry the lookup would fall through to Claude's
 * key and OpenCode sessions would silently inherit Claude's `skipPermissions`.
 */
export const PROVIDER_PERMISSION_PREFERENCE_KEYS: Record<LLMProvider, UserPreferenceKey> = {
  claude: 'claudePermissions',
  cursor: 'cursorPermissions',
  codex: 'codexPermissions',
  opencode: 'opencodePermissions',
};

/**
 * The name a person reads for each provider, wherever a session is described in prose —
 * the sidebar's session meta line and the workspace header's sub-line.
 *
 * Deliberately separate from `MCP_PROVIDER_NAMES` above, which happens to spell the same four
 * words today but answers a different question (which providers can host an MCP server) and is
 * keyed by `McpProvider`. Merging them would tie a change in one surface to the other.
 */
export const LLM_PROVIDER_LABELS: Record<LLMProvider, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

// ---------------------------

//----------------- CHAT MARKDOWN CARDS ------------

/**
 * The class a markdown surface carries to opt into the element cards painted by
 * `src/modules/chat/transcript/markdownCards.css`. `Plain*` renders every markdown surface and
 * only the wrapper knows which one, so the opt-in lives on the wrapper as one class.
 *
 * Applied by MessageComponent's reply, thinking and tool-text bodies, and by MarkdownContent for
 * every tool markdown body. User message bubbles and tool errors deliberately do not carry it.
 */
export const MARKDOWN_CARDS_CLASS = 'chat-md-cards';

// ---------------------------

//----------------- SWARM CEILING LADDER ------------

/**
 * The floor of a swarm ceiling, mirrored from the runner's own grammar: a switch that is on runs at
 * least one phase, and `on 0` is not on at all. Nothing is narrowed above it — the count the operator
 * sets is the count the file holds.
 *
 * Used by `useSwarmSwitch` (the writer clamps to it), `swarmLadderSteps` (the ladder stops there), the
 * dispatcher module's `SwarmControl` (one lane is the word `off`) and the settings module's
 * `RunnerModelContent` (one lane has its own singular).
 */
export const LANES_MIN = 1;

/**
 * The count the swarm ladder climbs to before `All`: `1, 2, … 6, All`. Six is the widest count the
 * operator has ever chosen. It is only the FLOOR of the ladder's top rung — a wider count in play
 * raises it (`swarmLadderTop`). On the plan card the box's count is always in play, so it stays a rung
 * however the plan's own count moves; on the Settings row the row's own count is the only one.
 *
 * Used by `swarmLadderTop` in `utils.ts`, which both steppers of the swarm — the plan card's
 * `SwarmControl` and the settings module's `RunnerModelContent` — climb through.
 */
export const SWARM_LADDER_TOP = 6;

// ---------------------------

//----------------- DISPATCHER LANE WALL ------------

/**
 * The space between two lane cards, whether they stand side by side on the Runner tab's wall or one
 * under another in the chat gutter's Runner widget. Both homes read this one value, so the widget's
 * list keeps the tab's card spacing.
 *
 * Used by `LANE_WALL_GRID` below and by the runner-tab module's `RunnerWidgetBody` (its list of cards).
 */
export const LANE_CARD_GAP = 'gap-4';

/**
 * The Runner tab's wall: an auto-fill grid of lane cards, each column at least 22rem wide (or the
 * whole column where the pane is narrower, so a phone gets one card a row and never a sideways
 * scroll), row-major, and every card at its OWN height (`items-start`) rather than the tallest in
 * its row, spaced `LANE_CARD_GAP` apart.
 *
 * Used by the runner-tab module's `RunnerPanel`, for the plans of no arc.
 */
export const LANE_WALL_GRID = `grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] items-start ${LANE_CARD_GAP}`;

// ---------------------------
//----------------- CHAT HOTKEY ------------

/**
 * The key that, held with Ctrl (⌘ on a Mac), floats the chat or brings it home again. It is printed
 * beside the switcher's Chat act through `formatShortcut`, and it is the key `useChatHotkey` listens for.
 *
 * Used by the app-switcher module (the Chat act's printed shortcut) and the project-workspace module
 * (the hotkey itself); one value, so what is printed is what is heard.
 */
export const CHAT_TOGGLE_KEY = '.';

// ---------------------------

//----------------- FLOATING ACTION BUTTON ------------

/**
 * The FAB's drawn width and height, the JS twin of `--vv-fab-size` in the kit's surfaces.css: the size the
 * kit clamps a FAB it cannot measure yet to, the size the switcher's radial draws each disc and works out
 * its label geometry from, and the size the floating chat's rest anchor stands as. The stylesheet's variable
 * is what draws; keep the two equal (the radial's proof measures a disc against the FAB itself).
 *
 * Used by the DockableFab kit piece, the app-switcher module's radial layout and labels, and the chat-host
 * module's floating panel.
 */
export const FAB_SIZE_PX = 28;

/**
 * How wide the FAB's catch is: a transparent round area centred on the button, so a press up to half of this
 * from its centre is the FAB's while its drawn box stays `FAB_SIZE_PX`. Every radial disc keeps the same
 * catch, so a finger lands on either. The JS twin of `--vv-fab-catch` in surfaces.css.
 *
 * Used by the app-switcher module's radial layout (the room an item is given) and label plan (what a label
 * keeps clear of).
 */
export const FAB_CATCH_PX = 44;

// ---------------------------

//----------------- THE ROADMAP'S FEATURE WORDS ------------

/**
 * Each feature word's key in the locale, which spells `in flight` as `inFlight`: the one way a feature's
 * word is put into words. Used by the roadmap module's `StateLine` (its five stations and its label) and
 * `FeatureFacts` (the word of each feature a feature waits on).
 */
export const ROADMAP_FEATURE_WORD_KEYS: Record<RoadmapFeatureWord, string> = {
  idea: 'roadmap.word.idea',
  proposed: 'roadmap.word.proposed',
  designing: 'roadmap.word.designing',
  'in flight': 'roadmap.word.inFlight',
  shipped: 'roadmap.word.shipped',
};

// ---------------------------

//----------------- THE ROADMAP'S MILESTONE WORDS ------------

/**
 * Each milestone word's key in the locale, which spells `not started` and `in progress` as `notStarted` and
 * `inProgress`: the one way a milestone's word is put into words. Used by the roadmap module's
 * `MilestonePath` (each station's line and label) and `MilestoneFocus` (the stage's eyebrow).
 */
export const ROADMAP_MILESTONE_WORD_KEYS: Record<RoadmapMilestoneWord, string> = {
  empty: 'roadmap.milestoneWord.empty',
  'not started': 'roadmap.milestoneWord.notStarted',
  'in progress': 'roadmap.milestoneWord.inProgress',
  reached: 'roadmap.milestoneWord.reached',
};

// ---------------------------

//----------------- THE RUNNER LANDING ------------

/**
 * The query parameter a landing names a plan in (`?runner=<plan>`): the key one side writes and the other
 * reads. Used by the project-workspace module's `useRunnerLanding`, which reads it, and the roadmap
 * module's `useRevealCard`, which writes it from a surface that has no Roadmap tab above it.
 */
export const RUNNER_LANDING_PARAM = 'runner';
