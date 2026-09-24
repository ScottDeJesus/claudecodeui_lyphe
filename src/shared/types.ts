import type { EditorState } from '@codemirror/state';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';

//----------------- LLM PROVIDER MODEL CATALOG ------------

/** Identifies which coding-agent CLI backs a session, project selection or model list. */
export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'opencode';

/** One selectable model in a provider's model menu, including its optional reasoning-effort choices. */
export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  recordId?: number;
  isCustom?: boolean;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

/** The full model catalog for one provider: every option plus the value used when the user has not chosen one. */
export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
};

/** User-supplied fields for creating or editing a custom provider model entry. */
export type CustomProviderModelInput = {
  model: string;
  id: string;
};

/** Mutation callbacks a model menu calls to persist custom provider models. */
export type ProviderModelActions = {
  create(provider: LLMProvider, input: CustomProviderModelInput): Promise<void>;
  update(
    provider: LLMProvider,
    existing: ProviderModelOption,
    input: CustomProviderModelInput,
  ): Promise<void>;
  remove(provider: LLMProvider, existing: ProviderModelOption): Promise<void>;
};

// ---------------------------

//----------------- PROJECTS AND SESSIONS ------------

/** Identifies the workspace pane the user is looking at; plugin panes are namespaced by plugin id. */
export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'browser' | 'memory' | 'runner' | 'heal' | 'api' | 'kanban' | 'universe' | 'schedules' | `plugin:${string}`;

/** A message queued to be sent to a session at a future time. */
export type ScheduledMessage = {
  id: string;
  sessionId: string;
  content: string;
  options: Record<string, unknown>;
  /** ISO instant, so the schedule does not move when the user changes time zone. */
  scheduledFor: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  /** Why it did not go, when `status` is `failed`. */
  failureReason: string | null;
  createdAt: string;
};

/** A single conversation inside a project, as returned by the sessions API and rendered in the sidebar and chat. */
export type ProjectSession = {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  provider?: LLMProvider;
  __provider?: LLMProvider;
  // Tags the session with the owning project's DB `projectId` so UI handlers
  // (session switching, sidebar focus, etc.) can match against selectedProject.
  __projectId?: string;
  [key: string]: unknown;
};

/** Pagination metadata returned alongside a project's session page. */
type ProjectSessionMeta = {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
};

/** Task Master provisioning state for a project, used to decide whether the tasks tab is available. */
type ProjectTaskmasterInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

// After the projectName → projectId migration the backend no longer returns a
// folder-derived `name` string. Projects are now addressed everywhere by the
// DB-assigned `projectId` (primary key in the `projects` table), and the UI
// uses the same identifier for routing, state keys and API calls.
/** A workspace project as the UI knows it: identity, path, star state and its loaded sessions. */
export type Project = {
  projectId: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isStarred?: boolean;
  sessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
};

/**
 * One repository the git tab's strip carries: the registered project behind it, narrowed to the
 * three fields the tab reads. Built by the project-workspace state provider and memoised on those
 * fields, so a project-list refresh that changes none of them re-renders nothing in the tab.
 */
export type GitRepository = Pick<Project, 'projectId' | 'fullPath' | 'displayName'>;

/** A project a new chat can start in, as the new-chat screen's project picker lists it. */
export type ProjectChoice = Pick<Project, 'projectId' | 'displayName'>;

/** Progress payload streamed while the backend enumerates projects, used to drive the sidebar loading bar. */
export type LoadingProgress = {
  kind?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
};

// ---------------------------

//----------------- RELEASES ------------

/** The latest GitHub release for the app, rendered by the update prompt and the About tab. */
export type ReleaseInfo = {
  title: string;
  body: string;
  htmlUrl: string;
  publishedAt: string;
};

/** How this CloudCLI install was obtained; decides whether the UI offers a self-update action. */
export type InstallMode = 'git' | 'npm';

// ---------------------------

//----------------- SESSION PROCESSING STATE ------------

/** What a session that is currently producing a response is doing, as shown by the activity indicator. */
export type SessionActivity = {
  /** Provider-supplied status line; null renders the default activity label. */
  statusText: string | null;
  canInterrupt: boolean;
  /**
   * When this request was first marked as processing (client clock). Drives
   * the elapsed-time display and the stale `chat_subscribed` idle-ack guard.
   */
  startedAt: number;
};

/** Every session currently producing a response, keyed by session id. Read it to tell whether a session is busy. */
export type SessionActivityMap = ReadonlyMap<string, SessionActivity>;

/** Marks a session as producing a response; call it as soon as a send is dispatched so the UI reacts immediately. */
export type MarkSessionProcessing = (
  sessionId?: string | null,
  activity?: { statusText?: string | null; canInterrupt?: boolean },
) => void;

/** Marks a session as finished; `ifStartedBefore` lets a late acknowledgement clear only a stale run. */
export type MarkSessionIdle = (
  sessionId?: string | null,
  opts?: { ifStartedBefore?: number },
) => void;

/** Replaces the whole processing map with the server's view, used by the periodic running-sessions poll. */
export type SyncProcessingSessions = (
  sessions: readonly SessionActivitySnapshot[],
  /** A session the server does not list but that must stay marked — its send is still on the way. */
  isStillSending?: (sessionId: string) => boolean,
) => void;

/** Reports whether one session is currently producing a response. */
export type IsSessionProcessing = (sessionId?: string | null) => boolean;

/** One running session as reported by the server, before it is folded into the client-side activity map. */
export type SessionActivitySnapshot = {
  sessionId: string;
  statusText?: string | null;
  canInterrupt?: boolean;
  startedAt?: number;
};

/**
 * One in-flight run as reported by `GET /api/providers/sessions/running`,
 * carrying the project it belongs to.
 *
 * The project identity travels with the run so the sidebar's Running list can
 * be built from the server's run registry rather than from the sessions a
 * client happens to have paged in.
 */
export type RunningSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  startedAt?: number;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  lastActivity: string | null;
  /** A question or permission prompt in this run is waiting on the user. */
  awaitingInput: boolean;
};

// ---------------------------

//----------------- REALTIME TRANSPORT ------------

/**
 * One frame received from the chat websocket. The server guarantees every
 * frame carries a `kind` (provider message kinds plus gateway kinds such as
 * `chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`). The synthetic `websocket_reconnected` kind is injected
 * client-side when the socket re-opens after a drop.
 */
export type ServerEvent = {
  kind?: string;
  type?: string;
  sessionId?: string;
  seq?: number;
  [key: string]: unknown;
};


// ---------------------------

//----------------- VERVE DESIGN TOKENS ------------

/**
 * The closed set of Verve tone slots. A component sets `data-tone` to one of these and the
 * tone's fill, ink, dot and glyph arrive as inherited custom properties from the
 * `[data-tone]` rules in `src/shared/ui/verve/tokens.css` — a component never writes a tone
 * rule of its own, and the set never grows, because two spellings for one state is exactly
 * what the token swap exists to prevent. Note `warn` covers errors: red is reserved for
 * destructive or denied.
 */
export type Tone = 'neutral' | 'info' | 'positive' | 'warn' | 'danger';

// ---------------------------

//----------------- TOASTS ------------

/**
 * What a caller hands `useToast()` to raise one toast. A toast is ADVISORY — it says what
 * just happened and then leaves — so nothing may depend on the reader having seen it; the
 * durable record of an outcome belongs on the screen that owns the outcome.
 */
export type ToastRequest = {
  tone: Tone;
  title: string;
  message?: string;
};

/**
 * One toast as the provider holds it: the request plus the two things only the stack knows.
 * `id` is a monotonic counter (not an index — ids must stay unique after the oldest is
 * dropped), and `leaving` is true for the 550 ms the leave animation runs, which is why a
 * row is still in the list after its dismissal has begun.
 */
export type ToastRecord = ToastRequest & {
  id: number;
  leaving: boolean;
};

// ---------------------------

//----------------- SHARED UI PRIMITIVES ------------

/** Progress state of a single queue row, driving the indicator the Queue primitive renders. */
export type QueueItemStatus = 'completed' | 'in_progress' | 'pending';

/**
 * One answer a `ConfirmDialog` offers, drawn as a library `Button` in the order given.
 *
 * `variant` is the Button's own paint — `destructive` only for the answer that throws work away,
 * `outline` for the one that backs out. `busy` disables the button while the work it started is
 * in flight, so a second press cannot start it twice.
 */
export type ConfirmDialogAction = {
  label: string;
  variant: 'default' | 'destructive' | 'outline' | 'ghost';
  onSelect: () => void;
  busy?: boolean;
};

// ---------------------------

//----------------- AUTH ------------


// ---------------------------

//----------------- CHAT MESSAGES AND PERMISSIONS ------------

/** Permission preset a provider runs a turn under ('default', 'acceptEdits', 'auto', 'bypassPermissions' or 'plan'), chosen in the composer and sent with each message; the backend capability matrix decides which values a given provider accepts. */
export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan';

/** A non-image file attached to a chat message, described by its path in the server-managed attachment store plus display metadata so it can be listed and downloaded. */
export type ChatAttachment = {
  /** Absolute path inside the server-managed chat attachment store. */
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

/** A chat attachment that is an image, extending ChatAttachment with the inline base64 data URL that Claude history uses when no stored path is available. */
export type ChatImage = {
  /** Inline data URL (Claude history stores image attachments as base64). */
  data?: string;
} & ChatAttachment;

/** One stored memory an assistant reply drew on, naming the file and line range read plus what was taken from it, shown as a footnote under the reply so a memory-derived claim stays traceable. */
export type MemoryCitation = {
  /** File and line range that was read, e.g. `MEMORY.md:137-142`. */
  source: string;
  /** What the reply took from that range, when the provider states it. */
  note?: string;
};

/** One entry in a subagent's recorded timeline, normalized by the backend from either provider's transcript; `kind` decides whether the tool fields or `content` carry the entry, so read only the set that matches. */
export type SubagentActivity = {
  kind: 'tool' | 'text' | 'thinking';
  timestamp?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  content?: string;
};

/** Identity and lifecycle of one spawned subagent as the backend reports it; present on the tool call that spawned the agent and used to draw its container header. */
export type SubagentInfo = {
  id: string;
  name?: string;
  type?: string;
  description?: string;
  /** `stopped` is the reader's own Stop, an interrupt or a teardown — not a failure. */
  status: 'running' | 'completed' | 'failed' | 'stopped';
  model?: string;
  /** Total entries the agent recorded, which exceeds the received timeline when a long run was truncated for transport. */
  activityCount?: number;
  /** What the agent has spent so far, when the provider records usage (today: Claude). */
  usage?: SubagentUsage;
  /**
   * The latest `SendMessage` call that resumed this agent after it had stopped, when one did
   * (today: Claude). Its tool-use id tells the live projection which resume the status already
   * accounts for; a newer one in the stream is still running.
   */
  resume?: { toolUseId: string; at?: string };
};

/**
 * A subagent's token reading. `contextTokens` is its context window as of its latest request
 * (input, cache creation, cache read and reply of that request, summed — the figure Claude Code
 * reports as the agent's `totalTokens`); `outputTokens` is everything it wrote across its
 * `requests`. Mirrors the server's `SubagentUsage` in server/shared/types.ts.
 */
export type SubagentUsage = {
  contextTokens: number;
  outputTokens: number;
  requests: number;
};

/** One rendered entry in a chat transcript — user turn, assistant turn, tool call and result, local command output, or subagent container — and the shape the chat message list and message components consume. */
export type ChatMessage = {
  type: string;
  content?: string;
  displayText?: string;
  timestamp: string | number | Date;
  images?: ChatImage[];
  files?: ChatAttachment[];
  /** The model id that produced this assistant turn, when the provider records one; the transcript resolves it to a catalog label so a raw id never reaches the screen. */
  model?: string;
  /**
   * The provider's identifier for the transcript row behind this message, when
   * the provider has stable per-row identity. Present on user turns from
   * Claude; it is the anchor "edit this message" and "fork from here" send back.
   */
  transcriptAnchorId?: string;
  /**
   * Set on the optimistic echo of a message being sent as a replacement for an
   * already-sent one, naming the anchor it replaces. Local to this client.
   */
  replacesAnchorId?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isToolUse?: boolean;
  /** The result text a background task notification carried, shown as prose; not the model's own reply. */
  isTaskResult?: boolean;
  /** A tool result that arrived with no tool call to attach to, shown as prose; not the model's own reply. */
  isOrphanToolResult?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  isSubagentContainer?: boolean;
  /** The agent this row spawned, when it spawned one. Its presence is what makes a row a subagent container. */
  subagent?: SubagentInfo;
  /** What that agent did, in order. Empty while the agent is still starting up. */
  subagentActivity?: SubagentActivity[];
  /**
   * What that agent has spent, from the fresher of the server's reading and the live fold —
   * separate from `subagent` because a live spawn has no server metadata at all, and a
   * synthesized `subagent` would have to invent the status that field is read for.
   */
  subagentUsage?: SubagentUsage;
  /** The provider a subagent container ran on, so its pinned row can wear that provider's mark. */
  subagentProvider?: LLMProvider;
  /** The model a spawned agent ran on: its history record's, else the newest one its live turns named. */
  subagentModel?: string;
  /** Stored memory this reply drew on, shown as a footnote beneath it. */
  memoryCitations?: MemoryCitation[];
  /** Lifecycle the provider reported for this tool call, when it reports one; otherwise the status is inferred from whether a result has arrived. */
  toolStatus?: string;
  [key: string]: unknown;
};

/** The user's locally persisted Claude preferences (allowed and disallowed tool lists, permission skipping and project sort order) read from and written back to browser storage. */
export type ClaudeSettings = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
};

/** A proposed Claude tool-permission rule derived from a denied tool call, offered to the user so that tool can be added to the stored allow list in one click. */
export type ClaudePermissionSuggestion = {
  toolName: string;
  entry: string;
  isAllowed: boolean;
};

/** Outcome of writing a tool-permission rule into the stored Claude settings, reporting whether it succeeded, whether the rule was already allowed, and the resulting settings. */
export type PermissionGrantResult = {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ClaudeSettings;
};

/** A tool-permission request awaiting the user's decision, identified by its requestId and carrying the tool name, input and context needed to render the prompt and reply to the backend. */
export type PendingPermissionRequest = {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  receivedAt?: Date;
};

/** One question asked by the AskUserQuestion tool, with its answer options and whether more than one option may be selected. */
export type Question = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

/** Options for a programmatic session navigation, currently only whether the route change should replace the current history entry instead of pushing a new one. */
export type SessionNavigationOptions = {
  replace?: boolean;
};

/** Context handed to the workspace when a chat run creates a session, naming the provider that created it, the owning project and the session summary, so the session can be selected and labelled. */
export type SessionEstablishedContext = {
  provider: LLMProvider;
  project: Project;
  summary?: string | null;
};

/** The result returned for a tool call, carrying its content, error flag, timestamp and any provider-specific extras that the tool renderers read. */
export type ToolResult = {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
};

/** One selectable answer for a Question, with the label shown to the user and an optional explanatory description. */
type QuestionOption = {
  label: string;
  description?: string;
};

// ---------------------------

//----------------- CHAT SESSION STORE ------------

/** A provider-agnostic transcript event as normalized by the backend adapters, with all kind-specific fields kept flat; it is the shape the session store holds and that chat converts into ChatMessage for rendering, so treat it as the wire contract rather than a view model. */
export type NormalizedMessage = {
  id: string;
  /**
   * The provider's own id for the transcript row behind this message, when the
   * provider has stable per-row identity (today: Claude). Sent back as the
   * anchor for "edit this message" and "fork from here".
   */
  transcriptAnchorId?: string;
  /**
   * Set only on the client-side optimistic echo of an edited message, naming
   * the anchor that echo replaces. Never sent by the backend.
   *
   * The truncation that follows an edit clears every live row, because they
   * belonged to the turn being replaced. This tag is what tells the store the
   * replacement itself is not one of them.
   */
  replacesAnchorId?: string;
  /**
   * How many persisted rows survived the cut this echo was sent for, stamped
   * when the truncation is applied.
   *
   * The echo is retired once the provider persists it, and that is decided by
   * matching text and attachments inside a time window. That is enough until a
   * rewind re-stamps the surviving turns — a provider that has to branch
   * writes the copy with the timestamps of the copy — because an earlier turn
   * with the same words then sits inside the window and retires the message
   * the user just sent. The replacement can only be a row that was not there
   * when the cut was made, so this is where those rows begin.
   */
  replacesAfterRowCount?: number;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  /**
   * Per-run monotonic sequence number assigned by the backend to live
   * websocket events. Used to compute `lastSeq` for `chat.subscribe` replay;
   * REST history messages do not carry it.
   */
  seq?: number;

  // kind-specific fields (flat for simplicity)
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * The model id that produced this assistant turn, when the provider records one
   * per row (today: Claude). A conversation can change model mid-way, so this
   * belongs to the turn and not to the session. Mirrored, with this same comment,
   * on the server's own NormalizedMessage in server/shared/types.ts.
   */
  model?: string;
  /**
   * Mirrors optional transcript metadata from the server.
   *
   * These fields are currently used by Claude history normalization so local
   * slash commands, local stdout, and compact summaries do not disappear when
   * the session store hydrates from REST history.
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  images?: Array<{ path?: string; data?: string; name?: string }>;
  files?: Array<{ path?: string; name?: string; mimeType?: string; size?: number }>;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: { content: string; isError: boolean; toolUseResult?: unknown; timestamp?: string } | null;
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: unknown;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  newSessionId?: string;
  status?: string;
  summary?: string;
  exitCode?: number;
  actualSessionId?: string;
  parentToolUseId?: string;
  /**
   * This assistant row's request, reduced to the two figures a subagent is read by. Rows cut
   * from one API message share a `usageMessageId`, and a streamed message arrives as several
   * rows whose `outputTokens` grows — keep the LAST value per id, never a sum of rows.
   */
  usage?: { contextTokens: number; outputTokens: number };
  usageMessageId?: string;
  /** Timeline of a spawned subagent's work, attached by the backend to the tool call that spawned it. */
  subagentTools?: SubagentActivity[];
  /** Identity and lifecycle of that subagent. */
  subagent?: SubagentInfo;
  /** Stored memory this reply drew on, when the provider reports it. */
  memoryCitations?: MemoryCitation[];
  isFinal?: boolean;
  // Cursor-specific ordering
  sequence?: number;
  rowid?: number;
};

/** Discriminator on NormalizedMessage naming which kind of transcript event it carries — plain text, tool use or result, thinking, stream delta or end, error, completion, status, permission request/resolution/cancellation, session creation, interactive prompt, or task notification. */
type MessageKind =
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'stream_delta'
  | 'stream_end'
  | 'error'
  | 'complete'
  | 'status'
  | 'permission_request'
  | 'permission_resolved'
  | 'permission_cancelled'
  | 'session_created'
  | 'history_truncated'
  | 'task_notification';

// ---------------------------

//----------------- CHAT COMPOSER ------------

/** Result payload of the chat `/model` slash command, describing the session's current provider and model plus the model catalog it may switch to, used to populate the command modal's model picker. */
export type ModelCommandData = {
  current?: {
    provider?: string;
    providerLabel?: string;
    model?: string;
  };
  available?: Partial<Record<LLMProvider, string[]>>;
  availableModels?: string[];
  availableOptions?: ProviderModelOption[];
  defaultModel?: string;
};

/** Result payload of the chat `/cost` slash command, carrying the session's token usage totals and input/output breakdown for the command modal's usage view. */
export type CostCommandData = {
  tokenUsage?: {
    used?: number;
    total?: number;
  };
  tokenBreakdown?: {
    input?: number;
    output?: number;
  };
  /** Everything generated across the whole conversation, read from the transcript. */
  sessionOutputTokens?: number;
  provider?: string;
  model?: string;
};

/** Result payload of the chat `/status` slash command, carrying server version, uptime, provider/model and process telemetry for the command modal's status view. */
export type StatusCommandData = {
  version?: string;
  packageName?: string;
  uptime?: string;
  model?: string;
  provider?: string;
  nodeVersion?: string;
  platform?: string;
  pid?: number;
  memoryUsage?: {
    rssMb?: number;
    heapUsedMb?: number;
    heapTotalMb?: number;
  };
};

/** Result payload of the chat `/help` slash command, carrying either pre-rendered help content or the list of available commands for the command modal's help view. */
export type HelpCommandData = {
  content?: string;
  format?: string;
  commands?: Array<{
    name: string;
    description?: string;
    namespace?: string;
  }>;
};

/** Wrapper pairing a CommandModalKind with its matching command result data; pass it as the single payload prop that tells the chat command modal which slash-command result to render, or null to close it. */
export type CommandModalPayload = {
  kind: CommandModalKind;
  data: HelpCommandData | ModelCommandData | CostCommandData | StatusCommandData;
};

/** A composer message queued while its session is still busy, holding the text, the in-memory and already-uploaded attachments and the send options snapshotted at queue time so it can be auto-sent unchanged once the session goes idle. */
export type QueuedDraft = {
  /**
   * Minted once when the message is queued, and kept through every save. The server remembers the
   * id it last sent per session and ignores a save that brings it back, so a retried or stale save
   * cannot send the message twice — while queueing the same text again, a new id, still works.
   */
  id?: string;
  content: string;
  /** Browser files retained while this composer stays mounted, for editing. */
  attachments: File[];
  /** JSON-safe descriptors uploaded when the message is queued. */
  uploadedAttachments?: unknown[];
  /**
   * Send options snapshotted at queue time. Persisted with the draft so the
   * app-level auto-send can dispatch the message with the right model and
   * permission settings while another session is being viewed.
   */
  options?: QueuedSendOptions;
};

/** Viewport-relative placement box (right/bottom offsets plus max height and width) computed for a composer popover so the model and permission menus stay inside the window. */
export type ComposerMenuAnchor = {
  right: number;
  bottom: number;
  maxHeight: number;
  maxWidth: number;
};

/** One selectable slash command — built-in, user-defined or skill-backed — as listed in the chat composer's command menu and executed when the user picks it. */
export type SlashCommand = {
  name: string;
  description?: string;
  namespace?: string;
  path?: string;
  type?: 'built-in' | 'custom' | 'skill' | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Discriminator naming which slash-command result the chat command modal is showing: 'help', 'models', 'cost' or 'status'. */
type CommandModalKind = 'help' | 'models' | 'cost' | 'status';

// ---------------------------

//----------------- CHAT VOICE ------------

/** Lifecycle state of the composer's push-to-talk microphone: 'idle', 'recording' or 'transcribing'. */
export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

/** Immutable snapshot of the app-level text-to-speech player for one utterance — its play state plus any error message — read by components so read-aloud state survives re-renders and chat switches. */
export type VoiceSnapshot = { state: VoicePlayState; error: string | null };

/** Playback state of a text-to-speech utterance: 'idle', 'loading' or 'playing'. */
export type VoicePlayState = 'idle' | 'loading' | 'playing';

// ---------------------------

//----------------- CHAT STORAGE ------------

/**
 * Composer options captured when a message is queued, so the message can be
 * sent later with the exact settings (model, permission mode, tools) the
 * session's composer had at queue time — even from outside the composer,
 * e.g. the app-level auto-send that fires while another session is viewed.
 */
export type QueuedSendOptions = Record<string, unknown>;

// ---------------------------

//----------------- CHAT MESSAGE RENDERING ------------

/** Function that turns an old/new string pair into rendered diff lines; the chat session state supplies one memoized, caching instance so each file diff is computed only once. */
export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

/** A synthetic transcript entry standing for a run of consecutive calls to the same tool, produced by the message grouping pass and identified by its `_isGroup` flag so the message list can collapse the run into one expandable block. */
export type ToolGroupItem = {
  _isGroup: true;
  toolName: string;
  messages: ChatMessage[];
  timestamp: ChatMessage['timestamp'];
  /**
   * Summary line for the collapsed group, built while grouping so the tool-input
   * JSON parsing it needs never runs during render.
   */
  preview: string;
};

/** One line of a rendered file diff, marked 'added' or 'removed', with its text and line number. */
export type DiffLine = {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
};

/** How many lines one file edit added and removed, for the `+12 -3` badge on a diff's header. */
export type DiffStats = {
  added: number;
  removed: number;
};

// ---------------------------

//----------------- CHAT TOOL RENDERING ------------

/** One entry of an agent todo list as produced by the TodoWrite/TodoRead tools, rendered as a single status row in the tool todo-list view. */
export type TodoItem = {
  id?: string;
  content: string;
  status: string;
  priority?: string;
  activeForm?: string;
};

/** Display state of a tool call — 'running', 'completed', 'error' or 'denied' — used to choose the status badge and styling shown beside it in the transcript. */
export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

/** Props contract that every interactive permission panel implements, giving the panel the pending request and the callback it calls to allow or deny that request; use it when registering a panel in the permission panel registry. */
export type PermissionPanelProps = {
  request: PendingPermissionRequest;
  onDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; updatedInput?: unknown },
  ) => void;
};

// ---------------------------

//----------------- FILE TREE ------------

/** Progress, completion or failure state of one in-flight file-tree upload, produced by the upload hook and rendered by the file tree's progress banner. */
export type FileTreeUploadProgressState = {
  status: 'uploading' | 'complete' | 'error';
  progress: number;
  fileCount: number;
  uploadedCount?: number;
  fileName?: string;
  targetPath?: string;
  error?: string;
};

/** Which density the file tree renders its rows at (simple, compact or detailed), chosen in the file tree header and persisted in local storage. */
export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

/** One file or directory entry in a project's file listing, with directories carrying their loaded `children`; used across the file tree for rendering, searching and filtering. */
export type FileTreeNode = {
  name: string;
  type: FileTreeItemType;
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileTreeNode[];
  [key: string]: unknown;
};

/** Whether a file tree entry is a file or a directory; use it instead of repeating the string union wherever `FileTreeNode`-shaped data is handled. */
type FileTreeItemType = 'file' | 'directory';

// ---------------------------

//----------------- FILE MANAGER ------------
// The four bodies the files API answers with, mirroring `server/shared/types.ts`'s group of
// the same name field for field. Read the field-by-field rationale there; the rule that binds
// every one of them is that `null` means the app never learned the value — never `0`, never an
// invented timestamp, and never rendered as either.

/**
 * One row of a directory listing as the file manager renders it.
 *
 * `kind` is the entry's own kind, read without following symlinks, so a link to a directory
 * reports `file` and cannot present itself as a folder to descend into. `bytes` and `mtime`
 * are `null` when the server's per-entry `lstat` failed; both render as `—`.
 */
export type DirectoryEntry = {
  name: string;
  kind: 'file' | 'dir';
  bytes: number | null;
  mtime: string | null;
};

/**
 * One directory the file manager is showing, and everything in it.
 *
 * `path` is the RESOLVED ABSOLUTE directory the server actually read — relativize it against
 * the project path before showing it to a person. Entries arrive directories-first then by
 * name, so nothing re-sorts them here.
 */
export type DirectoryListing = {
  path: string;
  entries: DirectoryEntry[];
};

/**
 * What the preview pane can show for one file — a closed set of three, switched on `kind`.
 *
 * `text` carries `lines.length` lines already split, beginning at `startLine`, with `totalLines`
 * `null` when the READ did not walk the whole file rather than whenever the file is big — a window
 * near the end of a large one reaches EOF anyway and answers with a real count, which is what lets
 * the file manager tell a line that is past the end from one that simply is not in this window;
 * `image` carries no pixels (the browser loads them through the content stream and measures them
 * itself); `none` is a binary this app will not guess at, and download is the only action offered.
 */
export type FilePreview =
  | {
      kind: 'text';
      lines: string[];
      /**
       * The line number `lines[0]` carries — 1 for a window opened at the top, and whatever a
       * file reference's `:line` asked for otherwise. The preview pane numbers its rows from
       * this, so it is never an offset the client has to remember alongside the text. When
       * `lines` is empty this is still the window that was asked for, and the file ends before it.
       */
      startLine: number;
      totalLines: number | null;
      truncated: boolean;
      bytes: number | null;
      mtime: string | null;
      language: string | null;
    }
  | { kind: 'image'; mime: string; bytes: number | null; mtime: string | null }
  | { kind: 'none'; bytes: number | null; mtime: string | null };

//----------------- FILE EDITING ------------

/** One window of a text file read for editing: whole lines, never clipped. */
export type FileEditWindow = {
  /** Project-relative path, echoed as asked. */
  path: string;
  /** Opaque revision token of the file the lines were read from. */
  rev: string;
  /** 1-based number of `lines[0]`; echoes the clamped `start`. */
  startLine: number;
  /** Each line without its terminator and without one trailing `\r`. */
  lines: string[];
  /** True when this read reached the file's last line. */
  eof: boolean;
  /** The file's line count when known, else null. */
  totalLines: number | null;
  /** The file's FIRST line terminator; `'\n'` when the file has none. */
  eol: '\n' | '\r\n';
};

/** One contiguous line-range replacement against revision `baseRev`. */
export type FileLinePatch = {
  /** Project-relative path of the file to patch. */
  path: string;
  /** Revision the replacement is written against; a moved file is refused. */
  baseRev: string;
  /** 1-based first ORIGINAL line replaced; `totalLines + 1` appends. */
  startLine: number;
  /** Original lines removed from `startLine`, `>= 0`. */
  deleteCount: number;
  /** Replacement lines; none contains `\n` or `\r`. */
  lines: string[];
};

/** What a successful patch left on disk. */
export type FilePatchResult = {
  /** Project-relative path that was written. */
  path: string;
  /** The file's revision after the write. */
  rev: string;
  /** The file's line count after the write. */
  totalLines: number;
};

/** Where the editor's document sits in the file at revision `rev` (held in CodeMirror state). */
export type EditWindowMeta = {
  /** Original line number of the document's first line. */
  lo: number;
  /** ORIGINAL lines (at rev) the document represents, edits inside the touched span included. */
  origCount: number;
  /** The document reaches the file's last line. */
  eof: boolean;
  /** The revision the document's original lines were read from. */
  rev: string;
  /** The file's line terminator, used when writing edits back. */
  eol: '\n' | '\r\n';
  /** The ORIGINAL file's line count at rev, when known. */
  totalLines: number | null;
};

/** What the file editor shows about itself; FileEditor renders it and the probes read it off data-* attributes. */
export type FileEditorStatus = {
  /** Where the editor is in its lifecycle. */
  phase: 'loading' | 'ready' | 'saving' | 'conflict' | 'error';
  /** True while the document holds edits the file does not. */
  dirty: boolean;
  /** Current-file numbering of the document's first line. */
  firstLine: number;
  /** Current-file numbering of the document's last line. */
  lastLine: number;
  /** Current-file total: original total plus the document's line delta, when known. */
  totalLines: number | null;
  /** The sentence the conflict/error banner shows. */
  message: string | null;
  /** The line where fetching stopped because it is too long, else null. */
  longLineStop: number | null;
};

/** The one edit session the app holds, as the file manager sees it. */
export type EditSessionStatus = {
  /** Project the session's file belongs to. */
  projectId: string;
  /** Project-relative path of the file being edited. */
  path: string;
  /** The file line the session was opened at. */
  anchorLine: number;
  /** True while the session holds unsaved edits. */
  dirty: boolean;
};

/** The stored session: status plus the live CodeMirror state, kept across unmounts. */
export type EditSessionRecord = EditSessionStatus & {
  /** The live editor state, or null before the view has been built. */
  state: EditorState | null;
  /** The host element's scroll offset at the last unmount. */
  scrollTop: number;
};

/** What the pure window policy reads (windowPolicy.ts) and the hook fills in from the view. */
export type WindowPolicyInput = {
  /** Original line number of the document's first line. */
  lo: number;
  /** ORIGINAL lines the document represents. */
  origCount: number;
  /** The document's current line count. */
  docLines: number;
  /** Whether the document reaches the file's last line. */
  eof: boolean;
  /** First document line in the viewport. */
  top: number;
  /** Last document line in the viewport. */
  bottom: number;
  /** Document lines a viewport holds (V). */
  viewportLines: number;
  /** Document line number where the touched span starts, or null when clean. */
  touchedFirst: number | null;
  /** Document line number where the touched span ends, or null when clean. */
  touchedLast: number | null;
  /** A request already in flight in that direction. */
  pending: { up: boolean; down: boolean };
};

/** One thing the hook must do to its window. */
export type WindowAction =
  | { kind: 'prepend'; start: number; lines: number }
  | { kind: 'append'; start: number; lines: number }
  | { kind: 'evictTop'; count: number }
  | { kind: 'evictBottom'; count: number };

/**
 * One file as an upload actually stored it.
 *
 * `name` is the SAVED name, which is not always the one the browser sent: an upload never
 * overwrites, so a taken name becomes `report (1).pdf` and `renamedFrom` carries the original.
 * `renamedFrom` is absent — not empty, not equal to `name` — when nothing was renamed, so its
 * presence alone is what tells the reader it happened.
 */
export type UploadedFileRecord = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  renamedFrom?: string;
};

// ---------------------------

//----------------- DOCUMENT PREVIEW ------------

/** A binary document the Files tab previews in place of its read-only arms. */
export type DocumentPreviewKind = 'pdf' | 'word' | 'sheet' | 'audio' | 'video';

/** A text file with a second, rendered view beside its lines. */
export type TextRenderingKind = 'markdown' | 'delimited';

/** What every kind view receives from DocumentPreview. */
export type DocumentViewProps = {
  /** The kind the registry matched, so one view can serve two (sheet + delimited, audio + video). */
  kind: DocumentPreviewKind | TextRenderingKind;
  /** The file's own name, for titles and alt text. */
  name: string;
  /** The file's bytes, already loaded by DocumentPreview. */
  blob: Blob;
};

/** Which of a rendered text file's two views is showing. */
export type PreviewView = 'rendered' | 'source';

/** The header's view toggle for a rendered text file. */
export type PreviewToggle = {
  /** The label of the rendered view: Markdown reads `Rendered`, CSV/TSV reads `Table`. */
  renderedLabel: 'Rendered' | 'Table';
  /** The label of the line view: Markdown reads `Source`, CSV/TSV reads `Text`. */
  sourceLabel: 'Source' | 'Text';
};

/** What the preview pane's body shows. */
export type PreviewBody =
  | { kind: 'editor' }
  | { kind: 'document'; document: DocumentPreviewKind | TextRenderingKind }
  | { kind: 'arms' };

/** choosePreviewBody's answer, read by both PreviewHeader and PreviewPane. */
export type PreviewChoice = {
  /** The body the pane renders. */
  body: PreviewBody;
  /** Whether the header offers the Edit button. */
  canEdit: boolean;
  /** The header's view toggle, or null when the file has one view. */
  toggle: PreviewToggle | null;
};

// ---------------------------

//----------------- GIT PANEL ------------

/** The old/new text of a single edit a caller may attach to an open request. Vestigial: nothing in `src/` supplies one, and nothing reads it. */
type FileDiffInfo = {
  old_string: string;
  new_string: string;
};

/** Callback for "open this path", crossed by the chat's file cards and links, the git panel's changed-file rows and the file tree: the workspace brings the Files tab forward and the file manager previews the file. `diffInfo` is dropped by the handler at the end — the preview is read-only, so do not wire a diff view to it expecting one. It is also NOT a spare slot: `ToolRenderer` passes a real diff object there, so a LINE NUMBER never rides this parameter. Opening at a line goes through `openFileAt` / `PaletteOps.openFileReference`, which carry it as their own second argument. */
export type FileOpenHandler = (filePath: string, diffInfo?: FileDiffInfo) => void;


/** Which of the git panel's two views is showing, driving both its tab strip and which list it renders. */
export type GitPanelView = 'changes' | 'history';

/** Single-letter git status of a changed file (M, A, D or U), used to pick its label, chip tone and change group. */
export type FileStatusCode = 'M' | 'A' | 'D' | 'U';

/** Payload of the git status endpoint: the current branch plus working-tree paths grouped by status, or the error and `notGitRepository` fields when the project has no usable repository. */
export type GitStatusResponse = {
  branch?: string;
  hasCommits?: boolean;
  modified?: string[];
  added?: string[];
  deleted?: string[];
  untracked?: string[];
  /**
   * Paths with index-side changes — mirrors the real git index. Wire shape only: these are a
   * subset flag over the four groups above, not extra paths, so the panel's changed-file list
   * would double-count them.
   */
  staged?: string[];
  error?: string;
  details?: string;
  /**
   * True when the project directory is not a git repository, which the panel states plainly.
   * It is not an invitation: initialising a repository is a write, and the panel only reads.
   */
  notGitRepository?: boolean;
};

/** Upstream state of the current branch (remote name, ahead/behind counts, up-to-date flag) that the git panel header reads to say how much of this branch the remote already has. */
export type GitRemoteStatus = {
  hasRemote?: boolean;
  hasUpstream?: boolean;
  branch?: string;
  remoteBranch?: string;
  remoteName?: string | null;
  ahead?: number;
  behind?: number;
  isUpToDate?: boolean;
  /**
   * ISO timestamp of the last push from THIS working copy, read off the upstream ref's own reflog
   * (a push records `update by push` there; a fetch records something else, and a push that moved
   * nothing records nothing at all). Null when that reflog holds no push entry — cloned here and
   * never pushed from here, or the entry expired — and absent on the responses for a branch with
   * no upstream, where no push was possible. Never a stand-in for a time the server did not find.
   */
  lastPushedAt?: string | null;
  message?: string;
  error?: string;
};

/**
 * Where the current branch stands against its upstream — ONE fact the git panel decides once
 * (`describeUpstreamPosition`, from the server's own `hasUpstream` / `hasCommits` flags, never
 * from the TYPE of `ahead`) and hands to its header and its Changes view together, so the two
 * cannot disagree. Three of the four kinds are unknowns, and none of them may render as a
 * branch with nothing left to push (design handoff §5: "we don't know" never looks like zero).
 */
export type UpstreamPosition =
  /** The remote-status read failed: nothing about the upstream is known, not even whether there is one. */
  | { kind: 'unread'; reason: string | null }
  /** Nothing has been committed, so nothing could have been pushed — a known zero, not an unknown. */
  | { kind: 'no-commits' }
  /** Commits exist but the branch tracks nothing, so how many are unpushed cannot be counted. */
  | { kind: 'no-upstream' }
  /** The branch tracks `remoteBranch` and is `ahead` commits past it. Only this kind can have a push time to show, so the header reads it from here rather than from a field that is null for three different reasons. */
  | { kind: 'tracked'; ahead: number; remoteBranch: string | null; lastPushedAt: string | null };

/** One commit in the history list, including the parent hashes and ref decorations the commit graph needs to lay out lanes. */
export type GitCommitSummary = {
  hash: string;
  author: string;
  email?: string;
  date: string;
  message: string;
  stats?: string;
  /** Parent commit hashes — drives the History view commit graph. */
  parents?: string[];
  /** Ref decorations, e.g. "HEAD -> main", "origin/main", "tag: v1.0". */
  refs?: string[];
};

/** Unified diff text keyed by commit hash, holding the diffs of commits the History view has opened. */
export type GitDiffMap = Record<string, string>;

/** The `error` and `details` fields any git API response may carry; intersect it with a route's own payload type instead of redeclaring them. */
export type GitApiErrorResponse = {
  error?: string;
  details?: string;
};

/** Pre-computed lane geometry for one row of the history commit graph, telling the graph strip which rails to draw above, through and below that commit's dot. */
export type CommitGraphRow = {
  /** Lane the commit dot sits in. */
  nodeLane: number;
  /** Total lanes visible in this row — determines the strip width. */
  laneCount: number;
  /** A line arrives at the node from the row above (some child expects this commit). */
  hasTopContinuation: boolean;
  /** The node's own lane continues below toward its first parent. */
  hasParentContinuation: boolean;
  /** Extra top lanes that merge into the node (multiple children / branch tips joining). */
  inbound: number[];
  /** Bottom lanes branching out of the node toward its extra parents (merge commits). */
  outbound: number[];
  /** Lanes whose lines pass straight through this row untouched. */
  passThrough: number[];
  /** Every lane still active below this row — rails continue through expanded content. */
  bottomLanes: number[];
};

// ---------------------------

//----------------- GIT DELEGATION ------------

/**
 * How far the delegated `/git` run has visibly got, read off the Bash commands the agent runs
 * — never off its prose. `starting` is the conversation opening, before any command has been
 * seen; the other four are named after the command that proved them, so the card can only
 * claim a step git itself was asked to take.
 */
export type GitDelegationStage = 'starting' | 'read' | 'group' | 'write' | 'push';

/**
 * What the git panel found to be TRUE once the run ended, computed from the panel's own git
 * reads rather than from anything the agent said. `not-pushed` is the one that carries a
 * `GitDelegationReason`; `agent-error` means the run itself broke, so git was never asked.
 */
export type GitDelegationOutcome =
  | 'pushed'
  | 'not-committed'
  | 'not-pushed'
  | 'agent-error'
  /**
   * The socket carrying the run went quiet or dropped, so the panel stopped following it. It
   * claims NOTHING about the push: the run may well have finished in its own conversation, and
   * that is where the reader is sent.
   */
  | 'connection-lost';

/**
 * Why a commit that exists was not pushed, matched against the last tool result the run
 * produced. `unknown` is the honest default — it says commits are waiting and sends the
 * reader to the conversation rather than guessing at a cause.
 */
export type GitDelegationReason =
  | 'rejected'
  | 'protected'
  | 'no-upstream'
  | 'conflict'
  | 'credentials'
  | 'unknown';

/**
 * The whole of what the git panel's "Push my changes" card shows, as one value with three
 * shapes so a finished run cannot be rendered without its receipt.
 *
 * Produced by `useGitDelegation` and consumed by `GitDelegationCard`. The finished shape is a
 * RECEIPT: every number in it was read once, when the run ended, and it does not move
 * afterwards — the live lists above the card are the live view, and the card says how long
 * ago it stopped being one.
 */
export type GitDelegationState =
  /**
   * Nothing is running HERE. `startError` is a press that never became a conversation, and
   * `blockedBySessionId` is the conversation that refused it — a checkpoint already running in
   * another project — so the card can offer a way into it rather than only naming it.
   */
  | { phase: 'idle'; startError: string | null; blockedBySessionId: string | null }
  | {
      phase: 'running';
      /** The repository the run was started from — the only panel that draws this run. */
      projectId: string;
      sessionId: string;
      startedAt: number;
      stage: GitDelegationStage;
    }
  | {
      phase: 'finished';
      projectId: string;
      sessionId: string;
      startedAt: number;
      finishedAt: number;
      outcome: GitDelegationOutcome;
      /** Only `not-pushed` has one; every other outcome leaves it null. */
      reason: GitDelegationReason | null;
      /** Commits this branch gained during the run, newest first, at most five — the receipt lines. */
      commits: GitCommitSummary[];
      /**
       * How many it gained in all, so a list cut at five can say that it was cut — or null when
       * this branch's commits could not be told from the window's, which is not a zero.
       */
      commitCount: number | null;
      /** Commits still waiting on the upstream when the run ended, or null when unknown. */
      ahead: number | null;
      /**
       * How many were already waiting when the button was pressed, or null when that could not
       * be read. It is what makes a receipt for a run that pushed work it did not write — a
       * clean tree that was simply behind — say what it pushed instead of nothing at all.
       */
      aheadWhenStarted: number | null;
    };

// ---------------------------

//----------------- MCP SERVERS ------------

/** The LLM provider whose MCP server configuration is being read or written; use it to key provider-specific MCP capabilities such as supported scopes and transports. */
export type McpProvider = LLMProvider;

/** Where an MCP server definition is stored - the user's global provider config, Claude's project-local config, or a project workspace config - and therefore which config file a read or write targets. */
export type McpScope = 'user' | 'local' | 'project';

/** How a client connects to an MCP server (a stdio subprocess, streamable HTTP, or SSE); use it to decide which connection fields of a server or form apply. */
export type McpTransport = 'stdio' | 'http' | 'sse';

/** A plain string-to-string map used for the MCP environment variables and HTTP headers that are edited as `KEY=value` lines and sent as objects. */
export type KeyValueMap = Record<string, string>;

// Internal MCP shape; `projectId` replaces the legacy `name` field from the
// projectName → projectId migration.
export type McpProject = {
  projectId: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** One MCP server as it is currently configured for a provider, as returned by the MCP API and rendered in the settings server list. */
export type ProviderMcpServer = {
  provider: McpProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  cwd?: string;
  url?: string;
  headers?: KeyValueMap;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: KeyValueMap;
  workspacePath?: string;
  projectName?: string;
  projectDisplayName?: string;
};

/** The complete editable state of the MCP server form, covering the structured connection fields and the raw JSON import text; convert it with createMcpPayloadFromForm before sending it to the API. */
export type McpFormState = {
  name: string;
  scope: McpScope;
  workspacePath: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: KeyValueMap;
  cwd: string;
  url: string;
  headers: KeyValueMap;
  envVars: string[];
  bearerTokenEnvVar: string;
  envHttpHeaders: KeyValueMap;
  importMode: McpImportMode;
  jsonInput: string;
};

/** The request body sent when creating or updating a provider's MCP server, built from McpFormState so only the fields valid for the chosen transport are included. */
export type UpsertProviderMcpServerPayload = {
  name: string;
  scope: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: KeyValueMap;
  cwd?: string;
  url?: string;
  headers?: KeyValueMap;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: KeyValueMap;
};

/** Whether the MCP server form is being filled in field by field or pasted in as raw JSON, which selects the form's input mode. */
type McpImportMode = 'form' | 'json';

// ---------------------------

//----------------- PLUGINS ------------

/** An installed CloudCLI plugin's manifest and runtime status (entry point, slot, permissions, enabled and server-running flags); always import this type explicitly from `@/shared/types`, because `Plugin` is also a DOM global and an unimported reference silently resolves to that instead. */
export type Plugin = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  type: 'react' | 'module';
  slot: 'tab';
  entry: string;
  server: string | null;
  permissions: string[];
  enabled: boolean;
  serverRunning: boolean;
  dirName: string;
  repoUrl: string | null;
};

// ---------------------------

//----------------- PRD EDITOR ------------

/** The PRD document the PRD editor should open, describing either an existing file to load (by path or inline content) or a blank draft to start from. */
export type PrdEditorFile = {
  name?: string;
  path?: string;
  // DB projectId used to resolve the project path when fetching file content.
  projectId?: string;
  content?: string;
  isExisting?: boolean;
};

/** A PRD already stored in a project's TaskMaster docs folder, used to detect filename collisions before saving and to load a previously written PRD. */
export type ExistingPrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
};

// ---------------------------

//----------------- PROJECT CREATION WIZARD ------------

/** The one-based index of the step currently shown by the project-creation wizard: 1 configures the workspace, 2 reviews it before creation. */
export type WizardStep = 1 | 2;

/** How the project-creation wizard authenticates a GitHub clone: reuse a 'stored' credential, enter a 'new' token, or use 'none' and rely on public access or an SSH key. */
export type TokenMode = 'stored' | 'new' | 'none';

/** One filesystem directory returned by the browse-filesystem endpoint, used to populate workspace-path autocomplete and the folder browser. */
export type FolderSuggestion = {
  name: string;
  path: string;
  type?: string;
};

/** A stored GitHub token credential as returned by the credentials endpoint, listed so the user can pick which token authenticates a clone. */
export type GithubTokenCredential = {
  id: number;
  credential_name: string;
  is_active: boolean;
};

/** The full set of user-entered values carried across the project-creation wizard's steps, owned by ProjectCreationWizard and passed down to each step. */
export type WizardFormState = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};

// ---------------------------

//----------------- PROJECT WORKSPACE ------------

/** The shared WebSocket connection and its send function, threaded through the workspace tree so descendants can exchange live session messages. */
export type RealtimeProps = {
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
};

/** Everything the project workspace shell and its regions need from the route: the realtime connection plus the current viewport mode and the router's navigate function. */
export type ProjectWorkspaceShellProps = RealtimeProps & {
  isMobile: boolean;
  navigate: NavigateFunction;
};

// ---------------------------

//----------------- PROVIDER AUTHENTICATION ------------

/** Sign-in state of one LLM provider CLI - whether it is authenticated, the account email and method, plus in-flight loading and error state - polled by the provider-auth module and rendered by the settings and onboarding account views. */
export type ProviderAuthStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error: string | null;
  loading: boolean;
};

/** The authentication state of every CLI provider at once, keyed by LLMProvider, so onboarding and settings can render each provider's connected, loading and error state from one object returned by useProviderAuthStatus. */
export type ProviderAuthStatusMap = Record<LLMProvider, ProviderAuthStatus>;

// ---------------------------

//----------------- SETTINGS ------------

/** The per-provider agent context the agents settings tab builds once and hands to each of its sections. */
export type AgentContextByProvider = Record<AgentProvider, AgentContext>;

/** The per-provider data the agents settings tab hands to its sections: that provider's auth status and the callback that starts its login flow. */
export type AgentContext = {
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
  /** Claude only: authorizes Claude Design — a second, separate claude.ai grant that changes no account credential — in the same embedded terminal. Absent for every other provider, and its absence is what keeps the row off their account pane. */
  onDesignLogin?: () => void;
};

/** Identifier of a top-level section in the settings dialog; use it whenever a tab is stored, compared or requested so deep links, the sidebar and the command palette all agree on the same set of names. */
export type SettingsMainTab = 'agents' | 'appearance' | 'git' | 'api' | 'voice' | 'tasks' | 'browser' | 'notifications' | 'plugins' | 'about';

/** The coding-agent CLI a settings screen is configuring, aliasing LLMProvider so agent-scoped settings read as being about an agent rather than a chat model. */
export type AgentProvider = LLMProvider;

/** One category of per-agent configuration in the agents settings tab (account, permissions, MCP servers or skills); use it to key which panel the tab renders. */
export type AgentCategory = 'account' | 'permissions' | 'mcp' | 'skills';

/** How much Codex may do without asking, from prompting on every edit to bypassing permission checks entirely; persisted as the Codex agent's permission setting. */
export type CodexPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/** A project as the settings dialog needs it - a required identifier in `name` plus optional display name and paths - passed down to the MCP and skills panels so they can scope configuration to a project. */
export type AgentSettingsProject = {
  name: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** Claude's persisted permission settings: the allowed and disallowed tool patterns and whether permission prompts are skipped; read and written as one unit by the settings controller. */
export type ClaudePermissionsState = {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  /** How edits happen. The ONE store the composer chip and this tab both read and write. */
  permissionMode?: PermissionMode;
};

/** The user's notification settings, grouped into delivery channels (in-app, web push, desktop, sound) and the events that trigger them; mirrors the payload of the notification preferences API. */
export type NotificationPreferencesState = {
  channels: {
    inApp: boolean;
    webPush: boolean;
    desktop: boolean;
    sound: boolean;
  };
  events: {
    actionRequired: boolean;
    stop: boolean;
    error: boolean;
    /** The usage-limit family: limit reached, reset, warning, overage, out of credits. */
    limits: boolean;
    /** Background work that finished after its turn ended: a wait or a subagent returning. Off by default. */
    background: boolean;
  };
};

/** The ntfy phone-push settings as a client is allowed to see them: the topic masked to its first and last two characters and the access token reduced to whether one is stored, never the credentials themselves; rendered by the notifications settings card. */
export type NtfySettingsView = {
  configured: boolean;
  enabled: boolean;
  serverUrl: string;
  topicMasked: string | null;
  hasToken: boolean;
  longRunMinutes: number;
  appUrl: string | null;
};

/** One ntfy settings save. Every field is optional and an absent one keeps what is stored — which is how a form that never shows the access token cannot erase it; `''` or `null` clears it deliberately. Sent by the notifications settings card. */
export type NtfySettingsInput = {
  serverUrl?: string;
  topic?: string;
  token?: string | null;
  longRunMinutes?: number;
  enabled?: boolean;
  appUrl?: string | null;
};

/** Cursor's persisted permission settings: the allowed and disallowed command patterns and whether permission prompts are skipped; read and written as one unit by the settings controller. */
export type CursorPermissionsState = {
  allowedCommands: string[];
  disallowedCommands: string[];
  skipPermissions: boolean;
  /** How edits happen. The ONE store the composer chip and this tab both read and write. */
  permissionMode?: PermissionMode;
};

// ---------------------------

//----------------- SETTINGS CREDENTIALS ------------

/** One stored CloudCLI API key as the server returns it, in snake_case, including its masked key, creation and last-used timestamps and active flag; render it, do not rebuild it. */
export type ApiKeyItem = {
  id: string;
  key_name: string;
  api_key: string;
  created_at: string;
  last_used?: string | null;
  is_active: boolean;
};

/** A freshly issued API key in camelCase, the only time the full secret is available; show it once and then fall back to the stored ApiKeyItem. */
export type CreatedApiKey = {
  id: string;
  keyName: string;
  apiKey: string;
  createdAt?: string;
};

/** One stored GitHub credential as the server returns it, in snake_case, carrying its name, optional description, creation timestamp and active flag - never the token itself. */
export type GithubCredentialItem = {
  id: string;
  credential_name: string;
  description?: string | null;
  created_at: string;
  is_active: boolean;
};

// ---------------------------

//----------------- SHELL ------------

/** Handle returned when touch text-selection is installed on an xterm terminal; call updateHandles after the terminal reflows and dispose when tearing the terminal down. */
export type MobileTerminalSelectionManager = {
  dispose: () => void;
  updateHandles: () => void;
};

// ---------------------------

//----------------- SIDEBAR ------------

/** The complete project-list state and callback bundle the sidebar assembles once and threads down through its project list, project rows and session rows. */
export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  activeRename: ActiveSidebarRename | null;
  initialSessionsLoaded: Set<string>;
  currentTime: Date;
  deletingProjects: Set<string>;
  tasksEnabled: boolean;
  mcpServerStatus: MCPServerStatus;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  onLoadMoreSessions: (projectId: string) => void;
  loadingMoreProjects: Set<string>;
  activeSessions: ReadonlySet<string>;
  attentionSessionIds: ReadonlySet<string>;
  forceExpanded?: boolean;
  isProjectStarred: (projectName: string) => boolean;
  onRenameDraftChange: (draft: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectId: string, nextName: string) => void;
  onDeleteProject: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (sessionId: string, sessionTitle: string) => void;
  /** Branches a session into an independent one. Rows hide it for providers that cannot. */
  onForkSession?: (session: SessionWithProvider) => void;
  onNewSession: (project: Project) => void;
  onStartEditingSession: (projectId: string, sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  t: TFunction;
};

/** The ordering applied to the project list, either alphabetically by name or by most recent activity, persisted alongside the user's appearance settings. */
export type ProjectSortOrder = 'name' | 'date';

/** Which list the sidebar is currently showing: projects, conversation search results, running sessions or archived items. */
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'archived';

/** A Project narrowed to the archived state so archived entries can be listed and restored without being mistaken for active projects. */
export type ArchivedProjectListItem = Project & { isArchived: true };

/** A ProjectSession whose LLM provider has been resolved into the required __provider field, so list rendering never has to re-derive it. */
export type SessionWithProvider = ProjectSession & {
  __provider: LLMProvider;
};

/** One archived session as returned by the archive API, carrying its own project identity because the owning project may itself be archived. */
export type ArchivedSessionListItem = {
  sessionId: string;
  provider: LLMProvider;
  projectId: string | null;
  projectPath: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivity: string | null;
  isProjectArchived: boolean;
};

/**
 * The subset of archived-session fields needed to render a recent-conversations row and reopen the session it points at.
 * `icon` is the chat's chosen icon name, or null for the default; `unread` means its last run finished while it was not on screen and it has not been on screen since.
 */
export type RecentConversationListItem = Pick<
  ArchivedSessionListItem,
  'sessionId' | 'provider' | 'projectId' | 'projectDisplayName' | 'sessionTitle' | 'lastActivity'
> & { icon: string | null; unread: boolean };

/**
 * The rename the sidebar currently has open, if any.
 *
 * One value rather than two id/draft pairs, so a project and a session cannot
 * both be mid-rename, and rows can be handed a resolved `isEditing` instead of
 * the raw id — a keystroke then only invalidates the row being renamed.
 *
 * A session rename carries the project that owns it so SidebarProjectList can
 * decide in O(1) which project row the draft belongs to. Without it every row
 * has to be handed the whole value and a keystroke invalidates all of them.
 */
export type ActiveSidebarRename =
  | { target: 'project'; id: string; draft: string }
  | { target: 'session'; id: string; projectId: string; draft: string };

/**
 * The sidebar's pending delete confirmation. One value rather than a pair of
 * nullable states, so a project dialog and a session dialog cannot both be
 * open — they are portalled at the same z-index and would stack. The project
 * variant carries the session count the dialog warns with.
 */
export type PendingSidebarDeletion =
  | { kind: 'project'; project: Project; sessionCount: number }
  | { kind: 'session'; sessionId: string; sessionTitle: string; isArchived: boolean };

/** Whether a TaskMaster MCP server is present and configured for a project, or null while that status is still unknown. */
export type MCPServerStatus = {
  hasMCPServer?: boolean;
  isConfigured?: boolean;
} | null;

// Retained as `name` for backwards compatibility with existing settings
// consumers; the value is populated from `projectId` by normalizeProjectForSettings.
export type SettingsProject = {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
};

// ---------------------------

//----------------- SIDEBAR SEARCH ------------

/** Full result set of a conversation search, combining per-project message matches, session-title matches, the total match count and the query that produced them. */
export type ConversationSearchResults = {
  results: ConversationProjectResult[];
  titleResults: SessionTitleSearchResult[];
  totalMatches: number;
  query: string;
};

/** Progress of an in-flight conversation search, reported as the number of projects scanned out of the total so the UI can show how far the scan has got. */
export type SearchProgress = {
  scannedProjects: number;
  totalProjects: number;
};

/** One session whose title matched a conversation search, carrying enough project and session identity to open that session directly. */
export type SessionTitleSearchResult = {
  sessionId: string;
  provider: string;
  projectId: string | null;
  projectDisplayName: string;
  sessionTitle: string;
  lastActivity: string | null;
};

/** All conversation matches found inside a single project during a search, grouped so the results can be rendered under one project heading. */
export type ConversationProjectResult = {
  // Emitted by the provider search service so the sidebar can map a
  // match back to the Project in its current state by projectId.
  projectId: string | null;
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

/** One session within a ConversationProjectResult, pairing the session's summary with the individual message matches found in it. */
type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  provider?: string;
  matches: ConversationMatch[];
};

/** A single matching message from a conversation search, holding the author role, the surrounding snippet and the ranges to highlight inside that snippet. */
type ConversationMatch = {
  role: string;
  snippet: string;
  highlights: SnippetHighlight[];
  timestamp: string | null;
  provider?: string;
  messageUuid?: string | null;
};

/** A start/end character range within a search-result snippet that should be visually marked as the matched text. */
type SnippetHighlight = {
  start: number;
  end: number;
};

// ---------------------------

//----------------- PROVIDER SKILLS ------------

/** The LLM provider whose skills are being listed, uploaded or deleted; use it to target the provider-specific skills endpoints. */
export type SkillsProvider = LLMProvider;

/** Where a skill was discovered - the user's home directory, a project, a plugin, the repository, an admin location, or the built-in system set - used to group, order and label skills and to decide whether one can be deleted. */
export type SkillsScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/** A project workspace whose skills can be listed or added to, identified by `projectId` with optional display name and path; passed into the skills settings UI as the list of selectable project scopes. */
export type SkillsProject = {
  projectId: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

/** One skill available to a provider, carrying its slash command, description, originating scope and source path plus the owning plugin or project when it came from one. */
export type ProviderSkill = {
  provider: SkillsProvider;
  name: string;
  description: string;
  command: string;
  scope: SkillsScope;
  sourcePath: string;
  pluginName?: string;
  pluginId?: string;
  projectDisplayName?: string;
  projectPath?: string;
};

/** One skill to upload, holding its SKILL.md content, the directory and file names to write it under, and any accompanying base64-encoded support files. */
export type ProviderSkillCreateEntryPayload = {
  content: string;
  directoryName?: string;
  fileName?: string;
  files?: Array<{
    relativePath: string;
    content: string;
    encoding: 'base64';
  }>;
};

// ---------------------------

//----------------- TASK MASTER ------------

/** Identifier of a TaskMaster task or subtask, which TaskMaster may emit as either a number or a string. */
export type TaskId = string | number;

/** One task as returned by TaskMaster, including its status, priority, dependencies, implementation details and nested subtasks. */
export type TaskMasterTask = {
  id: TaskId;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  details?: string;
  testStrategy?: string;
  parentId?: TaskId;
  dependencies?: TaskId[];
  subtasks?: TaskMasterTask[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

/** A minimal pointer to a task, used by callbacks that only need its id and title rather than the full task record. */
export type TaskReference = {
  id: TaskId;
  title?: string;
  [key: string]: unknown;
};

/** A task handed to a click handler, which may be either a complete TaskMasterTask or a lightweight TaskReference. */
export type TaskSelection = TaskMasterTask | TaskReference;

/** A product-requirements document in a project's TaskMaster directory, used both for listing PRDs and for editing their content. */
export type PrdFile = {
  name: string;
  content?: string;
  isExisting?: boolean;
  modified?: string;
  created?: string;
  path?: string;
  size?: number;
  [key: string]: unknown;
};

/** The TaskMaster section of a project record, describing whether the project has been initialised and the status metadata TaskMaster reports for it. */
export type TaskMasterProjectInfo = {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

/** A Project augmented with the flattened TaskMaster fields (configured flag, status and task counts) that the task board and its callers read directly. */
export type TaskMasterProject = Project & {
  taskMasterConfigured?: boolean;
  taskMasterStatus?: string;
  taskCount?: number;
  completedCount?: number;
  taskmaster?: TaskMasterProjectInfo;
};




/** The layout the task board is currently rendering: kanban columns, a flat list, or a grid. */
export type TaskBoardView = 'kanban' | 'list' | 'grid';

/** The task field the board is currently sorted by. */
export type TaskBoardSortField = 'id' | 'title' | 'status' | 'priority' | 'updated';

/** The direction of the task board's current sort, ascending or descending. */
export type TaskBoardSortOrder = 'asc' | 'desc';

/** One column of the kanban board, pairing its status and display colours with the tasks that belong to it. */
export type TaskKanbanColumn = {
  id: string;
  title: string;
  status: string;
  color: string;
  headerColor: string;
  tasks: TaskMasterTask[];
};

/** A TaskMaster task's lifecycle state; the known values are enumerated and the string fallback tolerates statuses added by newer TaskMaster releases. */
type TaskStatus =
  | 'pending'
  | 'in-progress'
  | 'done'
  | 'review'
  | 'blocked'
  | 'deferred'
  | 'cancelled'
  | string;

/** A TaskMaster task's priority; high, medium and low are the known values and the string fallback tolerates anything else TaskMaster emits. */
type TaskPriority = 'high' | 'medium' | 'low' | string;

// ---------------------------

//----------------- CLAUDE ACCOUNT CONTRACTS ------------
// The client mirror of the server's own contracts (`server/shared/types.ts` § CLAUDE ACCOUNT
// CONTRACTS), which is where each field is documented against the module's behaviour. The notes here
// are the half a SCREEN has to get right: which unit a number is in, and what "unknown" looks like.

/**
 * One Claude account slot the switcher holds.
 * `expiresAt` is epoch MILLISECONDS — compare it to `Date.now()` with no conversion; `null`
 * means the expiry was never read, which renders as an em-dash and never as a warning.
 */
export type ClaudeAccountSlot = { slug: string; label: string; expiresAt: number | null; isActive: boolean };

/**
 * The whole account picture, or the calm reason there is none.
 * `drift` (the live login differs from its saved copy) and `liveSessions` are facts a row
 * STATES; neither gates a switch. `unreadable: true` is reachable-with-no-slots — say that in
 * words, because an empty switcher otherwise reads as "you have no accounts".
 */
export type ClaudeAccounts =
  | { reachable: true; active: string | null; activeLabel: string | null; slots: ClaudeAccountSlot[]; liveLabel: string | null; liveExpiresAt: number | null; drift: boolean; liveSessions: number; unreadable: boolean }
  | { reachable: false; reason: string };

/**
 * One usage window as the meter measured it.
 * `percent: null` is "no reading" (em-dash, empty track); `0` is a REAL reading and says
 * "0% used". `rolled: true` keeps a real but HISTORICAL percent — show it dim and say "was",
 * never drain it to zero. `severity` is present only when the vendor flagged the window, and
 * may only ESCALATE a meter's tone: a flagged window can read a comfortable 12 % and still
 * mean an account lock.
 */
export type ClaudeUsageWindow = { key: string; label: string; percent: number | null; resetsAt: string | null; rolled?: boolean; severity?: string };

/**
 * Usage as the meter last measured it.
 * `checkedAt` and `staleSince` are epoch SECONDS — multiply by 1000 before `new Date`, unlike
 * `ClaudeAccountSlot.expiresAt`, which is already milliseconds. With `reachable: false` the `reason`
 * is the route's own word (`unreachable`); with `reachable: true`
 * it is the meter's — `''` healthy, `pending` a poll in flight (reading, not broken), otherwise
 * the cause of a degraded reading.
 */
export type ClaudeUsage =
  | { reachable: true; windows: ClaudeUsageWindow[]; degraded: boolean; reason: string; staleSince: number | null; checkedAt: number }
  | { reachable: false; reason: string };

// ---------------------------

//----------------- MEMORY INTAKE CONTRACTS ------------
// The client mirror of `server/shared/types.ts` § MEMORY INTAKE CONTRACTS, where every field is
// documented against the memory lane's behaviour; a change to either shape belongs in both files at once.

/**
 * One row of a memory-intake list: enough to decide on, never enough to read. One lean shape serves
 * BOTH lists, so `status` says which one the row came back under — `pending` in the review queue,
 * `approved` on the filed list — and `assertedPath` is set only on an approved row.
 * `refusal` is the cap guard's own words about the last refused approve — the card is STILL
 * pending, so the row renders that text, and because the row records it the text survives a
 * refresh and reaches every other tab too.
 * `sessionId` is the APP session id of the chat that proposed the memory — the staging's unverified
 * provenance column, resolved on the server, display only: a list may mark a row as this chat's,
 * and nothing gates on it. `null` when the staging supplied none.
 */
export type MemoryCandidateLean = { id: string; name: string; target: string; project: string | null; status: string; source: string | null; assertedPath: string | null; refusal: string | null; createdAt: string | null; reviewedAt: string | null; sessionId: string | null };

/**
 * One candidate read whole — fetched only for the row a person actually expanded.
 * `body`, `rationale` and `indexLine` are operator-authored free text: each reaches the DOM as
 * a text node, never as markdown and never as markup, however much like markdown it looks.
 * `sessionId` is inherited from the lean row rather than declared here, so a card read whole and
 * the same card in a list can never disagree about which chat proposed it.
 */
export type MemoryCandidateFull = MemoryCandidateLean & { body: string; indexLine: string | null; rationale: string | null };

/**
 * One memory list — the review queue, or the filed memories when the read asked for them — or the
 * calm reason there is none; a read never fails.
 * `reachable: false` is NOT "nothing left": the list is empty and the panel
 * says the queue could not be read in words. It must never render as "All filed".
 */
export type MemoryPending =
  | { reachable: true; candidates: MemoryCandidateLean[] }
  | { reachable: false; reason: string };

/**
 * One candidate read by id, or the calm reason there is none.
 * `candidate: null` means ONE thing: no row carries that
 * id. A card reviewed elsewhere is NOT null — the by-id read has no status filter
 * — it reads WHOLE, with `status` saying `approved` or `rejected`.
 * Both cases render `memory.gone`: the screen's words for "no longer waiting", never an error.
 */
export type MemoryCandidateRead =
  | { reachable: true; candidate: MemoryCandidateFull | null }
  | { reachable: false; reason: string };

/**
 * What one review answered, in the terms the screen has to say back.
 * `refused` is a 422 carrying the service's OWN text verbatim, so the row can show what to trim and
 * the card stays pending; `gone` is a 404 (reviewed elsewhere); `unreachable` is a 5xx or a
 * thrown fetch, and it alone is a fault.
 */
export type MemoryReviewOutcome =
  | { kind: 'filed' }
  | { kind: 'discarded' }
  | { kind: 'refused'; reason: string }
  | { kind: 'gone' }
  | { kind: 'unreachable'; reason: string };

// ---------------------------

//----------------- CLI VERSION ------------
// The client mirror of `GET /api/cli-version` (`server/shared/types.ts` § CLI VERSION CONTRACTS,
// where every field is documented against the server's behaviour). Kept here rather than in the
// hook because three screens and one composer read it. `docs/MANUAL.md (cli-version)` is the prose.

/**
 * One live run and the CLI version its own process announced at init.
 * `startedAt` is epoch MILLISECONDS. `cliVersion` is `null` while that init message has not
 * arrived yet — "not heard yet", which is never stale and never stood in for by `installed`.
 */
export type CliVersionRun = { sessionId: string; startedAt: number; cliVersion: string | null };

/**
 * What the route answers, and the ONLY input to the stale comparison (`useCliVersion`).
 * `installed` is `null` when no version could be read — with `reason` saying so in plain words
 * — and then NOTHING is stale: an invented `0.0.0` would compare stale to every run alive.
 */
export type CliVersionReport = { installed: string | null; reason: string | null; binaryPath: string | null; running: CliVersionRun[] };

// ---------------------------

//----------------- DEEPSEEK BALANCE ------------
// The client mirror of `GET /api/deepseek/balance` (`server/shared/types.ts` § DEEPSEEK
// CONTRACTS, where every field is documented against the vendor's own body). One reading, drawn
// in two registers by the accounts module: the row under the account name, and the panel.

/**
 * The money left on this host's DeepSeek account, or the calm reason there is none.
 * `total` is the vendor's own decimal STRING — never parsed to a number here, because a balance
 * put through a float is a balance that can come back a cent short. `currency` is the vendor's
 * code (`USD`, `CNY`), and the two together are what the row draws as money.
 *
 * `available: false` is a REAL reading — the vendor answered and said the account can no longer
 * serve requests — so it is never folded into the unknown: the figure still shows, and the words
 * under it say what the vendor said.
 *
 * With `reachable: false` the `reason` is the server's own word — `unconfigured` (no key on this
 * host), `auth` (the vendor refused the key), `timeout`, `unreachable`, or `bad-response`. Every
 * one of them draws the same calm em-dash; the word only decides the sentence under it.
 */
export type DeepseekBalance =
  | { reachable: true; available: boolean; currency: string; total: string; checkedAt: number }
  | { reachable: false; reason: string };

export type DeepseekRange = 'today' | '7d' | '30d' | 'all';
export type DeepseekKind = 'chain' | 'heal' | 'run' | 'wave' | 'soul' | 'session';
export type DeepseekColumns = { input: number; output: number; cache_read: number; cache_write: number };
export type DeepseekDay = { day: string; outings: number; tokens: number; usd: number; usd_list: number };
export type DeepseekShareRow = { key: string; outings: number; usd: number; share: number };
export type DeepseekConsumer = DeepseekColumns & {
  kind: DeepseekKind; name: string; outings: number; tokens: number; usd: number; usd_list: number; share: number; last_ts: number;
};
export type DeepseekOuting = DeepseekColumns & {
  outing: string; session_id: string; segment: number; started_at: number; last_at: number;
  parent_session: string | null; soul: string | null; role: string; model: string; kind: DeepseekKind; name: string; run_id: string | null;
  tokens: number; usd: number; usd_list: number;
};
export type DeepseekReconHour = { hour_start: number; ledger_usd: number; balance_usd: number | null; topup_usd: number; readings: number };
export type DeepseekUsageSummary = {
  generated_at: number;
  ledger: { path: string; present: boolean; messages: number; outings: number; first_ts: number | null; last_ts: number | null; synced_at: number | null; sync_s: number | null; unpriced_models: string[] };
  pricing: { mode: 'per-row'; off_peak_factor: number; peak_utc: [number, number][]; weekdays_only: boolean; holidays_modelled: boolean; rates: Record<string, number[]> };
  endpoint: string;
  balance: { total: number; currency: string; available: boolean; checked_at: number } | null;
  spend: {
    today_usd: number; week_usd: number; all_usd: number; today_list_usd: number; week_list_usd: number; all_list_usd: number;
    today_outings: number; week_outings: number; all_outings: number; today_balance_usd: number | null; week_balance_usd: number | null;
  };
  days: DeepseekDay[];
  range: DeepseekRange;
  range_since: number | null;
  totals: DeepseekColumns & { outings: number; messages: number; tokens: number; usd: number; usd_list: number };
  columns: Record<keyof DeepseekColumns, { tokens: number; usd: number }>;
  kinds: DeepseekShareRow[];
  roles: DeepseekShareRow[];
  models: DeepseekShareRow[];
  souls: DeepseekShareRow[];
  consumers: DeepseekConsumer[];
  top: { kind: DeepseekKind; name: string; usd: number; share: number } | null;
  outings: DeepseekOuting[];
  feed: DeepseekOuting[];
  recon: {
    currency: string | null; readings: number; covered_hours: number; ledger_usd: number; balance_usd: number | null;
    gap_usd: number | null; topups_usd: number; unassigned_usd: number; hours: DeepseekReconHour[];
  };
};

// ---------------------------

//----------------- LIVE WIDGETS ------------

/** Frame → host: what a sandboxed widget's bridge script posts up to the page embedding it. */
export type WidgetFrameMessage =
  | { type: 'ready' }
  | { type: 'subscribe'; topic: string }
  | { type: 'unsubscribe'; topic: string }
  | { type: 'resize'; height: number };

/** Host → frame: what the page posts down into one widget's `contentWindow`. */
export type WidgetHostMessage =
  | { type: 'data'; topic: string; payload: unknown; at: number }
  | { type: 'error'; topic: string; reason: 'topic not allowed' | 'too many subscriptions' }
  | { type: 'theme'; dark: boolean; tokens: Record<string, string> };

/** Host-side only, never on the wire: what the embedder plugs in to answer a frame's topic requests. */
export type WidgetHostHandlers = {
  onSubscribe?: (topic: string, send: (message: WidgetHostMessage) => void) => void;
  onUnsubscribe?: (topic: string) => void;
  /** Called once per `ready` the host ACCEPTS — after its identity check, so a stray post never fires it. */
  onReady?: () => void;
};

/** A widget fence whose body is JSON naming one DocSpace block — the chat embeds it from ArchPulse instead of rendering HTML. */
export type DocSpaceBlockRef = { pageId: string; blockId: string };

/**
 * A widget fence whose body is JSON naming one ADDRESS — the chat draws that page in a frame and
 * knows nothing else about it.
 *
 * `title` is the card's heading when the model gave one, because "Embed" tells a reader nothing and
 * only the writer knows the page is a Grafana panel or a run's log tail. `height` is the drawn
 * height in CSS pixels, clamped where it is used (`EmbedUrlFrame`): a foreign page speaks none of
 * the widget protocol, so it can never report its own height and something has to say how tall it
 * is. Both are optional and both have a default; the address is the only required field.
 */
export type EmbedUrlRef = { url: string; title?: string; height?: number };

/** What a widget fence body turned out to be: raw HTML (the default), a DocSpace reference, an arbitrary address to embed, or a reference that does not parse. */
export type WidgetBodyShape =
  | { kind: 'html' }
  | { kind: 'docspace'; ref: DocSpaceBlockRef }
  | { kind: 'embed'; ref: EmbedUrlRef }
  | { kind: 'invalid'; reason: string };

/**
 * A live embed's identity, handed to a caller's framer: which kind it is, where a reader can open
 * it OUTSIDE this app, what to call it, and the fullscreen switch it wears.
 *
 * `openUrl` is null exactly for the HTML widget, which is model output this app composed inline and
 * so has nowhere else to be; it is ArchPulse's studio deep link for a DocSpace block and the address
 * itself for an embed. `title` is the model's own words for an embed and null for the other two,
 * whose names are fixed. `fullscreen`/`onToggleFullscreen` are owned by WidgetFrame — the component
 * that owns the live element — because a framer that held the state would have to move the frame in
 * the tree to draw it, and a moved iframe is a reloaded iframe.
 *
 * Built by WidgetFrame; read by the chat transcript's EmbedFrame.
 */
export type WidgetEmbed = {
  kind: 'html' | 'docspace' | 'embed';
  openUrl: string | null;
  title: string | null;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
};

/**
 * Wraps a LIVE embed. WidgetFrame calls it on its three live branches only, behind its mount and
 * streaming gates, never for the source `<pre>` or the error card. Passed by the chat transcript's
 * CodeBlock.
 */
export type WidgetEmbedFramer = (embed: WidgetEmbed, live: ReactNode) => ReactNode;

/**
 * A topic is a NAME, never an address. The host owns the vocabulary and `isAllowedTopic`
 * (`src/modules/live-bus/topics.ts`) owns the shapes; this alias exists so a signature reads
 * `topic` rather than `string` and cannot be confused with a URL by whoever writes the next one.
 */
export type LiveTopic = string;

/** One retained reading: the value and the instant it was published, epoch MILLISECONDS (`Date.now()`). */
export type LiveValue<T = unknown> = { payload: T; at: number };

/**
 * The client-side bus: a retained value per topic, dispatched synchronously to whoever subscribed.
 *
 * `subscribe` on an allowed topic replays the retained value SYNCHRONOUSLY when one is held, so a
 * subscriber that arrives after the producer still starts with a picture rather than with nothing;
 * on a disallowed topic it replays nothing and returns a no-op unsubscribe. `publish` on a
 * disallowed topic is a no-op. The bus knows no producer — it retains, dispatches and admits
 * topics, and a feed (the first is `RunnerFeed`, in `src/modules/plan-runner/`) publishes into it.
 */
export type LiveBus = {
  subscribe<T = unknown>(topic: LiveTopic, listener: (value: LiveValue<T>) => void): () => void;
  get<T = unknown>(topic: LiveTopic): LiveValue<T> | undefined;
  publish<T = unknown>(topic: LiveTopic, payload: T, at?: number): void;
  isAllowedTopic(topic: unknown): topic is string;
};

// The client mirror of `server/shared/types.ts` § PLAN RUNNER CONTRACTS, where every field is
// documented against what the runner writes on disk; a change to either shape belongs in both at once.

/** How the lane reads one run's liveness. `queued` is a run the runner CREATED parked — `start --queue`, or DeepSeek's peak hours with the switch on — so nothing has ever walked it: `stopped_at` like a paused run, plus `queued_until`. `paused` is carried rather than omitted, so the tab can list it and offer Resume. `ended` is a run whose receipt has landed and is still within the keep window — carried so the operator sees the ending and dismisses it themselves; after the window it is omitted. */
export type RunnerRunState = 'live' | 'paused' | 'queued' | 'stale' | 'ended';
/** One phase's outcome as the runner spells it, from `progress.json.phases[].state`. */
export type RunnerPhaseState = 'shipped' | 'running' | 'blocked' | 'deferred' | 'pending';
/** One row of `progress.json.phases[]`. `note` is the runner's own short word and is free text — it reaches the DOM as a text node, never as markup. `wave` is the phase's 1-based wave in the plan's whole map (what `plan-runner swarm <plan>` prints), `null` when no wave can place it; absent on a frame from a server older than the field. */
export type RunnerPhaseRow = { rank: number; id: string; title: string; state: RunnerPhaseState; note: string; wave?: number | null };
/** One `runner.log` stage change. `at` is the runner's LOCAL ISO timestamp to the second, kept as the string it wrote. `detail` is `''` when the stage word stood alone. */
export type RunnerTimelineEntry = { at: string; phase_id: string; stage: string; detail: string };
/** Where the run stands, from `progress.json.position`. `stage_since` is epoch SECONDS, like every timestamp inside a snapshot. */
export type RunnerPosition = { rank: number; total: number; phase_id: string; title: string; remain: number; pipeline: string; stage: string; stage_detail: string; stage_since: number };
/** One run as the lane reads it off disk. `position` is `null` while the runner has not composed one yet, which a live run does show in its first seconds. `blocked_causes` is the receipt's phase id → cause map, `{}` until the run ends — the only record of a phase the walk left standing on a crash or on the run's budget, whose row never turns `blocked`. `launched_by_session` is the APP session id of the chat whose turn launched the run — the server resolves it before the snapshot is sent, so it is safe to compare against the open chat; `null` when the run names none. */
/** The fix-it session on a blocked phase, from `progress.json.repair`: the one IN FLIGHT (`repairing`, `step` the sub-stage it is on; `paused` while the run waits out a rate limit), else the last one finished (`fixed` — the phase walks again — or `failed`). `by` says whose session it is: `unblock` is the run's own outing, walked by the run's process; `heal` is the heal drain's, a process of its own that the walk's ending launches beside the walk. `live` is whether the process doing a `heal` repair is alive right now (always `false` for an `unblock`, whose liveness is the run's). `resumed` is whether a finished repair put the phase back on the walk: a cleared unblock always did, a heal only when it re-armed the phase's spec — a heal can cure the cause and leave the phase standing; `null` when the heal never measured it. `since` and `ended_at` are epoch SECONDS; `k` is the number of the outing this repair belongs to, and `limit` its per-phase ceiling (0 = none carried, as for a heal). */
export type RunnerRepair = { phase_id: string; state: 'repairing' | 'paused' | 'fixed' | 'failed'; by: 'replan' | 'unblock' | 'heal'; live: boolean; resumed: boolean | null; step: string; k: number; limit: number; since: number | null; ended_at: number | null; reason: string };
export type RunnerRunSnapshot = { run_id: string; plan_path: string; plan_title: string; /** A test's run, never the operator's: its plan sits in a scratch root (the runner's own fixtures under the temp dir) or its id is a probe's `fixture-` run. Hidden from every runs list unless a probe opts in, and never pushed as a notification. */ test_run: boolean; state: RunnerRunState; status: string; started_at: number; heartbeat_at: number; stopped_at: number | null; /** `run.json`'s `queued_until`, `null` on every run that was not created parked and on a queued one given no window to wait for (a bare `--queue` outside DeepSeek's peak hours). Epoch SECONDS, like every timestamp here. */ queued_until: number | null; /** `run.json`'s `start_at`: the operator's SCHEDULED Start on a queued run (`plan-runner schedule`), pressed by the watchdog's tick when it comes; `null` when none was asked for (the key absent too). Epoch SECONDS. */ start_at: number | null; /** The run's own model word off `run.json:model`; `null` only on a record born before the runner wrote its default, which reads `deepseek` (`effectiveModelWord`). */ model: RunnerModelChoice | null; launched_by_session: string | null; outcome: string | null; ended_at: number | null; blocked_causes: Record<string, string>; /** The receipt's own sentence over a phase the run walked out on (`hooks/plan_runner/closing.py:doors_spent`): the phase, its cause, and the doors the run spent on that block -- a replan, its unblocks -- or `''` when the receipt carries none. It is what lets the ending's push say what the walk already tried. */ doors_spent: string; pid: number | null; position: RunnerPosition | null; repair: RunnerRepair | null; phases: RunnerPhaseRow[]; spawns: number; max_spawns: number; cost_usd: number; plan_runs: number; plan_spawns: number; plan_cost_usd: number; plan_planning_usd: number; plan_review_usd: number; plan_scouts_usd: number; plan_total_usd: number; tokens: number; /** The same tally SPLIT — what the run's children READ (input + cache read + cache write) and what they wrote — so a card can draw `1.2M in · 48k out`. Both `0` against a real `tokens` on a run older than the split: the card then says the total alone (`usageText`, `src/modules/plan-runner/spend.ts`). */ tokens_in: number; tokens_out: number; plan_tokens: number; plan_tokens_in: number; plan_tokens_out: number; line: string; timeline: RunnerTimelineEntry[] };
/** The whole picture, pushed on change over `/ws`. `runs` is ordered by `started_at` ascending. `at` is epoch MILLISECONDS, unlike every field inside a snapshot. */
export type RunnerStateEvent = { kind: 'runner_state'; runs: RunnerRunSnapshot[]; at: number };

//----------------- DISPATCHER v3: the store's one status document, mirrored key for key ------------
// The dispatcher keeps its plans in a SQLite store rather than in files, so the ONE picture of them
// is a document: `hooks/dispatcher/report.py::snapshot`, what `dispatcher status --json` prints. The
// types below mirror it key for key and name for name. The server converts NOTHING — every key, word
// and string below is the document's own — and the client's `epochOf` is the single ISO-to-epoch
// edge, because every time below is the store's own `YYYY-MM-DDTHH:MM:SSZ` UTC string, never a
// number. ONE TEXT IN TWO FILES (`src/shared/types.ts` and `server/shared/types.ts`, as the runner
// contracts are): a change to either shape belongs in both at once.

/** One stage of a phase's chain: a row of the store's `stages` table, `phase_chain`'s projection of the chain record (`chain.json`). `settle` REPLACES a phase's rows rather than appending, so a stage a walk re-enters is one row again (INV-181). `soul` is the soul the stage launched and `launch_id` that launch's own id; `resumed_sid` is the session a resume ran it under. `verdict` is the soul's own outcome word and is free text, reaching the DOM as a text node. `cost_usd` is PAID dollars — `0` on a stage on the operator's Claude subscription, whose `tokens`/`tokens_in`/`tokens_out` are then the whole of what it spent; all three come off the launch's own `result.json` at the dispatcher's report time, never from a store column (INV-172). */
export type DispatcherStage = { name: string; soul: string | null; launch_id: string | null; session_id: string | null; resumed_sid: string | null; launched_at: string | null; returned_at: string | null; output_path: string | null; verdict: string | null; cost_usd: number; tokens: number; tokens_in: number; tokens_out: number };
/** One phase of a plan, addressed by its stable `key` (INV-183 — never by position, which `put_phases` renumbers on every reload). `busy` is `phase_chain.busy`: the walker alive OR the soul it has in flight still out, which is the question the rule and the daemon ask — a phase whose walker was killed while its soul still bills reads busy, so the status column alone is never the liveness answer (INV-186). `waits_on` carries the waited phases' KEYS in position order, `start_here` the phase row's own JSON list of entry points. `rounds` is `store.rounds` — the DISTINCT `athena-*` stage names, never the launch count — and `cost_usd` sums this phase's stage rows; both are derived at read time, never stored (INV-172). `tokens*` are the same sum over the stages' own records, PAID dollars' token counterpart. */
export type DispatcherPhase = { key: string; position: number; title: string; assignee: string; status: 'not started' | 'running' | 'done'; chain_id: string | null; done_at: string | null; waits_on: string[]; busy: boolean; rounds: number; cost_usd: number; tokens: number; tokens_in: number; tokens_out: number; start_here: string[]; stages: DispatcherStage[] };
/** One line of a plan's log, oldest first in `DispatcherPlan.events`. `phase` is the phase's KEY or null — the table stores a phase id, and an id is not an address (INV-183). `detail` is free text and reaches the DOM as a text node. */
export type DispatcherEvent = { id: number; at: string; phase: string | null; kind: string; detail: string | null };
/** The plan's word, in ONE precedence: `complete`, `scheduled`, `paused`, `queued`, `live`, `parked`, else `idle`. `scheduled` outranks the pause flag on purpose — a paused plan with an hour set is going to start by itself, and calling it merely `paused` would hide the one fact the operator needs. `paused` and `queued` are told apart by whether a walk ever launched: a paused plan that has run is stopped mid-plan, one that never launched is still waiting at the gate. */
export type DispatcherPlanStatus = 'idle' | 'parked' | 'queued' | 'scheduled' | 'paused' | 'live' | 'complete';
/** One plan whole: its row, its waits, its armed hour, its books, its phases in position order and its log oldest first. `state` is the STORE's own state word — `designing`, `designed`, `questions`, `loaded`, `parked` — a string rather than a union, because the store's vocabulary belongs to the store. `goal` is null on a plan that has been opened and not yet designed. `session` is the session that opened it, `author` the soul that wrote its design. `schedule` is the armed hour read back out of systemd at this instant (`schedule.armed`), `{ start_at, unit }` with `start_at` the timer's own ISO stamp — so a timer stopped or fired by hand reads null here at once. `cost_usd`, `rounds` and `tokens*` sum this plan's phases — and `cost_usd` is PAID dollars, so a plan that rode the operator's Claude subscription reads `0` there while its tokens count everything it spent. */
export type DispatcherPlan = { name: string; v3: string; state: string; status: DispatcherPlanStatus; repo: string; goal: string | null; delivers: string | null; session: string | null; /** The ONE field the server ADDS, which is why this type is not a pure mirror: the plan's `session` resolved through `sessionsDb.resolveAppSessionId` (the rule the run lane's `resolveLaunchingSessions` follows), `null` when the plan names no session or the id resolves to none. The document's own `session` travels untouched beside it. */ session_app_id: string | null; author: string | null; created_at: string; updated_at: string; completed_at: string | null; prompted_at: string | null; paused: boolean; approved: { at: string; by: string } | null; waits_on: string[]; schedule: { start_at: string; unit: string } | null; cost_usd: number; tokens: number; tokens_in: number; tokens_out: number; rounds: number; phases: DispatcherPhase[]; events: DispatcherEvent[] };
/** This box's posture, as `report.snapshot` reads it on every call: the provider the walks take (`width.route` — the DeepSeek switch, read live, never cached), the operator's swarm toggle (`swarm.read()`: `enabled`, and `lanes` — `null` for a bare `on`, a number for `on <N>`, both inert when the flag is off), and `ceiling`, the most phases that may walk at once (`1` on the Claude route, the swarm toggle's own number on the DeepSeek route, `null` for no ceiling). `word` is the whole posture in one phrase, for a `held` line and this frame alike. `park_at_peak` is the operator's third switch file; `peak_until` is when the CURRENT DeepSeek peak window ends, as an ISO stamp, or null outside one — on the Claude route the peak has no price, so it is null whatever the toggle says. */
export type DispatcherRoute = { provider: 'claude' | 'deepseek'; swarm: { enabled: boolean; lanes: number | null }; ceiling: number | null; word: string; park_at_peak: boolean; peak_until: string | null };
/** This home's daemon. `alive` is the LOCK, not the file: the daemon takes a blocking exclusive flock on `<home>/daemon.lock` before anything else, so an exclusive flock taken by a reader answers without blocking — refused means somebody holds it, and that somebody is the daemon. `pid` and `unit` are therefore only reported on the alive branch: a lock file nobody holds is a dead daemon's, whatever pid it still names, and the unit comes from `/proc/<pid>/cgroup` — the kernel's answer, the one thing the daemon's four-name environment cannot have been handed. */
export type DispatcherDaemon = { alive: boolean; pid: number | null; unit: string | null };
/** The whole picture, pushed on change over `/ws` by the dispatcher lane. It is the document's own keys — `plans`, `route`, `daemon`, `offpeak_at`, `home`, `generated_at` — with the frame's clock added as `at`, epoch MILLISECONDS (`Date.now()`) as `RunnerStateEvent.at`, unlike every time inside. `offpeak_at` is always a stamp — the next DeepSeek off-peak moment, and the literal `none` when the clock cannot answer — so it is a string and never null. */
export type DispatcherStateEvent = { kind: 'dispatcher_state'; plans: DispatcherPlan[]; route: DispatcherRoute; daemon: DispatcherDaemon; offpeak_at: string; home: string; generated_at: string; at: number };
/** What the dispatcher's feed retains on `dispatcher:all`, and what every plan card reads off it: the frame's whole picture MINUS the two keys that change without anything moving (`home`, `generated_at`, restamped on every poll of the watcher) and minus the frame's own clock, which the bus carries as the value's `at`. It is the document's own spelling throughout — `offpeak_at` keeps its underscore — so the one place that renames it is the reader's `epochOf`. */
export type DispatcherLanePicture = { plans: DispatcherPlan[]; route: DispatcherRoute; daemon: DispatcherDaemon; offpeak_at: string };
/** The verbs this server may relay: `stop`, `resume`, `schedule` (a queued plan's Start at a time — `offpeak`, an ISO timestamp, or `none` to clear), `park` (a designed plan set aside) and `unpark` (handed back to be cut). */
export type DispatcherVerb = 'stop' | 'resume' | 'schedule' | 'park' | 'unpark';
/** What one relayed verb did. A refusal is a RESULT, not an error: the dispatcher prints its refusals on STDOUT (`REFUSED <verb> <name>.v3: <reason>`, exit 2; `no plan <bare>`, exit 1), so `stdout` carries the dispatcher's own first line whole and the reader never gets our paraphrase. `reason` is present only when the dispatcher never got to answer: it timed out, or its binary could not be spawned. */
export type DispatcherVerbResult = { ok: boolean; verb: DispatcherVerb; plan: string; exit: number | null; stdout: string; stderr: string; reason?: 'timeout' | 'spawn-failed' };
/** A run's or an arc's OWN model word, as `run.json:model` and `arc.json:model` record it (`hooks/plan_runner/run_model.py`) and as the model control sends it through `POST /runs/:id/model` and `POST /arcs/:arc/model`: `deepseek` (the runner's default, written at birth), `claude`, or `auto` — follow the chat's DeepSeek switch. The server checks a request against exactly these three before anything is spawned, so the argv word is always ours. */
export type RunnerModelChoice = 'deepseek' | 'claude' | 'auto';
/** The verbs this server may relay: `stop`, `resume`, `model` (the run's own DeepSeek / Claude word; restarts nothing) and `schedule` (a QUEUED run's Start at a time — `offpeak`, an ISO timestamp, or `none` to clear). Starting a run from a plan is `/execute`'s act, never a button's; a queued run's Start, now or scheduled, is the operator's. */
export type RunnerVerb = 'stop' | 'resume' | 'model' | 'schedule';
/** `GET /runs/offpeak`: the runner's next DeepSeek off-peak moment in epoch SECONDS (`plan-runner offpeak`, derived from `deepseek.PEAK_UTC`), or `null` when the runner could not answer. The card's `Start at …` button shows it in the reader's clock and never computes it. */
export type RunnerOffpeak = { at: number | null };
/** What one relayed verb did. A refusal is a RESULT, not an error: `stderr` carries the runner's own line whole so the reader sees the verdict rather than our paraphrase. */
export type RunnerVerbResult = { ok: boolean; verb: RunnerVerb; run_id: string; exit: number | null; stdout: string; stderr: string; reason?: 'timeout' | 'spawn-failed' };

//----------------- ARC DECK: a stack of plans walked one card after another ------------
// An arc is a stack: one orchestrating plan listing ordered cards, each card a plan of its own, walked one
// after another. The runner keeps one record per arc under `~/.claude/state/arcs/<name>/` — `arc.json` (the
// whole picture, written whole through `os.replace`), `receipt.json` (present ⇒ the arc is over) and
// `resume_brief.md` — and this client only READS them; the one thing it can ask for, a reorder, is a verb the
// server relays, never a state file the app writes. The deck never computes the order: `current` and
// `last_started` are the runner's own decisions, copied out of `arc.json`. Every timestamp is epoch SECONDS,
// because that is what the runner's Python writes (`time.time()`). Mirrored field-for-field in
// `server/shared/types.ts`.
//
// TWO WORDS, DERIVED BY THE RUNNER AND NEVER HERE: a card's `state` and the arc's `status` come out of one
// function (`hooks/plan_runner/arcs.py:_derive`), so a card and the arc over it can never disagree — the arc
// reads `stuck` while ANY card of it wears `stuck`, which is what the deck's header draws.

/** One card's walk, as the runner spells it in `arc.json:cards[].state` (`hooks/plan_runner/arcs.py:CARD_STATES`). `unminted` is a card whose run the runner has not created yet — each card is created at its own turn — and `stalled` is one whose latest run did NOT land: a run never parks on a ⛔ (operator ruling 2026-09-11), so a receipt reading `complete` says only that the WALK ended, and a card whose receipt left a phase blocked or skipped is `stalled` (`arc_stalled.landed`), its `run_status` naming how much of it did not ship (`complete — 8 blocked`). The tick presses such a card again by itself the moment a cure lands — a phase it still owes has its spec or its ⚒ outcome word moved, a heal item of its plan closes `healed`, or a plan with no nameable phase changes — so `stalled` is a card waiting, never a resting one. `stuck` is the other way a card waits: a press was REFUSED (`arc_refused`) — the start ladder for a card with no run, the `resume` of one that was created PARKED — so nothing moves that card until its plan is cured — see `ArcCardRefusal` and `ArcSnapshot`'s `status`. */
export type ArcCardState = 'unminted' | 'queued' | 'walking' | 'paused' | 'complete' | 'stalled' | 'stuck';
/** The LAST start refusal standing on one card, as `arc.json:cards[].refusal` holds it (`hooks/plan_runner/arc_refused.py`). `reason` is the ladder's OWN sentence, captured off the refusing process's stderr — the lint's first finding, the switch, the intent lock, the order gate — never a reading of `exit` (an exit code names the door, never the reason), truncated by the runner at 400 characters. `firstSeen` and `lastSeen` (epoch SECONDS) bracket the EPISODE: a tick that is refused for the same reason keeps the first and moves the second, so one refusal however often it is retried is one episode — which is what the push's once-only promise is counted on. The runner CLEARS the stamp the moment the card starts or the plan's bytes move, and an absent stamp is therefore either the cure landing or an edit that cured nothing — which is why the episode that minted it (`arc.json:cards[].refusal_episode`, runner-side) rides on while a refusal could still stand there, and why the phone's memory is pruned on the card's STATE rather than on this field. */
export type ArcCardRefusal = { exit: number; reason: string; firstSeen: number; lastSeen: number };
/** One phase of an arc card's plan, as `arc.json:cards[].phases[]` writes it (`hooks/plan_runner/arc_phases.py`): the phase's `id` and heading `title` in plan order, and `shipped` — the runner's own census verdict, true only for a phase whose ship-log line has landed. `blocked` is a ⛔ standing over that phase in the plan's own ship log (`shiplog.blocked_entries`, the reader the runner's D12 skip door reads too) on a phase the census has NOT shipped, so the marks and the runner cannot disagree about which phases held a card. A plan not yet on disk has no phases, and its card carries `[]`. */
export type ArcCardPhase = { id: string; title: string; shipped: boolean; blocked: boolean };
/** One card of an arc, as `arc.json:cards[]` writes it. `plan_path` is the card's own `plan` field: an ABSOLUTE path, since the runner resolves the bare basename against the arc file's directory. `charter` is free text and reaches the DOM as a text node, never as markup. `spawns` is the card's run's books, `0` before it has any. `phases` is the card's plan's phase list, re-read by the runner on every sync (the watchdog's two-minute tick), so a plan that lands or a phase that ships reaches the deck within one tick. */
export type ArcCardSnapshot = { position: number; plan_path: string; title: string; charter: string; run_id: string | null; state: ArcCardState; run_status: string | null; ended_at: number | null; spawns: number; phases: ArcCardPhase[]; /** The refusal standing on this card, `null` when none does — the runner's own stamp, copied here unread. A card whose `state` is `stuck` always carries one; a card that was refused and since started carries `null`. */ refusal: ArcCardRefusal | null };
/** One arc, as `<arcs dir>/<name>/arc.json` records it. `current` is the position of the first non-complete card — the card the walk acts on next, `null` once every card is complete — and `last_started` is the highest position that has started; BOTH are the runner's own decisions, copied here and never recomputed, because they are what tells the deck which card is live and which may still be dragged. `test_arc` is whether the arc lives in a hidden root (`isHiddenProjectPath(arc_path)`), the same rule a run's `test_run` follows, so a `/tmp` fixture never reaches the operator's deck. `has_receipt` is the arc's own `receipt.json` on disk — the arc has finished. `now` is the runner's recorded word that this arc walks through DeepSeek's peak hours. */
export type ArcSnapshot = { arc: string; arc_path: string; title: string; test_arc: boolean; status: 'not-started' | 'walking' | 'stalled' | 'stuck' | 'complete'; started_at: number | null; ended_at: number | null; synced_at: number; has_receipt: boolean; now: boolean; /** `arc.json`'s `start_at`: the operator's SCHEDULED `arc start` (`plan-runner arc schedule`), pressed by the watchdog's tick; `null` when none was asked for, and always once the arc has started. Epoch SECONDS. */ start_at: number | null; /** The arc's ONE model word off `arc.json:model`, handed to every card it mints; `null` only on a record synced before the runner wrote its default, which reads `deepseek` (`effectiveModelWord`). */ model: RunnerModelChoice | null; current: number | null; last_started: number; cards: ArcCardSnapshot[] };
/** Where a card sits in its deck's walk — CLIENT-ONLY, derived by `deckLayers` off the snapshot's own `current`: `done` is complete and behind the walk, `top` is the live card, `beneath` is a card still to come. It is each card's `data-arc-layer` value, which the browser harness reads. */
export type ArcCardLayer = 'top' | 'beneath' | 'done';
/** The whole deck, pushed on change over `/ws`. `at` is epoch MILLISECONDS (`Date.now()`), unlike every field inside a snapshot. */
export type ArcStateEvent = { kind: 'arc_state'; arcs: ArcSnapshot[]; at: number };
/** What one relayed arc verb did — the shape `RunnerVerbResult` gives a run's verbs, with the arc's name where the run id was, since `plan-runner arc reorder|model|start|schedule <name> …` names an arc rather than a run. `reason` is present only when the runner never got to answer: it timed out, or its binary could not be spawned. */
export type ArcVerbResult = { ok: boolean; arc: string; exit: number | null; stdout: string; stderr: string; reason?: 'timeout' | 'spawn-failed' };
// ---------------------------
/** How a launcher soul is going while it is out, and how it ended once its receipt landed. `stopped` is a cap, not a fault; the pinned agents keep the same two words apart for the same reason. */
export type SoulLaunchState = 'running' | 'completed' | 'failed' | 'stopped';
/** One launcher soul — a soul a session started by hand through `plan-runner soul` — as its pin draws it. `provider` is the one the pin PAINTS: `result.json`'s word once it landed, `spec.json`'s pin before then. `cost_usd`, `tokens`, `tokens_in`/`tokens_out` and `duration_s` are `null` until the receipt lands — and `cost_usd` is PAID dollars, `0` on a soul that rode the operator's Claude subscription, whose `tokens*` are then the whole of what it spent. */
export type SoulLaunchSnapshot = { launch_id: string; role: string; agent: string; brief: string; provider: 'deepseek' | 'claude'; blocked: boolean; state: SoulLaunchState; status: string; cause: string; started_at: number; ended_at: number | null; duration_s: number | null; cost_usd: number | null; tokens: number | null; tokens_in: number | null; tokens_out: number | null };
/** The whole picture, pushed on change over `/ws`. `launches` is ordered by `started_at` ascending. `at` is epoch MILLISECONDS, unlike every field inside a snapshot. */
export type SoulLaunchStateEvent = { kind: 'soul_launch_state'; launches: SoulLaunchSnapshot[]; at: number };

// ---------------------------
//----------------- KANBAN METIS: the session a board launches ------------

/**
 * One Metis session — a board's own autonomous builder — as the pilot panel draws it.
 *
 * Mirrored field for field from `server/shared/types.ts`. `sessionId` is the uuid the board
 * minted and handed to `claude --session-id`: the state directory's name, the address of every
 * route and the input to the lease owner. `owner` is that derived owner, sixteen lowercase hex,
 * which is what the board compares on every build-lease verb. `model` is the `--model` the child
 * was actually given and `provider` says which endpoint it bills; the pair is settled at spawn.
 *
 * `lastActivityAt` is `child.log`'s mtime — the child is detached and owns its own log, so its
 * log's stamp is the only liveness signal that outlives a server restart. Every timestamp is
 * epoch MILLISECONDS.
 */
export type KanbanMetisSession = {
  sessionId: string;
  boardId: string;
  boardName: string;
  provider: 'deepseek' | 'claude';
  model: string;
  owner: string;
  launchedBy: 'operator' | 'driver';
  state: 'running' | 'completed' | 'stopped' | 'failed';
  pid: number | null;
  startedAt: number;
  endedAt: number | null;
  lastActivityAt: number;
  exitCode: number | null;
};

/** The whole picture, pushed on change over `/ws`. `sessions` is ordered by `startedAt` ascending. `at` is epoch MILLISECONDS, unlike every field inside a session. */
export type KanbanMetisStateEvent = { kind: 'kanban_metis_state'; sessions: KanbanMetisSession[]; at: number };

// ---------------------------
//----------------- UNIVERSE: the estate map and its live activity ------------

/**
 * One node of the estate map: a star (a tracked file), a body (a directory), a galaxy (a repo), the
 * sun (`core`), or an endpoint (a Postgres database or an MCP server).
 *
 * The keys and the numbers are the crawler's own, carried through untouched — `l`, `t` and `c` come
 * off the git history, and `p` indexes the map's `nodes` array as the one process that wrote them
 * assigned it. Nothing on this side recomputes an index.
 */
export type UniverseNode = {
  /** Basename only: where a node sits is the chain of `p` links above it. */
  n: string;
  /** Parent node index; `-1` for a repo, the sun or an endpoint, which hang off nothing. */
  p: number;
  /** `system` is a directory the crawler's `systems.json` names as an integration folder — one
   *  per outside system the repo talks to — a body like `dir` in every way but the mark. */
  k: 'galaxy' | 'core' | 'dir' | 'endpoint' | 'system' | 'source' | 'config' | 'docs' | 'data-sql' | 'assets' | 'other';
  /** Lines of the file; `0` for a directory or an endpoint, which have no length. */
  l: number;
  /** Epoch SECONDS of the newest commit touching it — what a star's brightness is read from. */
  t: number;
  /** Commits touching it — the churn a star's size and brightness are read from. */
  c: number;
};

/**
 * The whole estate as one payload: every repo the registry covers, flattened into one node list
 * with every index already global. This is `merged.json` as the crawler wrote it, and the only
 * thing the tab reads.
 *
 * `mapId` is the first 12 hex of the four repo HEAD shas joined by a newline, so it changes when,
 * and only when, a repo's HEAD moves: a client holding a different one refetches, and that is the
 * whole invalidation rule. `resolve` is shipped as DATA rather than restated as code — a consumer
 * takes the FIRST entry its path starts with and never re-sorts, because the entries are ordered
 * longest path first and the ordering IS the rule.
 */
export type UniverseMap = {
  mapId: string;
  /** Epoch SECONDS of the crawl that wrote this map. */
  builtAt: number;
  repos: {
    id: string;
    head: string;
    /** Index of this repo's node in `nodes` — where its file tree begins. */
    base: number;
    files: number;
    dirs: number;
    builtAt: number;
  }[];
  nodes: UniverseNode[];
  /** Flat `[from, to, weight]` triples over `nodes` indices, one list per relation. */
  edges: {
    tree: [number, number, number][];
    import: [number, number, number][];
    cochange: [number, number, number][];
    endpoint: [number, number, number][];
  };
  /** The HTTP routes the app serves; `n` is the node of the file that declares one. */
  routes: { m: string; p: string; n: number }[];
  /** Logger name → the node of the file that logs under it. */
  loggers: Record<string, number>;
  /** Table name → the node of the file that touches it. */
  tables: Record<string, number>;
  /** The non-file nodes, appended after the file nodes and carrying no parent. */
  endpoints: { id: string; k: 'pg' | 'mcp' }[];
  /**
   * Cross-repo edges by SHARED ATTENTION: `w` counts the sessions that read, named or edited files
   * in both repos. It is not an edit edge, and nothing on screen may call it one.
   */
  attention: { a: string; b: string; w: number }[];
  resolve: { id: string; path: string }[];
  /** What a best-effort tap could not answer — a route dump that timed out, a repo it could not read. */
  warnings: string[];
};

/**
 * One row of the estate's live activity, from a `universe_activity` frame: what happened, where, and
 * how much of it since the last frame. Rows are aggregated before they are sent — the raw stream is
 * an edit per keystroke and an execution per log line, and the wire carries neither.
 */
export type UniverseActivityRow = {
  /** Node index into the map; `-1` when nothing resolved. */
  node: number;
  kind: 'edit' | 'exec';
  /** Raw events this row aggregates since the last frame. */
  count: number;
  /** Epoch MILLISECONDS of the newest raw event in this row — unlike the map's epoch-second stamps. */
  at: number;
  /** A systemd unit name, or `'session'`. */
  source: string;
  /** The Claude session id, when `source === 'session'`. */
  session?: string;
};

/**
 * What the estate's feed puts on the live bus (`universe:*`): the last window's activity COUNTED,
 * never the rows themselves. The bus retains one value per topic and compares each publish by
 * `JSON.stringify`, so a lane carrying the raw stream would stringify the whole payload ten times a
 * second for as long as the estate is busy — the digest is what makes the lane cost a summary.
 *
 * `at` is the newest raw event the window held, epoch MILLISECONDS, and is what a reader measures
 * the digest's staleness against: a quiet minute publishes nothing, so the counts describe the last
 * window that had anything in it rather than the last second that elapsed.
 */
export type UniverseDigest = { edits: number; execs: number; at: number };

// ---------------------------
//----------------- CHAT GUTTERS ------------
// The desktop chat's side gutters: optional widgets beside the transcript, each draggable between
// the four slots. The placement is a setting the client owns (it never reaches the server), so
// these types describe a stored shape rather than a wire one.

/** Which side of the transcript a widget sits on. Each side is ONE stack: a widget is dropped into
 *  a place in it, and the rest close up or make room — there is no fixed number of berths. */
export type GutterSide = 'left' | 'right';

/** The widgets a chat gutter can hold: the plan-runner runs of the open session, the memory-intake
 *  rows proposed by it, the subagents that session has pinned, and the embed — a live page the chat
 *  named, or the reader typed in. These are the ids the DOM carries as `data-widget`, and the keys
 *  `useGutterPlacements` stores its records under. */
export type GutterWidgetId = 'runner' | 'memory' | 'subagents' | 'embed';

/** One widget's place in its side's stack and whether it is expanded. `order` is the sort key within
 *  the side, dense from 0 after every move; a collapsed widget is still placed — it draws as a tab
 *  where it stands, which is what makes `open` a separate fact from the place rather than a value of
 *  it. */
export type GutterWidgetPlacement = { side: GutterSide; order: number; open: boolean };

/** Every widget's placement for ONE chat. A record rather than a pair of fields because a widget is
 *  addressed by its own id everywhere else in this feature, and a widget added later costs one member
 *  here rather than a second parallel field. `UserPreferences.chatGutters` holds a fallback of this
 *  shape plus one per session — see `useGutterPlacements`, which owns the stored shape. */
export type ChatGutterPlacements = Record<GutterWidgetId, GutterWidgetPlacement>;

// ---------------------------
//----------------- SUBAGENT TRANSCRIPTS ------------
/** What one subagent transcript read answers, mirrored byte-for-byte from the server's `server/shared/types.ts`. `found` is `false` when the session, provider, file or launch cannot be resolved — then `activity` is empty, `total` is 0, `inFlight` is `false` and `finishedAt` is `null`, and "not found" is a 200 carrying this shape, never an HTTP error. `activity` is the LAST 1000 entries (the server's `SUBAGENT_TRANSCRIPT_LIMIT`), each truncated, and `total` is the untruncated count. */
export type SubagentTranscriptResult = { found: boolean; activity: SubagentActivity[]; total: number; inFlight: boolean; finishedAt: string | null };

// ---------------------------
//----------------- CHAT SUBAGENT WIDGET ------------
/** What the chat publishes for its Subagents widget: the session the rows belong to, the agent container rows of the history the chat has loaded, and the launcher-soul ids that same history anchored. Scoped by `sessionId`, which the widget checks before drawing anything — rows tagged with another chat are refused, not shown. */
export type ChatSubagentSource = { sessionId: string; agentMessages: ChatMessage[]; soulLaunchIds: string[] };

// ---------------------------
//----------------- CHAT EMBED WIDGET ------------
/**
 * What the chat publishes for its Embed widget: the session the addresses belong to, and every
 * embed fence that session's loaded history declares, oldest first.
 *
 * Scoped by `sessionId` exactly as `ChatSubagentSource` is, and checked the same way — a list tagged
 * with another chat is refused rather than shown, which is what stops the widget carrying one
 * conversation's dashboards into the next. The targets are `EmbedUrlRef`s, the SAME shape
 * `classifyWidgetBody` produces for the inline card, because the widget and the card must never
 * disagree about what an address, a title or a height is.
 */
export type ChatEmbedSource = { sessionId: string; targets: EmbedUrlRef[] };

/** What the widget's transcript view is open on: an `Agent`-tool row addressed by the tool call that spawned it (`id` is that call's `tool_id`), a launcher soul addressed by its launch id, or a board's Metis addressed by the session id the board minted. Its third consumer is the kanban module's `KanbanMetisPanel.tsx`, which opens a fleet row into the same view rather than a copy of it. */
export type SubagentTranscriptTarget = { kind: 'agent' | 'soul' | 'metis'; id: string };

//----------------- JEV SEMANTIC JUDGMENT: switches and the reader ------------
/** The house Jev switches as one answer, mirrored from the server's `JevSwitches`: the master, each scope's STORED value, and each scope's LIVE one. A live field is the pair's actual effect (`master && stored`), not a file of its own — a narrower opt-in counts only while the master is on, and that rule is derived server-side so the panel cannot hold a second opinion about it. A scope added on the server arrives here as two more fields, which is why `JevContent.tsx` draws its rows from a table rather than field by field. */
export type JevSwitchState = {
  master: boolean;
  prompts: boolean;
  promptsLive: boolean;
  toolOutput: boolean;
  toolOutputLive: boolean;
};

/** The Jev reader's whole answer (`jev stats --json`), key for key: the tab draws it and nothing else. `balance` is an ESTIMATE — TypeSafe has no balance API — and `null` when the account file cannot be read; every `usd` is `null` for the same reason. `net` is all-time whatever `range` asked. */
export type JevRange = 'today' | '7d' | '30d' | 'all';
export type JevVerbTally = { calls: number; tokens: number; usd: number | null };
export type JevConsumer = {
  caller: string; calls: number; tokens: number; usd: number | null; share: number;
  avg_latency_s: number | null; unavailable: number; cache_hits: number; refusals: number;
  verbs: Record<string, JevVerbTally>; asks: string | null; source: string | null; mapped: boolean;
};
export type JevDay = { day: string; calls: number; tokens: number; usd: number | null };
export type JevFeedRow = {
  ts: number; caller: string; verb: string; ok: boolean | null; tokens: number | null;
  latency_s: number | null; answer: number | string | null; items: number | null;
};
export type JevReferenceRow = {
  caller: string; asks: string | null; source: string | null; mapped: boolean; retired: boolean; calls_all: number; last_ts: number | null;
};
export type JevSummary = {
  generated_at: number;
  ledger: { present: boolean; rows: number; bad_rows: number; bytes: number; first_ts: number | null; last_ts: number | null };
  switches: { master: boolean; prompts: boolean; tool_output: boolean };
  price: { usd_per_mtok: number | null; credit_usd: number | null; unledgered_tokens: number };
  balance: { credit_usd: number; spent_usd: number; left_usd: number; estimate: true } | null;
  spend: { today_usd: number | null; week_usd: number | null; all_usd: number | null; today_calls: number; week_calls: number; all_calls: number };
  days: JevDay[];
  range: JevRange;
  range_since: number | null;
  totals: { calls: number; tokens: number; usd: number | null; unavailable: number; cache_hits: number; cached_tokens: number; refusals: number; p50_s: number | null; p95_s: number | null };
  consumers: JevConsumer[];
  top: { caller: string; usd: number | null; share: number; asks: string | null } | null;
  net: { lines_in: number; lines_kept: number; chars_saved: number; net_chars: number; by_caller: { caller: string; chars: number }[] };
  feed: JevFeedRow[];
  reference: JevReferenceRow[];
  cache: { path: string; keys: number | null; draws: number | null; bytes: number | null; file_bytes: number | null; error: string | null };
  budget: { counters: { key: string; used: number; mtime: number }[] };
  no_send: { paths: string[]; source: 'file' | 'missing' };
};

// ---------------------------
//----------------- CRON REGISTRY: the tracked record of every scheduled job ------------
//
// The CLIENT MIRROR of the CRON REGISTRY group in server/shared/types.ts, field for field and
// doc-comment for doc-comment, for the Schedules tab. The registry is WRITTEN server-side — by
// the sync, and by the module's CLI door — and read here; nothing in this file mints a shape the
// server does not answer, so a field renamed on the server is a type error here rather than an
// `undefined` on screen.

/** Which of the two things a tracked row is: `cron` is a line the box's crontab runs, `scheduled-prompt` is a message the app will send at a time the operator chose. The kind decides which half of `CronJobState` the row may carry — the two never trade values. Mirrors the server's `CronJobKind` in server/shared/types.ts. */
export type CronJobKind = 'cron' | 'scheduled-prompt';
/** Whose job it is — always `user`: the registry tracks the operator's own crontab and scheduled prompts, and the OS's system cron is not read (operator ruling 2026-09-21: nothing the packages ship belongs on the screen). It stays a field because every stored row and every id carries it. Mirrors the server's `CronJobOrigin` in server/shared/types.ts. */
export type CronJobOrigin = 'user';
/** Every state a tracked job can be in. The four cron values and the three scheduled-prompt values share one union because a row of either kind is read through the same shape — but a row is only ever one kind's set, never a mix. Mirrors the server's `CronJobState` in server/shared/types.ts. */
export type CronJobState =
  | 'ok' | 'failed' | 'missing' | 'unknown'   // a cron row is only ever one of these four
  | 'pending' | 'sent' | 'cancelled';         // a scheduled-prompt row adds these three
/** How far a tracked row has moved from what the box actually holds: `none` when the sync's read agrees with the record, `adopted` when the row was just discovered, `missing` when the line is gone from the box, `changed` when the schedule or the command moved underneath it. Only the CLI door clears drift. Mirrors the server's `CronJobDrift` in server/shared/types.ts. */
export type CronJobDrift = 'none' | 'adopted' | 'missing' | 'changed';
/** One tracked job, exactly as the registry holds it: one crontab line or one scheduled prompt, with everything the screen shows and the sync writes. Every field is declared here — this file reads what the server wrote and invents nothing. Mirrors the server's `CronJob` in server/shared/types.ts. */
export type CronJob = {
  id: string;                 // stable: `${kind}:${origin}:${sha1(command).slice(0,12)}`
  kind: CronJobKind;
  name: string;               // the operator's plain name; derived from the command on adoption
  purpose: string | null;     // why it exists — null until someone says
  tags: string[];             // short lowercase words for what it is for at a glance ('cleanup'); [] when none
  owner: string;              // 'lyphe' for a crontab line; the asking user's id for a prompt
  origin: CronJobOrigin;      // always 'user' — see CronJobOrigin
  expression: string;         // the raw cron expression, verbatim
  scheduleText: string;       // plain words, e.g. 'every hour at :47'
  command: string;            // the command line as the box holds it
  logPath: string | null;     // absolute path from a `>>` redirection, else null
  state: CronJobState;
  drift: CronJobDrift;
  driftDetail: string | null; // what differs, in one clause; null when drift is 'none'
  lastRunAt: string | null;   // ISO-8601 with offset, written by the sync
  lastResult: string | null;  // 'invoked' when only the journal saw it; null when nothing did
  nextRunAt: string | null;   // a scheduled-prompt row's own `scheduled_for`; null for a cron row
  note: string | null;        // anything the record must carry that no other field holds
  source: string;             // 'crontab -l' | '/etc/cron.d/<f>' | '/etc/crontab' | 'scheduled_messages'
  trackedAt: string;          // ISO-8601 — when this row entered the registry
  updatedAt: string;          // ISO-8601 — when the sync last touched it
};
/** What one sync run did, told as counts rather than as a diff: what the box showed, what the registry gained, what it had to mark gone, and how long the read took. `ok: false` still carries a report — a sync that failed still ran, and the error text is the reason, never an exception thrown at the caller. Mirrors the server's `CronSyncReport` in server/shared/types.ts. */
export type CronSyncReport = {
  ranAt: string;
  ok: boolean;
  error: string | null;
  seen: number;      // cron lines read off the box this run
  adopted: number;   // rows the registry gained
  missing: number;   // rows now marked missing
  changed: number;   // rows whose schedule or command moved
  ms: number;
};

// THE STATE MAPPING, named here so the screen has to invent nothing. A `cron` row's state is
// 'ok' when the sync saw its line on the box, 'missing' when it did not, 'failed' when a reader
// could not answer for it, 'unknown' before any sync. A `scheduled-prompt` row carries
// `ScheduledMessageStatus` ONE-TO-ONE — 'pending' -> 'pending', 'sent' -> 'sent', 'failed' ->
// 'failed', 'cancelled' -> 'cancelled'. Nothing is collapsed: 'pending' is the operator's own
// question and must survive the trip.

/** The whole registry as one read: every tracked job, and the last sync that touched them — the answer `GET /api/schedules` gives. `lastSync: null` means no sync has ever been recorded, which is not the same as a sync that found nothing. Mirrors the server's `CronRegistrySnapshot` in server/shared/types.ts. */
export type CronRegistrySnapshot = {
  readAt: string;
  jobs: CronJob[];
  lastSync: CronSyncReport | null;
};

// ---------------------------
