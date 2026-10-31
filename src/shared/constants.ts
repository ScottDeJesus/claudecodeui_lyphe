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
  ClipboardList,
  FileDiff,
  FileText,
  Footprints,
  List,
  MessageCircleQuestion,
  MessageSquare,
  MessagesSquare,
  Route,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Stamp,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType, HTMLAttributes } from 'react';

import type { CompanionNoteKind } from '@/shared/companion-types';
import type { RoadmapEpicWord, RoadmapFeatureWord, RoadmapMilestoneWord } from '@/shared/roadmap-types';
import type { StationFocusKind } from '@/shared/station-types';
import type {
  AffectedAreasTrouble,
  FileStatusCode,
  LLMProvider,
  McpProvider,
  McpScope,
  McpTransport,
  RoadmapDotState,
  LocaleWords,
  SettingsMainTab,
  StationNeedKind,
} from '@/shared/types';
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
 * Used by the DockableFab kit piece, the app-switcher module's radial layout and labels, the chat-host module's
 * floating panel, and the companion module's disc (her size at rest, which her disc grows from while she is active).
 */
export const FAB_SIZE_PX = 28;

/**
 * How wide the FAB's catch is: a transparent round area centred on the button, so a press up to half of this
 * from its centre is the FAB's while its drawn box stays `FAB_SIZE_PX`. Every radial disc keeps the same
 * catch, so a finger lands on either. The JS twin of `--vv-fab-catch` in surfaces.css.
 *
 * Used by the app-switcher module's radial layout (the room an item is given) and label plan (what a label
 * keeps clear of), and by the companion module's disc (her phone corner stands one catch above the applications
 * button, so the two catches meet without overlapping).
 */
export const FAB_CATCH_PX = 44;

/**
 * The floating default's inset, in px, from the window's bottom-right corner to the FAB's own top-left corner: 72 leaves
 * the button's right edge 44px off the right of the window, 112 its foot 84px above the bottom edge (measured at
 * 390x844, 2026-09-17). The retired hub's numbers, carried over when the button was 56px and kept when it became
 * 28 — which is why the gaps read wider than the margin they once meant.
 *
 * 84px up is NOT clear of a phone's chat composer, which docks to the same edge: the 44px catch around the dot covers
 * the right end of the composer's first line, and a press there opens the sheet instead of placing the caret. Left as it
 * stands, deliberately — no pair of fixed insets clears a composer whose height follows the text in it and the
 * keyboard, and lifting the button past the composer puts that same 44px catch in the middle of the conversation's
 * scroll, where a press meant for the text moves the button.
 *
 * Used by the app-switcher module's storage (where a reader who never touched the button starts on a phone) and the
 * companion module's disc, whose phone corner stands one catch to the left of that spot: change the 72 and the two
 * discs' catches overlap.
 */
export const FAB_DEFAULT_INSET_X = 72;

/** The same default's vertical inset (see `FAB_DEFAULT_INSET_X`): the window's bottom edge to the FAB's top edge, in px. */
export const FAB_DEFAULT_INSET_Y = 112;

/**
 * The switcher's FAB, found in the page: the node the switcher's radial fans out from and gives focus back to, and the
 * node the dock hands focus to when the list collapses. The class is `DockableFab`'s own (surfaces.css), and the
 * companion's disc, which is the same kit piece inside its `[data-companion-fab]` layer, is left out, so the match is
 * the applications button whatever order the two mount in.
 *
 * Used by the app-switcher module's AppSwitcherRadial (the press that is its own toggle, and where an Escape or a
 * keyboard-chosen act returns focus) and AppSwitcherDock (where focus lands as the list collapses).
 */
export const FAB_SELECTOR = '.vv-fab:not([data-companion-fab] .vv-fab)';

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
 * stands in the rail's disc cell while the disc is out of its dock, so the two can never part in size or in feel; and by
 * the companion module's dock cell (CompanionDockView), whose size and shape are the door's it draws.
 */
export const RAIL_BUTTON_BASE =
  'group/rail-button relative grid size-11 flex-none place-items-center rounded-lg transition-colors duration-quick focus-visible:z-10 max-md:focus-visible:outline-offset-0 md:size-10';

/** A rail button at rest and under the pointer: muted ink on the rail's canvas, the secondary ground and full ink on hover. Used with `RAIL_BUTTON_BASE` by RailButton (its unlit state), by AppSwitcherDock's own button and by the companion module's door (CompanionDock.tsx's CompanionDoorView, while her panel is closed). */
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
 * module's door (CompanionDock.tsx's CompanionDoorView, her panel open); and on its own by the companion module's
 * dock cell (CompanionDockView: her disc seated, her panel open). So a lit door, a lit seat and a lit view are one look.
 * The station module's left rail lights a row in it too (`RailRow`: the session, epic or feature on the stage, as
 * `aria-current`), its bar drawn inside the row's left edge, where a fold's clipping body cannot cut it: a lit thing is
 * one look on every rail.
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

//----------------- THE WINDOW'S POINTER ------------

/**
 * The media query that asks whether the window's main pointer is a finger. Read, with `matchMedia`, by the one phone predicate
 * (`usePhoneWindow`'s `isPhoneWindow`), by the station's window (`useStationWindow`: a phone on its side) and by the keyboard's
 * mark (`useVisualViewportKeyboardOffset`: a coarse pointer is what makes a shrunken layout viewport a keyboard).
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

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

// ---------------------------

//----------------- PAGE ANCHORS ------------

/**
 * The keys the page's anchors are registered under (`PageAnchorsContext`), each a stable name for one element a floating
 * guide can point at: `chatRow(id)` is a chat's row in the sidebar, `composer(id)` that chat's composer, `filesView` the
 * file tree while it is drawn and `railFiles` the rail's Files button. The registering modules (the sidebar's rows,
 * chat's composer, the file tree and project-workspace's rail) spell their key here, and the companion's button reads
 * the same spelling, so neither side names a module of the other. A key is also what the provider stamps on the element
 * as `data-page-anchor`.
 */
export const PAGE_ANCHOR = {
  chatRow: (id: string) => `chat-row:${id}`,
  composer: (id: string) => `composer:${id}`,
  filesView: 'files-view',
  railFiles: 'rail:files',
} as const;

// ---------------------------

//----------------- COMPANION NOTE KINDS ------------

/**
 * The glyph and the word of each kind of card Kaylee puts up (`CompanionNote.kind`): `icon` is the lucide mark and `wordKey` the
 * i18n key of its word (`companion.noteKind.<kind>`: Note, List, Diff, Plan page, DocSpace page). A kind is always drawn with its
 * word beside the mark, never the mark alone. Read by the companion module's inline cards in her conversation and by the
 * stage and shelf that draw a card.
 */
export const COMPANION_NOTE_KIND_GLYPHS: Record<CompanionNoteKind, { icon: LucideIcon; wordKey: string }> = {
  note: { icon: StickyNote, wordKey: 'companion.noteKind.note' },
  list: { icon: List, wordKey: 'companion.noteKind.list' },
  diff: { icon: FileDiff, wordKey: 'companion.noteKind.diff' },
  plan: { icon: ClipboardList, wordKey: 'companion.noteKind.plan' },
  page: { icon: FileText, wordKey: 'companion.noteKind.page' },
};

// ---------------------------

//----------------- STATION FOCUS KINDS ------------

/**
 * The glyph and the word of each kind of thing the station's stage can hold (`StationFocus.kind`): `icon` is the lucide mark and
 * `wordKey` the i18n key of its word (`station.focusKind.<kind>`: Session, Feature or epic, Waiting ask, Follow-ups, Check, Card,
 * Walkthrough, Page). A kind is always drawn with its word beside the mark, never the mark alone. Read by the station's stage
 * head and by every region's press, which names its kind by them.
 */
export const STATION_FOCUS_GLYPHS: Record<StationFocusKind, { icon: LucideIcon; wordKey: string }> = {
  chat: { icon: MessageSquare, wordKey: 'station.focusKind.chat' },
  card: { icon: Route, wordKey: 'station.focusKind.card' },
  ask: { icon: MessageCircleQuestion, wordKey: 'station.focusKind.ask' },
  followups: { icon: ListChecks, wordKey: 'station.focusKind.followups' },
  check: { icon: ShieldCheck, wordKey: 'station.focusKind.check' },
  note: { icon: StickyNote, wordKey: 'station.focusKind.note' },
  walk: { icon: Footprints, wordKey: 'station.focusKind.walk' },
  page: { icon: FileText, wordKey: 'station.focusKind.page' },
};

// ---------------------------

//----------------- STATION NEED KINDS ------------

/**
 * Each kind of thing that needs him on the station's right rail (`StationNeedKind`), as its item and the ask's stage draw it:
 * `icon` its lucide mark and `word` its word (Accept, Questions, Permission, Question, Plan, Follow-ups, Red check), always drawn
 * together (MAN-578); `warn` whether it wears the warn tone — an Accept and a red check, what stands waiting on him, amber and
 * never red (MAN-577); and `act` the one act its item offers. "Queue…", "Answer…" and "Allow…" carry the ellipsis that says more
 * comes: the press brings the whole onto the stage, where the owner's own form fires it. "Open" opens at once, because opening is
 * harmless. Each word is its locale key with its English. Read by the station's `NeedItem` (the rail's item) and `AskStage`
 * (an ask's kind, said over what it would do).
 */
export const STATION_NEED_KINDS: Readonly<Record<StationNeedKind, { icon: LucideIcon; word: LocaleWords; warn: boolean; act: LocaleWords }>> = {
  accept: {
    icon: Stamp,
    word: { key: 'station.needs.kind.accept', english: 'Accept' },
    warn: true,
    act: { key: 'station.needs.act.queue', english: 'Queue…' },
  },
  questions: {
    icon: MessagesSquare,
    word: { key: 'station.needs.kind.questions', english: 'Questions' },
    warn: false,
    act: { key: 'station.needs.act.answer', english: 'Answer…' },
  },
  permission: {
    icon: ShieldQuestion,
    word: { key: 'station.needs.kind.permission', english: 'Permission' },
    warn: false,
    act: { key: 'station.needs.act.allow', english: 'Allow…' },
  },
  question: {
    icon: MessageCircleQuestion,
    word: { key: 'station.needs.kind.question', english: 'Question' },
    warn: false,
    act: { key: 'station.needs.act.answer', english: 'Answer…' },
  },
  plan: {
    icon: ClipboardList,
    word: { key: 'station.needs.kind.plan', english: 'Plan' },
    warn: false,
    act: { key: 'station.needs.act.allow', english: 'Allow…' },
  },
  followups: {
    icon: ListChecks,
    word: { key: 'station.needs.kind.followups', english: 'Follow-ups' },
    warn: false,
    act: { key: 'station.needs.act.open', english: 'Open' },
  },
  check: {
    icon: ShieldAlert,
    word: { key: 'station.needs.kind.check', english: 'Red check' },
    warn: true,
    act: { key: 'station.needs.act.open', english: 'Open' },
  },
};

// ---------------------------

//----------------- THE STATION'S BOXES OUT OF REACH ------------

/**
 * The props that take a box of Kaylee Station out of the tab order, the reading order and the press while it stands drawn under
 * something or behind it: `inert` (spelled as the string React 18 carries) and `aria-hidden`. Spread on the box: by compact's and
 * the phone's arrangements on the strip's line (and compact's switch) while the strip's week stands over them, and by the sections
 * on every section not shown.
 */
export const STATION_OUT_OF_REACH = { inert: '', 'aria-hidden': true } as unknown as HTMLAttributes<HTMLDivElement>;

// ---------------------------

//----------------- THE STATION PHONE'S SIDEWAYS CATCH ------------

/**
 * A press of Kaylee Station's phone top row on its side, where the row is 40 px: drawn 40 px tall, its catch grown over and under
 * it by a transparent `::before`, so a finger still has 44 px (the touch law's own way to grow a press without moving its
 * neighbours, INV-10275). The `::before` stands on the press's padding box and reaches 4 px past it: worn by two borderless ghost
 * presses, her menu's trigger (the station's `HeadRow`) and the count of what needs him (`StationPhoneView`), whose catch is 48 px.
 */
export const STATION_SIDEWAYS_CATCH = "relative h-10 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";

/**
 * A press of the strip's count form (the phone's 40 px top row on its side) that keeps its own drawn size: its catch grown 8 px past
 * its padding box by a transparent `::before`, so its 32 px pill or 36 px outlined box (a 1.5 px border inside it) catches 44 px
 * and more. Worn by the strip's "<n> new" chip (`SinceYouLastLooked`) and its Try again (`StripLines`).
 */
export const STATION_COUNT_FORM_CATCH = "relative before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']";
