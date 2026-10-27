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

import type { RoadmapEpicWord, RoadmapFeatureWord, RoadmapMilestoneWord } from '@/shared/roadmap-types';
import type { AffectedAreasTrouble, FileStatusCode, LLMProvider, McpProvider, McpScope, McpTransport, RoadmapDotState, SettingsMainTab } from '@/shared/types';
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

//----------------- DISPATCHER LANE WALL ------------

/**
 * The space between two lane cards, whether they stand side by side on the wall of the Roadmap tab's
 * In flight face or one under another in the Runs widget. Both homes read this one value,
 * so the widget's list keeps the face's card spacing.
 *
 * Used by `LANE_WALL_GRID` below and by the runner-tab module's `RunnerWidgetBody` (its list of cards).
 */
export const LANE_CARD_GAP = 'gap-4';

/**
 * The wall of the Roadmap tab's In flight face: an auto-fill grid of lane cards, each column at least 22rem wide (or the
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

/**
 * The kit's FAB, found in the page: the node the switcher's radial fans out from and gives focus back to, and the
 * node the dock hands focus to when the list collapses. There is one. The class is `DockableFab`'s own (surfaces.css).
 *
 * Used by the app-switcher module's AppSwitcherRadial (the press that is its own toggle, and where an Escape or a
 * keyboard-chosen act returns focus) and AppSwitcherDock (where focus lands as the list collapses).
 */
export const FAB_SELECTOR = '.vv-fab';

// ---------------------------

//----------------- SETTINGS TEXT FIELDS ------------

/**
 * A settings row's text input width. Wider than fits beside SettingRow's 10rem text column on a phone, so the row drops the
 * field below its label there, where it still fits the row. Used by the settings module's NtfySettingsCard and by the
 * companion module's Settings section, so the text fields of Settings stand at one width.
 */
export const SETTINGS_FIELD_WIDTH = 'w-64 max-w-full';

// ---------------------------

//----------------- THE VIEWS RAIL'S BUTTON ------------

/**
 * What every button in the views rail shares: a 40px square (44px below md, the touch floor) that centres a glyph, rounds
 * to the house radius, fades its ground as the hover comes and goes, and stands above its neighbours while focused. On a
 * phone the focus ring sits on the button's edge (offset 0), since a 44px button at the house ring's 2px offset is wider
 * than the 48px rail and its scroll region clips what passes its sides. The lit state, the badge and the letter disc are
 * the rail button's own.
 *
 * Used by the project-workspace module's RailButton, and by the app-switcher module's AppSwitcherDock, whose own button
 * stands in the rail's disc cell while the disc is out of its dock, so the two can never part in size or in feel.
 */
export const RAIL_BUTTON_BASE =
  'group/rail-button relative grid size-11 flex-none place-items-center rounded-lg transition-colors duration-quick focus-visible:z-10 max-md:focus-visible:outline-offset-0 md:size-10';

/** A rail button at rest and under the pointer: muted ink on the rail's canvas, the secondary ground and full ink on hover. Used with `RAIL_BUTTON_BASE` by RailButton (its unlit state), by AppSwitcherDock's own button and by the companion module's CompanionDoorButton (its door, while her panel is closed). */
export const RAIL_BUTTON_UNLIT = 'text-muted-foreground hover:bg-secondary hover:text-foreground';

/**
 * A lit rail button. Never colour alone: the soft green ground and the deep green ink carry it to the eye, the 2×20px
 * bar on the rail's left edge carries it to an eye that cannot tell the greens apart, and the button's own ARIA state
 * carries it to a reader (`aria-current` on a view, `aria-expanded` on a door). The bar sits on the rail's own edge
 * whatever the button's size: a 40px button in the 48px rail has 4px either side of it, a phone's 44px button 2px.
 * Forced colours flatten the ground and the bar alike to the canvas, which would leave the button unmarked, so there the
 * bar takes the system's Highlight — what forced colours draw for a state.
 *
 * Used with `RAIL_BUTTON_BASE` by the project-workspace module's RailButton (the view on screen) and by the companion
 * module's CompanionDoorButton (her panel open), so a lit door and a lit view are one look.
 */
export const RAIL_BUTTON_LIT =
  'bg-accent-soft text-accent-ink hover:bg-accent-soft-hover before:absolute before:-left-0.5 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-r-[2px] before:bg-accent-ink forced-colors:before:bg-[Highlight] md:before:-left-1';

// ---------------------------

//----------------- THE ROADMAP'S FEATURE WORDS ------------

/**
 * Each feature word's key in the locale, which spells `in flight` as `inFlight`: the one way a feature's
 * word is put into words. Used by the roadmap module's `StateLine` (its five stations and its label),
 * `FeatureFacts` (the word of each feature a feature waits on), the tree's `tree/treeWords` (a feature
 * dot's tip and label), and the tree's panel: `panel/EpicPanel` (a feature row's meta) and
 * `panel/FeaturePanel` (the State fact).
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
 * `inProgress`: the one way a milestone's word is put into words. Used by the roadmap module's tree:
 * `tree/TreeMilestoneNode` (the line under a milestone's ring) and `tree/treeWords` (a milestone's tip
 * and label), and its panel: `panel/RoadmapPanel` (a milestone row's meta) and `panel/MilestonePanel`
 * (the sub line).
 */
export const ROADMAP_MILESTONE_WORD_KEYS: Record<RoadmapMilestoneWord, string> = {
  empty: 'roadmap.milestoneWord.empty',
  'not started': 'roadmap.milestoneWord.notStarted',
  'in progress': 'roadmap.milestoneWord.inProgress',
  reached: 'roadmap.milestoneWord.reached',
};

// ---------------------------

//----------------- THE ROADMAP'S EPIC WORDS ------------

/**
 * Each epic word's key in the locale, which spells `not started` and `in progress` as `notStarted` and
 * `inProgress`: the one way an epic's word is put into words. Used by the roadmap module's tree:
 * `tree/TreeEpicNode` (the line under an epic's title) and `tree/treeWords` (an epic's tip and label), and
 * its panel: `panel/MilestonePanel` (an epic row's meta) and `panel/EpicPanel` (the sub line).
 */
export const ROADMAP_EPIC_WORD_KEYS: Record<RoadmapEpicWord, string> = {
  empty: 'roadmap.epicWord.empty',
  'not started': 'roadmap.epicWord.notStarted',
  'in progress': 'roadmap.epicWord.inProgress',
  complete: 'roadmap.epicWord.complete',
};

// ---------------------------

//----------------- THE ROADMAP TREE'S PAINT ------------

/**
 * How each feature dot is painted, by its state: a Verve token for the fill and one for the stroke, put on
 * through `style`. Green shipped, amber in flight, the garnish designing (orange in light, gold in dark),
 * teal proposed, red blocked, and an idea hollow (the surface inside a faint ring). Used by the roadmap
 * module's tree, `tree/TreeEpicNode`, for each feature's dot under its epic's title, and by its panel,
 * `panel/PanelRows`'s `PanelDot`, for each row's dot and the feature's State fact.
 */
export const ROADMAP_DOT_PAINT: Record<RoadmapDotState, { fill: string; stroke: string }> = {
  shipped: { fill: 'var(--accent)', stroke: 'var(--accent)' },
  inFlight: { fill: 'var(--warn-dot)', stroke: 'var(--warn-dot)' },
  designing: { fill: 'var(--garnish)', stroke: 'var(--garnish)' },
  proposed: { fill: 'var(--info-dot)', stroke: 'var(--info-dot)' },
  idea: { fill: 'var(--surface)', stroke: 'var(--ink-faint)' },
  blocked: { fill: 'var(--danger-dot)', stroke: 'var(--danger-dot)' },
};

// ---------------------------

//----------------- THE RUNNER LANDING ------------

/**
 * The query parameter a landing names a plan in (`?runner=<plan>`): the key one side writes and the other
 * reads. Used by the project-workspace module's `useRunnerLanding`, which reads it, and the shared
 * `useRevealCard`, which writes it from a surface that has no Roadmap tab above it.
 */
export const RUNNER_LANDING_PARAM = 'runner';

/**
 * The query parameter a landing names a roadmap in (`?roadmap=<name>`): the Roadmap tab's Roadmap face
 * on that roadmap. Taken, held and stripped under the very rule `RUNNER_LANDING_PARAM` follows. Used by
 * the project-workspace module's `useRunnerLanding`, which reads it, and the roadmap module's chat-gutter
 * widget (`RoadmapWidgetBody`), which writes it from a surface that has no Roadmap tab above it.
 */
export const ROADMAP_LANDING_PARAM = 'roadmap';

// ---------------------------

//----------------- ZOOM GESTURES ------------

/** What one press of a `+` / `−` zoom button multiplies the zoom by. Used by the kit's Lightbox (`useZoomPan`) and the roadmap module's tree zoom (`useTreeZoom`), so both buttons step alike. */
export const ZOOM_BUTTON_STEP = 1.5;

/** The zoom a double-click or double-tap lands on when it zooms in from fit. Used by `useZoomPan` and `useTreeZoom`. */
export const ZOOM_DOUBLE_TAP_SCALE = 2;

/** How far a press may travel, in px, and still be a tap rather than a pan. Used by `useZoomPan` and `useTreeZoom`. */
export const ZOOM_TAP_SLOP_PX = 6;

/** Two taps this close in time, in ms, and within `ZOOM_DOUBLE_TAP_RADIUS_PX`, are a double-tap. Used by `useZoomPan` and `useTreeZoom`. */
export const ZOOM_DOUBLE_TAP_WINDOW_MS = 320;

/** The distance, in px, within which a second tap counts as a double-tap of the first. Used by `useZoomPan` and `useTreeZoom`. */
export const ZOOM_DOUBLE_TAP_RADIUS_PX = 32;

// ---------------------------

//----------------- FOCUS TRAPS ------------

/**
 * What a Tab can land on: the selector a focus trap queries for its first and last stop. Used by the
 * kit's `Dialog` and `Sheet`, which trap Tab inside their panel the same way and focus the first stop
 * when they open.
 */
export const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ---------------------------

//----------------- TOUCH LIFT ------------

/**
 * How long a finger holds still on a free spot, in ms, before it lifts what is under it. Used by the kit's
 * `useSortable` (the runner, roadmap and dispatcher lists) and by the sidebar's `useSimpleChatDrag` (the chat
 * list), so a card and a chat row lift on the same hold.
 */
export const TOUCH_HOLD_MS = 400;

// ---------------------------

//----------------- AFFECTED AREAS MARKS ------------

/**
 * The longest note a mark may carry, in characters: shadow-connector's `MAX_NOTE`
 * (`core/affected_areas/judgment/marks.py`), which refuses a longer one as `note_too_long`. Used by the
 * affected-areas module's `NoteDialog` and `UnderstandingVerdict` as their fields' `maxLength`, and by
 * `MarkRefusal` to say the cap, so a note typed here is never one the engine turns back.
 */
export const MARK_NOTE_MAX = 500;

/**
 * The smallest area a drawn box may cover, as a share of the photo (0..1 squared): shadow-connector's
 * `seat/normalize.MIN_AREA_FRAC`, below which the engine refuses a Missed one box as `bad_box` (about 10 by 10 pixels of a
 * 1024 px view). The engine stays the authority; this mirror is how the affected-areas module's `MissedDraw` turns a box
 * back before sending it, in the engine's own sentence, and how the photo's box drag stays free of any floor of its own.
 */
export const MIN_REGION_AREA = 1e-4;

// ---------------------------

//----------------- AFFECTED AREAS LANE ------------

/**
 * The three ways the affected-areas lane fails whatever was asked of it: CloudCLI could not read shadow-connector's
 * secret, shadow-connector did not answer in time, or it answered what CloudCLI cannot read. Each is said in the Tours
 * view's own words (`affectedAreas.trouble.<fault>`) rather than as a refusal of the press. Read by the affected-areas
 * module's `LaneTrouble` (a read that brought no answer), `ThresholdControl` (a Set threshold that brought none) and
 * `MarkRefusal` (a mark, missed area or understanding press that brought none).
 */
export const AFFECTED_AREAS_LANE_FAULTS: readonly AffectedAreasTrouble[] = ['no_secret', 'unreachable', 'unreadable'];
