import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

import type { KanbanCardSummary, KanbanLaneCount } from './kanban-types.js';
import type { ChatToolsetHooks } from './toolset-types.js';

//----------------- HTTP RESPONSE SHAPES ------------
/**
 * Canonical success envelope used by backend APIs that return a structured payload.
 *
 * Use this for route handlers that need a stable `success/data` shape so frontend
 * consumers can parse responses consistently across endpoints.
 */
export type ApiSuccessShape<TData = unknown> = {
  success: true;
  data: TData;
};

/**
 * Generic plain-object record used when parsing loosely typed JSON payloads.
 *
 * Use this only after runtime shape checks, not as a replacement for validated
 * domain models.
 */
export type AnyRecord = Record<string, any>;

// ---------------------------
//----------------- WEBSOCKET TRANSPORT TYPES ------------
/**
 * Minimal websocket client contract used by backend broadcaster services.
 *
 * Any transport object added to `connectedClients` must implement these two
 * members so shared services can safely send JSON strings and check whether the
 * socket is still open before broadcasting.
 */
export type RealtimeClientConnection = {
  readyState: number;
  send(data: string): void;
};

/**
 * Authenticated user payload attached to websocket upgrade requests.
 *
 * Platform and OSS auth flows currently use either `id` or `userId`; both are
 * represented here so websocket handlers can resolve a stable writer user id.
 */
export type AuthenticatedWebSocketUser = {
  id?: string | number;
  userId?: string | number;
  username?: string;
  [key: string]: unknown;
};

/**
 * HTTP upgrade request shape after websocket authentication succeeds.
 *
 * `verifyClient` populates `request.user` with the authenticated payload, and
 * downstream websocket handlers rely on this extended request type.
 */
export type AuthenticatedWebSocketRequest = IncomingMessage & {
  user?: AuthenticatedWebSocketUser;
};

// ---------------------------
//----------------- PROVIDER MESSAGE MODEL ------------
/**
 * Providers supported by the unified server runtime.
 *
 * Use this as the source of truth whenever a function or payload needs to identify
 * a specific LLM integration.
 */
export type LLMProvider = 'claude' | 'codex' | 'cursor' | 'opencode';

/**
 * One selectable model row in a provider model catalog.
 */
export type ProviderModelOption = {
  value: string;
  label: string;
  description?: string;
  /** Stable SQLite row id used only by model-management actions. */
  recordId?: number;
  /** True for user-created rows; false for immutable CloudCLI defaults. */
  isCustom?: boolean;
  effort?: {
    default?: string;
    values: {
      value: string;
      description?: string;
    }[];
  };
};

/**
 * Provider model catalog returned by `GET /api/providers/:provider/models`.
 *
 * `LABELS_BY_MODEL_ID` is present only where the provider reports its own catalog (Claude): the
 * name it gives each concrete model id it can run, offered in `OPTIONS` or not, so a stored turn
 * that recorded `claude-sonnet-5` is captioned "Sonnet 5" by the CLI's own words.
 */
export type ProviderModelsDefinition = {
  OPTIONS: ProviderModelOption[];
  DEFAULT: string;
  LABELS_BY_MODEL_ID?: Record<string, string>;
};

/**
 * One persisted custom-model row in the provider model library.
 *
 * Provider modules use this shape at the database boundary. Predefined models
 * never use this type because each provider adapter supplies them itself.
 * `modelId` is sent to the provider runtime, while `model` is the
 * user-supplied display name shown in pickers.
 */
export type CustomProviderModelRecord = {
  recordId: number;
  provider: LLMProvider;
  modelId: string;
  model: string;
  sortOrder: number;
};

/**
 * User-editable values accepted when creating or changing a custom model.
 *
 * `id` must be the exact provider-facing model identifier and cannot contain
 * whitespace. `model` is a concise display name. The provider is supplied by
 * the route path so a row can never be moved across providers accidentally.
 */
export type CustomProviderModelInput = {
  id: string;
  model: string;
};

// ---------------------------
//----------------- PROVIDER ACTIVE MODEL TYPES ------------
/**
 * Provider-neutral result for the model that is actively driving a session or
 * provider runtime at the time of lookup.
 *
 * `model` must always be populated. Provider adapters should use the
 * provider-specific lookup method requested by the caller, and only fall back
 * to the provider catalog `DEFAULT` value when the active model cannot be read.
 */
export type ProviderCurrentActiveModel = {
  model: string;
};

/**
 * Where a resolved session model came from.
 *
 * `session` means the app has recorded a model for this session (the user
 * picked one, or the session has been sent on at least once) and that value is
 * authoritative. `provider` means the session predates any app-recorded model
 * and the value was read back from the provider's own session state — the case
 * for sessions started directly in a provider CLI. `default` means neither was
 * available and the catalog default is standing in.
 *
 * Routes surface this so the frontend can tell a real selection apart from a
 * placeholder without re-deriving the precedence chain.
 */
export type ProviderSessionModelSource = 'session' | 'provider' | 'default';

/**
 * The model one session runs with, its persisted reasoning effort when one has
 * been recorded, and where the model answer came from.
 *
 * Returned by `providerModelsService.resolveSessionModel` and used by the
 * `/models`, `/cost` and `/status` commands, the active-model route, and the
 * composer's model picker so every surface agrees on one answer.
 */
export type ProviderSessionModel = {
  provider: LLMProvider;
  sessionId: string | null;
  model: string;
  /** NULL means this session has not recorded an effort choice yet. */
  effort: string | null;
  source: ProviderSessionModelSource;
};

/**
 * Message/event variants emitted by provider adapters and normalized transports.
 *
 * Keep this union in sync with event kinds produced by provider session adapters.
 */
export type MessageKind =
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
  | 'task_notification'
  | 'compaction';

/**
 * Event kinds added by the chat gateway layer on top of provider message kinds.
 *
 * These are app-level realtime events (subscription acks, sidebar deltas,
 * project loading progress, protocol failures) that are not produced by any
 * provider adapter. Together with `MessageKind` they form the complete set of
 * `kind` values a websocket client can receive, so the frontend only ever
 * needs one kind-based switch.
 */
export type GatewayEventKind =
  | 'chat_subscribed'
  | 'session_upserted'
  | 'loading_progress'
  | 'soul_launch_state'
  | 'kanban_metis_state'
  | 'kanban_event'
  | 'notes_changed'
  | 'cerberus_changed'
  | 'cerberus_run_output'
  | 'cerberus_diag_step'
  | 'simple_list_changed'
  | 'session_toolsets_changed'
  | 'session_host_liveness'
  | 'universe_activity'
  | 'universe_map'
  | 'pong'
  | 'protocol_error';

/**
 * Complete set of `kind` values emitted to websocket clients.
 *
 * Every server-to-client websocket frame carries a `kind` from this union.
 * Provider runtimes emit `MessageKind` values; gateway services emit
 * `GatewayEventKind` values.
 */
export type ServerEventKind = MessageKind | GatewayEventKind;

/** The owning project as it appears inside a `session_upserted` delta. */
export type SessionUpsertedProject = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
};

/**
 * The `session_upserted` sidebar delta, built only by
 * `modules/websocket/services/session-upsert-broadcast.service.ts`.
 *
 * Typed rather than assembled as an untyped object literal because the payload
 * used to be built in two places and silently drifted apart: one copy set
 * `providerSessionId` and the other did not, and nothing could detect it.
 *
 * `providerSessionId` is how a client recognises that a row it is currently
 * showing has been merged into its canonical app-session row, so it is always
 * present — `null` only while the provider has not reported an id yet.
 */
export type SessionUpsertedEvent = {
  kind: 'session_upserted';
  sessionId: string;
  providerSessionId: string | null;
  provider: LLMProvider;
  session: {
    id: string;
    summary: string;
    messageCount: number;
    lastActivity: string;
  };
  project: SessionUpsertedProject | null;
  timestamp: string;
};

/**
 * The board frame: one write has committed, and this is what it left behind.
 *
 * Built and sent by exactly one function, `writeKanban` in
 * `modules/kanban/kanban-write.service.ts` — no verb, route or repository ever constructs one.
 * It is assembled AFTER the transaction commits, so a write that rolled back never told a client
 * it happened, and the card and lane totals it carries are read fresh rather than predicted.
 *
 * `card` is null for a board-level write; `lanes` is the board's per-status totals after the
 * write, which the panel sums through its own lane policy. `at` is epoch MILLISECONDS.
 *
 * `boardId` is null for the writes made against the ESTATE rather than a board — a lesson staged
 * with no card behind it — and `lanes` is `[]` there, since a boardless write has no lanes to
 * count. Every consumer tests the board id before it trusts the rest of the frame, so such a frame
 * is inert where it does not apply and still a signal where it does.
 *
 * Declared here rather than in `kanban-types.ts` because `GatewayEventKind` lives here, and a
 * frame belongs beside its siblings. Mirrored field-for-field in `src/shared/kanban-types.ts`.
 */
export type KanbanBoardEvent = {
  kind: 'kanban_event';
  boardId: string | null;
  event: { id: number; ts: string; kind: string; cardId: string | null; actor: string };
  card: KanbanCardSummary | null;
  lanes: KanbanLaneCount[];
  at: number;
};

/**
 * The simple chat list's shape changed: a folder was made, renamed, folded, moved or deleted, or a
 * chat changed place or folder. It names nothing: a reader that hears it re-reads the feed.
 * Built only by `modules/providers/services/simple-list.service.ts`.
 */
export type SimpleListChangedEvent = { kind: 'simple_list_changed'; at: number };

/**
 * Which chats have a live session host (a tmux session on the keepalive server, or on a node's
 * warden), built only by `modules/providers/list/claude/session-host/host-liveness.ts`.
 *
 * A chat with no host is ASLEEP: no CLI runs for it, and its next message starts one. One shape, three
 * `change`s, each naming its chats in `sessionIds`:
 * - `snapshot` — every chat with a host right now. Sent once to a socket as it connects, so a page
 *   that applies it and then each change below holds the same set the server does.
 * - `live` — these chats gained their first host (a message spawned one, or a restart re-adopted one).
 * - `asleep` — these chats lost their last host (an idle close, a crash, the tmux server going down).
 *
 * The ids ride an ARRAY and not a `sessionId` key on purpose: the workspace flags a chat for attention
 * (the unread mark) when any frame carries a `sessionId` that is not the one on screen
 * (`useProjectsState`), and a host ending is no news in the chat. Like `notes_changed`, the frame
 * carries no `seq` and no `sessionId`, so it can never become a transcript row or a mark.
 *
 * Only Claude chats ever have a host, so a chat of another provider is in no snapshot and a reader
 * must not read its absence as asleep. `at` is epoch MILLISECONDS. Mirrored by the client's
 * `SessionHostLivenessContext`, which reads these fields off the loose `ServerEvent`.
 */
export type SessionHostLivenessEvent = {
  kind: 'session_host_liveness';
  change: 'snapshot' | 'live' | 'asleep';
  sessionIds: string[];
  at: number;
};

/** Sent to every open socket after a note is created, replaced or deleted. It names no note and no account: a client that hears it reads its own list again. It carries no `seq` and no `sessionId`, so it can never become a transcript row. */
export type NotesChangedEvent = { kind: 'notes_changed'; at: number };

// ---------------------------
//----------------- DISPATCHER: the store's one status document, mirrored key for key ------------
// The dispatcher keeps its plans in a SQLite store rather than in files, so the ONE picture of them
// is a document: `hooks/dispatcher/report.py::snapshot`, what `dispatcher status --json` prints. The
// types below mirror it key for key and name for name. The server converts NOTHING — every key, word
// and string below is the document's own — and the client's `epochOf` is the single ISO-to-epoch
// edge, because every time below is the store's own `YYYY-MM-DDTHH:MM:SSZ` UTC string, never a
// number. ONE TEXT IN TWO FILES (`src/shared/types.ts` and `server/shared/types.ts`, the two
// builds' shared trees): a change to either shape belongs in both at once.

/** One stage of a phase's chain: a row of the store's `stages` table, `phase_chain`'s projection of the chain record (`chain.json`). `settle` REPLACES a phase's rows rather than appending, so a stage a walk re-enters is one row again (INV-181). `soul` is the soul the stage launched and `launch_id` that launch's own id; `resumed_sid` is the session a resume ran it under. `verdict` is the soul's own outcome word and is free text, reaching the DOM as a text node. `cost_usd` is PAID dollars — `0` on a stage on the operator's Claude subscription — and the `tokens`/`tokens_in`/`tokens_out` beside it are THE SUBSCRIPTION'S ALONE: a spend figure is dollars OR tokens, by who was used (operator rule, 2026-09-24), so a stage a vendor billed reads `0` in all three beside its `$`. All three come off the launch's own `result.json` at the dispatcher's report time, never from a store column (INV-172). `tokens_cache_read` is the part of `tokens_in` SERVED from the prompt cache (`costs.claude_cache_read`) — the card's `(94% cache)` numerator — and `null` where nothing states it: a record written before the field (no backfill), or on a phase, plan or arc, a sum over any such record, since a partial numerator under a whole `in` would understate the share. `paid_vendor` names the vendor those paid dollars were billed by (`DeepSeek`, `Claude API`, or `""` for a mix or a row whose record is gone), read tolerantly: a build older than the field writes none. */
export type DispatcherStage = { name: string; soul: string | null; launch_id: string | null; session_id: string | null; resumed_sid: string | null; launched_at: string | null; returned_at: string | null; output_path: string | null; verdict: string | null; cost_usd: number; paid_vendor: string | null; tokens: number; tokens_in: number; tokens_out: number; tokens_cache_read: number | null };
/** One phase of a plan, addressed by its stable `key` (INV-183 — never by position, which `put_phases` renumbers on every reload). `busy` is `phase_chain.busy`: the walker alive OR the soul it has in flight still out, which is the question the rule and the daemon ask — a phase whose walker was killed while its soul still bills reads busy, so the status column alone is never the liveness answer (INV-186). `waits_on` carries the waited phases' KEYS in position order, `start_here` the phase row's own JSON list of entry points. `rounds` is `store.rounds` — the DISTINCT `athena-*` stage names, never the launch count — and `cost_usd` sums this phase's stage rows; both are derived at read time, never stored (INV-172). `tokens*` are the same sum over the stages' own records, PAID dollars' token counterpart. `paid_vendor` labels that sum the same way, `""` for a mix. */
export type DispatcherPhase = { key: string; position: number; title: string; assignee: string; status: 'not started' | 'running' | 'done'; chain_id: string | null; done_at: string | null; waits_on: string[]; busy: boolean; /** Why this phase's run has ENDED with nothing to record it (`report_stall`), or `null` while it is moving, settled or not the daemon's to move: `dispatcher_down` — no daemon holds the home — or `ended_unrecorded` — a daemon does and has not recorded the ending. Never the status column, which is the thing that lags: a phase reads `running` here for as long as nothing settles it. */ stalled: DispatcherStall | null; rounds: number; cost_usd: number; paid_vendor: string | null; tokens: number; tokens_in: number; tokens_out: number; tokens_cache_read: number | null; start_here: string[]; stages: DispatcherStage[] };
/** One line of a plan's log, oldest first in `DispatcherPlan.events`. `phase` is the phase's KEY or null — the table stores a phase id, and an id is not an address (INV-183). `detail` is free text and reaches the DOM as a text node. */
export type DispatcherEvent = { id: number; at: string; phase: string | null; kind: string; detail: string | null };
/** ONE planner outing: the soul the dispatcher's daemon has out on one piece of work, on one model, for one stretch of time — `store_planners`' row as `report_planners._entry` reads it. A planner is NOT a phase and not a stage: nothing in a session dispatches it, it rides the operator's Claude subscription (so `tokens` is the figure and `cost_usd` is `0`), and its liveness is the store's own `state` rather than a column a card has to derive. `target` is the bare name the outing is FOR — a plan's, or an ARC's for the arc's own design, its cut and its judgment — and `plan` is the name it lands in, equal to `target` except for a judgment, which targets its arc and lands in `<arc>--judgment`. `verb` is the work it is doing and `state` is the row's own: `queued` and `out` are LIVE (the rule owes each something), `ended` is the record that the child is gone. `stalled` is the document's ONE derived word and is true on exactly the endings whose work is still unfinished — every `ended` entry the document carries is one, so a reader never re-asks the question to tell them apart. `outcome` is what an ending left behind: `done` when it did what it was for, else the crash the launch's own `result.json` carried. `launch_id` names the launch, and `tokens`/`cost_usd` are read off that launch's result at report time and never stored (INV-172). `paid_vendor` is the label of those dollars, off the launch's own bill word. */
export type DispatcherPlanner = { id: number; target: string; plan: string; soul: string; verb: 'design' | 'judge' | 'tell' | 'cut'; model: string; state: 'queued' | 'out' | 'ended'; stalled: boolean; launch_id: string | null; created_at: string; launched_at: string | null; ended_at: string | null; outcome: string | null; tokens: number; cost_usd: number; paid_vendor: string | null };
/** The two causes a phase's or a plan's `stalled` word carries (`report_stall`): `dispatcher_down` when no daemon holds the home, so nothing can record anything, and `ended_unrecorded` when one does and has not. Both are answered by Resume, which wakes or starts the daemon. */
export type DispatcherStall = 'dispatcher_down' | 'ended_unrecorded';
/** The plan's word, in ONE precedence: `complete`, `hidden`, `scheduled`, `paused`, `queued`, `stalled`, `live`, `parked`, else `idle`. `hidden` is a plan the operator hid (`DispatcherPlan.hidden` says since when): held out of the queue and paused until he Shows it, and it outranks every word below it — an hour armed for it fires into a refusal, so a card reading `scheduled` over it would promise a start nothing makes. `stalled` is a released plan (approved, unpaused) whose only running work has ENDED with nothing to record it — never `live`, because nothing is moving it; `DispatcherPlan.stalled` says why. `scheduled` outranks the pause flag on purpose — a paused plan with an hour set is going to start by itself, and calling it merely `paused` would hide the one fact the operator needs. `paused` and `queued` are told apart by whether a walk ever launched: a paused plan that has run is stopped mid-plan, one that never launched is still waiting at the gate. */
export type DispatcherPlanStatus = 'idle' | 'parked' | 'queued' | 'scheduled' | 'paused' | 'stalled' | 'live' | 'hidden' | 'complete';
/** Since when the operator has had a plan hidden, and the epic whose press it was (`hooks/dispatcher/store_hidden.py`, `report.hidden_reading`): `at` is the hide's own store stamp — the moment the card's news let-go compares against — and `arc` is the epic's bare name when the press was the epic deck's (its plans then leave and return as one), else `null`. */
export type DispatcherPlanHidden = { at: string; arc: string | null };
/** The prompt CloudCLI has put up for a plan — on its card in the Roadmap tab's In flight face and in the Runs widget — and is still waiting on (`hooks/dispatcher/ask.py:asking`) — `null` on every plan it is not asking. `accept` is the intent lock: `question` is `dispatcher question`'s prompt word for word, markdown (the census line, what the plan delivers, its facts and open questions, then the phase lines with the done ones marked), `token` the lock it carries, `options` the three answers in their contract order — Queue, Hide, Rework — and `rework` the designer targets a Rework's notes are told to; `plans` is every plan the one lock names (an arc's lock names each plan of it still owing an Accept). `questions` is the designer's round: each question's text and options as `dispatcher show` prints them, and `target`, the name `dispatcher tell` sends the answers to. `asked` is the store's own record of the ask — the `asked` event's id and stamp — which is what makes a prompt the same ask across a restart. The card, the phone's buttons and every verb an answer runs are drawn from this and nothing else. */
export type DispatcherAsk = { plan: string; plans: string[]; asked: { id: number; at: string } } & ({ kind: 'accept'; header: string; question: string; token: string; options: Array<{ label: string; description: string }>; rework: string[] } | { kind: 'questions'; questions: Array<{ text: string; options: string[] }>; target: string });
/** One plan whole: its row, its waits, its armed hour, its books, its phases in position order and its log oldest first. `state` is the STORE's own state word — `designing`, `designed`, `questions`, `loaded`, `parked` — a string rather than a union, because the store's vocabulary belongs to the store. `goal` is null on a plan that has been opened and not yet designed. `session` is the session that opened it, `author` the soul that wrote its design. `schedule` is the armed hour read back out of systemd at this instant (`schedule.armed`), `{ start_at, unit }` with `start_at` the timer's own ISO stamp — so a timer stopped or fired by hand reads null here at once. `cost_usd`, `rounds` and `tokens*` sum this plan's phases — and `cost_usd` is PAID dollars, so a plan that rode the operator's Claude subscription reads `0` there while its tokens count everything it spent. `paid_vendor` names the vendor those dollars were billed by (`DeepSeek`, `Claude API`, or `""` for a mix or a swept record), read tolerantly. `launched` is whether a walk has ever gone out for it — see the field. */
export type DispatcherPlan = { name: string; state: string; status: DispatcherPlanStatus; /** Since when the operator has had this plan hidden, or `null` while it is shown (`DispatcherPlanHidden`). Set exactly when `status` is `hidden`. Read tolerantly: a dispatcher build older than the key writes none, which reads as shown. */ hidden: DispatcherPlanHidden | null; repo: string; goal: string | null; delivers: string | null; session: string | null; /** The ONE field the server ADDS, which is why this type is not a pure mirror: the plan's `session` resolved through `sessionsDb.resolveAppSessionId` (the rule `dispatcher-state.service.ts` follows), `null` when the plan names no session or the id resolves to none. The document's own `session` travels untouched beside it. */ session_app_id: string | null; author: string | null; /** The name of the ARC this plan belongs to (`plans.arc_id` read through the arc row), or `null` for a plan of no arc — the join a card makes against the same document's `arcs` list. The bare name, with no `.arc` adornment. */ arc: string | null; /** The ONE planner outing this plan reports (`report_planners.of_plan`): its own newest live row, else its arc's when it has none of its own, then the newest ending of either whose work is still SHORT of a plan. So a plan of an arc being designed whole reports the arc's design, and a plan whose own cut died reports that cut. `null` on a plan no planner is on. Read tolerantly (`plannerSince`), so a dispatcher build older than the field draws no badge rather than blanking every card. */ planner: DispatcherPlanner | null; /** The plan's EFFECTIVE model word (`dispatcher/model.py:model.of`): its own, else its arc's, else the HOUSE switch's reading now (`deepseek_flash.flag`, the one Settings and the chat box draw) — what this plan's next chain will really be launched with, never a bare column. `null` only against a dispatcher build older than the field, which reads the house switch (`effectiveModelWord`). */ model: DispatcherModelWord | null; /** The plan's OWN model word (`plans.model`), or `null` while it carries none and follows its epic and then the house switch — the override a card's fold names. `null` against a build older than the field. */ model_own: DispatcherModelWord | null; /** THIS plan's posture in one phrase (`width.word`): the route it walks, as the gate acts on it — `claude route`. The card's caption reads it in place of the box's `DispatcherRoute.word`, so a plan is never captioned with a word that is not the one in force for it. `null` against a build older than the field, where the box's phrase is the only one there is. */ posture: string | null; /** Why this plan waits for its epic's turn (`report.plan_dict.queue_hold`): the QUEUE clause the gate (`line_gate.hold`, the first of the two `width.reason` asks) returns for the plan's first ready phase — `queue: Pause all is on` or `queue: <epic> goes first` — while the plan is eligible, and `null` otherwise (an epic that has started, an epic whose turn it is, a plan of no epic). It is the clause as the dispatcher words it, with the `queue:` lead; the card strips the lead. `null` against a dispatcher build older than the field, where no line is drawn. Read tolerantly (`textSince`). */ queue_hold: string | null; /** Why this plan waits for the pacer's room (`report.plan_dict.pace_hold`, interface VI's gate): the PACE clause the gate returns for the plan's first ready phase — `pace: no room on the 5-hour window — …`, or `pace: <plan> <phase> goes first` — else for a queued planner outing aimed at the plan or at its epic (a design, tell or cut the pacer has not let out) while the plan has no phase held, and `""`/absent otherwise — always `""` while `overridden` is `true`, since the override is what lifts the hold. It is the clause as the dispatcher words it, with the `pace:` lead; the card strips the lead and draws it in the same row as `queue_hold`, of which the gate sends one at a time. Absent against a dispatcher build older than the field, where no line is drawn. Read tolerantly (`textSince`). */ pace_hold?: string; /** Whether the plan starts PAST THE PACER by the operator's override (`report.plan_dict.overridden`, the `pace-overridden` record on the plan's log — `dispatcher override`): the pacer's hold is lifted for this plan's phases and for the queued planner outings aimed at it or at its epic (while any open plan of the epic carries the override), and nothing else is. `pace_hold` is `""` while this is `true`: a held plan the operator lifted reads `overridden: true` and no clause. `false` for a finished plan and against a dispatcher build older than the field. The card draws `Override on` with `Turn off` from it, and `Override` beside `pace_hold` while it is `false`. Read tolerantly (`flagSince`). */ overridden: boolean; created_at: string; updated_at: string; completed_at: string | null; prompted_at: string | null; paused: boolean; /** Whether a walk has EVER gone out for this plan (`report.launched`, read off the plan's own event rows and never stored — INV-172). It is the ONE fact the status word cannot state on its own: `paused` and `scheduled` both describe a plan that is not moving, and neither says whether it was stopped mid-walk or is still waiting at the gate. So it is also the word on the card's primary button — Resume for the first, Start for the second (a feature's own Start, the override of the board's one Start). An epic's deck draws nothing off it: its Resume is drawn for a plan stopped mid-walk or stalled, and its Pause for a released one (`report_arcs.midwalk` / `.stalled` / `.walking`). `false` against a dispatcher build older than the field. */ launched: boolean; /** Why the plan's ONLY running work has ended with nothing to record it (`report_stall`), or `null`: the cause beside the `stalled` status word, derived once by the dispatcher so no card works it out. */ stalled: DispatcherStall | null; approved: { at: string; by: string } | null; /** The operator's "Accept when cut" press on this plan (`store_armed`) — the door that pressed it, when, and the design stamp he read — or `null`. Set only while the plan is `designed` or its cut is landing; the daemon approves the first cut of that exact design and clears it. */ accept_armed: { at: string; by: string; design: string } | null; /** The stamp of the design the plan carries now (`designs.loaded_at`), or `null` before one is loaded: the card sends it back with its press, so a press on a design that has since moved is refused. */ design_loaded_at: string | null; /** The prompt CloudCLI has put up for this plan and is waiting on (`DispatcherAsk`), or `null`. Read tolerantly (`askingSince`): a dispatcher build older than the key asks nothing. */ asking: DispatcherAsk | null; waits_on: string[]; schedule: { start_at: string; unit: string } | null; cost_usd: number; paid_vendor: string | null; tokens: number; tokens_in: number; tokens_out: number; tokens_cache_read: number | null; /** How long at least one agent was out on this plan, in whole seconds (`report_runtime`): the union of its planner outings' and its stage tries' intervals — overlaps counted once, pauses and waits not at all — derived at read time, never stored. An interval still open ends at the document's own reading time, so the figure moves while an agent is out and stands still otherwise; a card ticks it between frames only while `agentsOut` says one is (`workingTime.ts`). The frame's lane compares pictures WITHOUT this key (`dispatcher-watcher.service.ts`), because it moves on every read of a live plan. `0` against a build older than the field. */ runtime_s: number; rounds: number; phases: DispatcherPhase[]; events: DispatcherEvent[] };
/** An arc's derived word, in ONE precedence (`store_arcs.arc_word`): `empty`, `complete`, `hidden`, `judging`, `stalled`, `live`, then its plans' OWN waiting word — `scheduled`, `paused`, `queued` — else `designing`. `empty` comes FIRST because an arc whose every plan was dropped has no plan row for anything below it to read; `complete` next, when every plan of it carries its completion stamp, its judgment's included (an epic created with one feature opens none, and never reads `judging`); `hidden` when EVERY open plan of it is hidden — the operator put the whole epic away, and it keeps its place out of the queue's line; `judging` while the arc's own judgment plan exists and has not finished (no stamp, and not every phase of it done), because that plan IS a plan of its arc and would otherwise read as work still being designed, queued or live; then `live` while any phase of any of its plans is walking (`phase_chain.busy`, never the status column — INV-186) or while a plan of it is approved, unpaused and unfinished and so the rule's to take up (the same set `DispatcherArc.walking` draws Pause for); then the STRONGEST waiting word its plans carry (`report.status_word`), for an arc none of whose plans is still being designed: `scheduled` with an hour armed, `paused` stopped mid-walk, else `queued` at the gate. Never a column: INV-172. */
export type DispatcherArcStatus = 'empty' | 'complete' | 'hidden' | 'judging' | 'stalled' | 'live' | 'scheduled' | 'paused' | 'queued' | 'designing';
/** An epic's place in the queue (`report_arcs.arc_dict.queue`, from `line_gate.places`): `position` is its place counted from 1, top down — the run order the operator gave In flight — and `turn` says what that place means NOW: `now` (it is running, it is the first epic not started that can start with no epic above it able to, or a plan of it was let through the queue's order by its own press or by a wait of an epic in progress), `waiting` (its turn is behind an epic above it), `paused` (the dial's Pause all is on, so no epic starts) or `hidden` (every open plan of the epic is hidden: it keeps its place and is out of the line). Never a column and never the arc's status word (INV-172): the store holds only the place the operator gave and when, and membership and turns are derived at every read (`epic_line`, `line_gate`). Where an epic is NOT in the queue — its turn is over, or it has no open plan — the arc's `queue` is `null`, never a place. */
export type DispatcherArcQueue = { position: number; turn: 'now' | 'waiting' | 'paused' | 'hidden' };
/** One arc of the store (`report_arcs.arc_dict`): its words, its own model word, its derived status and the NAMES of its plans, in `store.arc_plans` order — the arc file's order, except for a member that pre-dated its arc — which is what a reader joins against `plans[].arc` in the same document. `model` is the ARC's own word, never one plan's effective one: it is what the arc's control draws and what `dispatcher model <arc> <word>` hands to every plan of the arc. `cost_usd`, the four token keys and `runtime_s` are the epic's books: the plan cards' figures in the same document (`report.plan_dict`'s own, a phase mid-walk counted as its card counts it) cut at the moment each feature JOINED the epic — a stage counts when it launched at or after it, a feature born in the epic counts whole — so an epic that took a finished feature in after it ran does not carry that feature's past, while the feature's own card keeps it (`report_arcs._books`, INV-4299). `paid_vendor` labels those dollars over the same cut. `walking`, `stopped` and `schedule` are its own verbs' readings, taken off the same document's plan rows — so the header and `dispatcher stop|resume|schedule <arc>` can never disagree about what a press reaches. */
export type DispatcherArc = { name: string; goal: string | null; architecture: string | null; delivers: string | null; /** The epic's OWN model word (`report_arcs.arc_dict`), or `null` while it carries none and follows the house switch — never one of its plans' effective words. Pressing it hands the word to every plan of the epic (`store.set_arc_model`), and `default` clears the epic's and theirs. */ model: DispatcherModelWord | null; status: DispatcherArcStatus; /** Whether any of the arc's plans is LIVE (`report_arcs.walking` — the `live` ones): a walk is out on it, or it is approved and unpaused and so the rule's to take up when its waits are complete. This is what `dispatcher stop <arc>` acts on and the set the header draws Pause for — so Pause reaches the plans waiting their turn as well as the one in flight, and the next one cannot start the moment the walker of the one before it ends. */ walking: boolean; /** Whether any of the arc's plans is STOPPED — approved, paused and unfinished (`report_arcs.stopped`): `queued` at the gate, `paused` mid-walk, `scheduled` with an hour armed — never `hidden`, which waits for Show. It is the set a terminal's `dispatcher resume <arc>` and `dispatcher schedule <arc>` act on; the deck draws no press for the whole set (the plans held for their first Start are the board's Start's), only for `midwalk` and `stalled`. */ stopped: boolean; /** Whether any of the arc's plans is STOPPED MID-WALK (`report_arcs.midwalk`): a walk has gone out for it and it is not moving — `paused`, or `scheduled` with an hour armed after a walk. The deck draws Resume for it, beside `stalled`; a plan never launched (waiting for its first Start) is not one, so an epic whose waiting plans are all of that kind draws no Resume. */ midwalk: boolean; /** Whether any of the arc's plans is STALLED (`report_arcs.stalled`): released, with its only running work ended and nothing to record it (`report_stall`). It is what the deck draws Resume for beside `midwalk` — `dispatcher resume <arc>` takes these plans along with the stopped ones, waking the daemon — and it never replaces Pause: a stalled plan is released, so Pause still reaches it (`walking`). */ stalled: boolean; /** The ONE hour the arc's STOPPED plans are armed for, as the timer's own ISO stamp, or null (`report_arcs.hour`). Over the same set the arc's Cancel reaches — which is the set its Start reaches — whoever armed it. One stamp because one press wrote them all; null when none of them is armed, and when they were armed apart — the header then offers the press again rather than naming a time half its plans are not waiting for. */ schedule: string | null; /** How many of the arc's plans the "Accept when cut" press reaches now — `designed` and not yet armed (`report_arcs.armable`). The deck draws the press while this is above zero. */ armable: number; /** How many of the arc's plans carry an "Accept when cut" press (`report_arcs.armed`): what the deck's Cancel reaches. */ armed: number; plans: string[]; /** The one planner outing of the ARC — its design, its cut, its judgment (`report_planners.of_arc`: the newest live row whose `target` IS the arc, else its newest ending still short of a plan). A row naming one of the arc's plans is that PLAN's, and rides `plan.planner` instead, so the deck's header and a card inside it can never state one outing twice. `null` on an arc no planner is on, and against a dispatcher build older than the field. */ planner: DispatcherPlanner | null; created_at: string; completed_at: string | null; cost_usd: number; paid_vendor: string | null; tokens: number; tokens_in: number; tokens_out: number; tokens_cache_read: number | null; /** How long at least one agent was out on the epic, in whole seconds (`report_arcs.arc_dict`): the UNION of its plans' intervals and the outings whose subject is the epic itself — its design, its cut, its judge — never its plans' `runtime_s` added, because features of one epic walk at the same time. Read like `DispatcherPlan.runtime_s`: derived, ticked between frames only while an agent is out, `0` against a build older than the field. */ runtime_s: number; /** The epic's place in the queue (`report_arcs.arc_dict.queue`, from `line_gate.places`), or `null` for an epic not in it — its turn is over, or no plan of it is open — and against a dispatcher build older than the field, where nothing is drawn of a queue. Read tolerantly (`arcOf`); a key that IS there and does not read is refused by name. */ queue: DispatcherArcQueue | null };
/** One window of the pacer's picture (`route.pace.five` / `.week`), every figure a FRACTION 0..1 like the rest of the dispatcher's document: `used` the newest reading, `projected` the end of the window with the work committed so far, `ceiling` the point the pacer holds new starts under, and `resets_at` epoch SECONDS (multiply by 1000 before `new Date`). EACH FIGURE IS `null` WHEN THE PACER COULD NOT READ IT — the probe's `projected` until the account's cost is measured, a window with no reset behind it — never a reason to refuse the document: a reader that demanded a count kept the last good picture on the board through a probe (measured 2026-10-20). A projected end may stand above the ceiling, and above 1, and is drawn as it is. */
export type DispatcherPaceWindow = { used: number | null; projected: number | null; ceiling: number | null; resets_at: number | null };
/** The reading the pacer's picture was built on (`route.pace.reading`): its epoch SECONDS or `null`, its source word (`stream`, `meter`, `backfill`), whether it is fresh enough to pace on, and whether the window it names has already rolled. */
export type DispatcherPaceReading = { at: number | null; source: string; fresh: boolean; rolled: boolean };
/** The pacer's picture in the dispatcher's document (`route.pace`, interface VI), every figure a FRACTION 0..1: the account, the reading behind it, both windows or `null` when the pacer has none, `probe` while it cannot see the window, `held` how many asks this context held, `opens_at` the earliest moment one is projected to fit (epoch SECONDS) or `null`, and `words` the dispatcher's own one sentence for the board. ABSENT against a dispatcher build older than the field; `null` is the document saying it has no picture. The line draws only on a pace with words. */
export type DispatcherPace = { account: string; reading: DispatcherPaceReading; five: DispatcherPaceWindow | null; week: DispatcherPaceWindow | null; probe: boolean; held: number; opens_at: number | null; words: string };
/** This box's posture, as `report.snapshot` reads it on every call: the provider the walks take (`width.route` — the DeepSeek switch, read live, never cached). `word` is the BOX's whole posture in one phrase (`width.word()`): its route — never a `held` line's ending, which names the clause that refused (`width.reason`); one plan's own phrase is `DispatcherPlan.posture`. `park_at_peak` is the operator's third switch file; `peak_until` is when the CURRENT DeepSeek peak window ends, as an ISO stamp, or null outside one — on the Claude route the peak has no price, so it is null whatever the toggle says. `planners` is the planner lane's dial and its census (`planner_lanes.census`): `lanes` the width the operator set in `planners.flag` (default 2, floor 1), `out` how many planner outings are out against it — `out` may stand above `lanes` after the dial is lowered, since an outing already out is never stopped. Absent against a dispatcher build older than the field, where the readout is not drawn. */
export type DispatcherRoute = { provider: 'claude' | 'deepseek'; word: string; park_at_peak: boolean; peak_until: string | null; planners?: { lanes: number; out: number }; /** The pacer's picture (`route.pace`, interface VI), or `null`/absent while no picture is drawn: the master controller's pace line reads only `words`, and draws nothing without them. */ pace?: DispatcherPace | null; /** How many plans the board's one Start (`dispatcher start`) would let go now — the plans held for their FIRST Start (`first_start.held`: approved, paused, never launched, and an epic's waiting judgment), counted by the dispatcher so the button is drawn for exactly the plans its press reaches. `undefined` against a build older than the field, which draws no Start. */ waiting?: number; /** The EPIC QUEUE's census (`route.epics`, `line_gate.census`): `paused` whether Pause all is on (no epic starts; an outing already out finishes), and `running` how many epics of the queue have STARTED. The queue runs top down; no limit is drawn. `null` against a dispatcher build older than the field, where the controls are not drawn (the key is absent: another build talking, never a torn document); a key that IS there and does not read is refused by name — `paused` not a flag, `running` not a whole count. */ epics: { paused: boolean; running: number } | null };
/** This home's daemon. `alive` is the LOCK, not the file: the daemon takes a blocking exclusive flock on `<home>/daemon.lock` before anything else, so an exclusive flock taken by a reader answers without blocking — refused means somebody holds it, and that somebody is the daemon. `pid` and `unit` are therefore only reported on the alive branch: a lock file nobody holds is a dead daemon's, whatever pid it still names, and the unit comes from `/proc/<pid>/cgroup` — the kernel's answer, the one thing the daemon's four-name environment cannot have been handed. */
export type DispatcherDaemon = { alive: boolean; pid: number | null; unit: string | null };
/** The whole picture, pushed on change over `/ws` by the dispatcher lane. It is the document's own keys — `plans`, `arcs`, `planners`, `route`, `daemon`, `offpeak_at`, `home`, `generated_at` — with the frame's clock added as `at`, epoch MILLISECONDS (`Date.now()`), unlike every time inside. `offpeak_at` is always a stamp — the next DeepSeek off-peak moment, and the literal `none` when the clock cannot answer — so it is a string and never null. */
export type DispatcherStateEvent = { kind: 'dispatcher_state'; arcs: DispatcherArc[]; plans: DispatcherPlan[]; planners: DispatcherPlanner[]; route: DispatcherRoute; daemon: DispatcherDaemon; offpeak_at: string; home: string; generated_at: string; at: number };
/** The verbs this server may relay: `stop`, `resume`, `schedule` (a stopped plan's Resume at a time — `offpeak`, an ISO timestamp, or `none` to clear), `park` (a designed plan set aside), `unpark` (handed back to be cut), `model` (a plan's or an arc's own DeepSeek / Claude word; restarts nothing and wakes nobody — the word is read when a chain is launched), `drop` (a plan taken out of the store with everything it holds of it — refused while a phase of it walks or a planner outing for it or its arc is live; the one verb no press undoes), `planner-resume` (a plan's stalled planner outing put back to work through the verb the house already has for it — `cut`, `judge`, or a `tell` of `continue` — read fresh off the store at the press; refused when nothing of the plan ended short), `arm-accept` / `disarm-accept` (the operator's "Accept when cut" on a designed plan — or on every designed plan of an arc — and its Cancel; the press carries `--by app:card` and, on a plan, the design stamp it read), `queue` (an epic moved in the queue — `--before` another epic, `--last`, or `--at` a place; an epic's verb alone, relayed only through `POST /arcs/:name/queue`), `epics` (the epic dial's word — `pause` or `resume`; a BOARD verb that names no plan or arc, relayed only through `POST /epics`, so its answer carries `plan: ""`) `start` (the board's one Start — every plan held for its first Start let go at once, the queue and the dial then ordering them; a BOARD verb too, relayed only through `POST /start`, answered with `plan: ""`), `hide` (plans, or an epic's open plans, paused and held out of the queue until shown — relayed only through `POST /hide`) and `unhide` (Show: the hidden plans take their turn in the queue — relayed only through `POST /unhide`); both take plan or epic names in the request body, and their answers carry `plan: ""`. Beside them stands `override` (the operator's lift of the usage pacer's hold for ONE plan, and nothing else — the card's `Override`, and `Turn off` with `--off`; both carry `--by app:card`, and the dispatcher refuses the lift inside a Claude session, which this server's relay never is). */
export type DispatcherVerb = 'stop' | 'resume' | 'schedule' | 'park' | 'unpark' | 'model' | 'drop' | 'planner-resume' | 'arm-accept' | 'disarm-accept' | 'queue' | 'epics' | 'start' | 'hide' | 'unhide' | 'override';
/** What one relayed verb did. A refusal is a RESULT, not an error: the dispatcher prints its refusals on STDOUT (`REFUSED <verb> <name>: <reason>`, exit 2 — `REFUSED epics '<word>': <reason>` for the board's `epics`, which names no plan and whose answer carries `plan: ""`; a not-found line, exit 1 — `no plan <bare>`, or `no plan or arc <bare>` from one of the six verbs an arc's own name also reaches), so `stdout` carries the dispatcher's own first line whole and the reader never gets our paraphrase. `reason` is present only when the dispatcher never got to answer: it timed out, or its binary could not be spawned. */
export type DispatcherVerbResult = { ok: boolean; verb: DispatcherVerb; plan: string; exit: number | null; stdout: string; stderr: string; reason?: 'timeout' | 'spawn-failed' };
/** A plan's or an arc's OWN model word, as the store records it: `deepseek` or `claude`. A row that carries none is `null` everywhere this word is read, and follows its epic and then the HOUSE switch (`deepseek_flash.flag`). The two words have ONE home, `hooks/plan_runner/run_model.py:WORDS`, unpacked by `hooks/dispatcher/model.py` rather than re-spelled. */
export type DispatcherModelWord = 'deepseek' | 'claude';
/** What the model control sends through `POST /plans/:name/model` and `POST /arcs/:name/model`: a `DispatcherModelWord`, or `default` — no word of its own, follow the top (the dispatcher clears the row). The server checks a request against exactly these three (`readDispatcherModelChoice`) before anything is spawned, so the argv word is always ours. */
export type DispatcherModelChoice = DispatcherModelWord | 'default';
/** `GET /plans/offpeak`: the dispatcher's next DeepSeek off-peak moment in epoch SECONDS (`dispatcher offpeak`, derived from `deepseek.PEAK_UTC`), or `null` when the dispatcher could not answer. The card's `Start at …` button shows it in the reader's clock and never computes it. */
export type DispatcherOffpeak = { at: number | null };

// ---------------------------
//----------------- DISPATCHER ANSWERS: how the dispatcher took an operator's answer ------------

/**
 * What the dispatcher did with ONE operator answer carried to it (`carryReply`): `took` — every verb
 * the answer ran exited 0; `already-answered` — the Accept reached a plan the store had approved
 * already (`dispatcher accept` exit 3), so the answer changed nothing and the plan's own approval
 * stands; `refused` — a verb refused, failed or never answered (a stale lock, a plan no longer
 * loaded, a timeout). Consumed by the answer service (which derives it from the verbs' exit codes)
 * and the asks service (which keeps a `took` or `already-answered` prompt down and puts a `refused`
 * one back). It is `DispatcherCardAnswer`'s first three outcomes: the card's door answers this word
 * itself when the dispatcher heard the answer, and its own when it never reached it.
 */
export type DispatcherAnswerOutcome = 'took' | 'already-answered' | 'refused';

/** The card's answer door's reply (`POST /api/dispatcher/answer`). `took`, `already-answered`, `refused`: what the dispatcher did (`carryReply`). `not-open`: no open ask carries the name the card's ask derives — answered, re-cut, changed since it was drawn, or already being carried. `no-answer`: the decision names no offered option, or a Rework carries no notes. `unread`: the store could not be read to find the ask. */
export type DispatcherCardAnswer = {
  outcome: 'took' | 'already-answered' | 'refused' | 'not-open' | 'no-answer' | 'unread';
  /** The one line the card toasts: the dispatcher's own first line when it heard the answer, else the lane's sentence for why it never reached it — the field every relayed verb's sentence travels in. */
  stdout: string;
};

// ---------------------------
/**
 * How a launcher soul is going while it is out, and how it ended once its receipt landed.
 *
 * `stopped` is a cap, not a fault — the wrapper's own hour or its idle bound ended the child — and
 * it is kept apart from `failed` for the same reason the pinned agents keep them apart: the
 * reader's next move differs. These are the pinned strip's own words, one lane down the app.
 */
export type SoulLaunchState = 'running' | 'completed' | 'failed' | 'stopped';
/**
 * One launcher soul — a soul a session started by hand through `plan-runner soul` — as its pin draws it.
 *
 * `provider` is the one the pin PAINTS, and it is settled the way a bill is: `result.json`'s word
 * once that landed, and `spec.json`'s pin before then, because that is the only reading there is.
 * `blocked` marks a launch DeepSeek refused or never answered: it did no work, and the launcher
 * never re-routes a soul to Claude.
 *
 * `launched_by` is the CLI session id the launcher stamped into `spec.json` from its own
 * `CLAUDE_CODE_SESSION_ID` at the moment it minted the launch — ownership recorded by the process
 * that made the launch, never read off a transcript. A chain's stages are minted later by the
 * detached walker and carry the stamp of the chat that launched the chain. `null` when the spec
 * names no launcher (a launch from a bare terminal, or one older than the stamp). A client anchors a
 * launch to a chat only on an EXACT match between this and that chat's CLI session id.
 *
 * Every timestamp is epoch SECONDS, which is what the launcher's Python wrote with `time.time()`.
 * `cost_usd`, `tokens`, `tokens_in`/`tokens_out` and `duration_s` are `null` until the receipt lands: a
 * live soul's spend is not knowable from here, and a zero would read as "free" rather than as "not yet".
 *
 * AND ONE HALF OR THE OTHER, NEVER BOTH (operator rule, 2026-09-24): `cost_usd` is PAID dollars — a soul
 * on the operator's Claude subscription reads `0` there — and `tokens*` are THE SUBSCRIPTION'S, `null`
 * throughout on a soul a vendor billed, whose tokens are that vendor's own business. So the pin draws
 * `$0.28 DeepSeek` with no tokens or `1.2M in · 48k out` with no `$`.
 */
export type SoulLaunchSnapshot = { launch_id: string; launched_by: string | null; dispatcher_work: boolean; role: string; agent: string; brief: string; provider: 'deepseek' | 'claude'; blocked: boolean; state: SoulLaunchState; status: string; cause: string; started_at: number; ended_at: number | null; duration_s: number | null; cost_usd: number | null; tokens: number | null; tokens_in: number | null; tokens_out: number | null };
/** The whole picture, pushed on change over `/ws`. `launches` is ordered by `started_at` ascending, oldest first. `at` is epoch MILLISECONDS (`Date.now()`), unlike every field inside a snapshot. */
export type SoulLaunchStateEvent = { kind: 'soul_launch_state'; launches: SoulLaunchSnapshot[]; at: number };
// ---------------------------
//----------------- KANBAN METIS: the session a board launches ------------

/**
 * One Metis session — a board's own autonomous builder, spawned detached by
 * `modules/kanban-metis` and watched after every server restart.
 *
 * `sessionId` is the uuid handed to `claude --session-id`, and it is the identity everywhere:
 * the state directory under `~/.claude/state/kanban-metis/`, the address of every route, the
 * transcript lookup, and the input to the derived lease owner. The board MINTS it, which is why
 * no launch-id-to-session-id translation exists anywhere on this path.
 *
 * `owner` is the lease owner every build-lease verb compares against — `sha256(sessionId)`
 * truncated to sixteen lowercase hex, DERIVED rather than minted, so a resumed or re-adopted
 * session comes back as the same owner and can still refresh the leases it holds.
 *
 * `model` is the `--model` flag the child was actually given (`deepseek-flash`, or the Claude word
 * the launch table gives Metis) and `provider` says which endpoint it bills; the pair is settled at
 * spawn from the board's own `deepseekFlash`, never re-derived here, because the switch applies at
 * the NEXT spawn.
 *
 * `lastActivityAt` is `child.log`'s mtime, not a heartbeat the child writes: the child is
 * detached and owns its own log file descriptor, so its log's stamp is the only liveness signal
 * that survives a server restart. `pid` is a fact to show and, for a live session, to signal.
 * Every timestamp is epoch MILLISECONDS.
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

/** The whole picture, pushed on change over `/ws`. `sessions` is ordered by `startedAt` ascending, oldest first. `at` is epoch MILLISECONDS (`Date.now()`), unlike every field inside a session. */
export type KanbanMetisStateEvent = { kind: 'kanban_metis_state'; sessions: KanbanMetisSession[]; at: number };
// ---------------------------
//----------------- UNIVERSE: the estate map and its live activity ------------
/**
 * One node of the estate map — a star (a tracked file), a body (a directory), a galaxy (a repo),
 * the sun (`core`), or an endpoint (a Postgres database or an MCP server).
 *
 * The keys are the crawler's own short ones and the numbers are the crawler's own, carried through
 * untouched: `l`, `t` and `c` come off the git history, and `p` is an index into the map's `nodes`
 * array, assigned by the one process that wrote them. Nothing downstream recomputes an index — a
 * second assignment rule is a second answer to the same question.
 */
export type UniverseNode = {
  /** Basename only — the path a node sits at is the chain of `p` links above it. */
  n: string;
  /** Parent node index, `-1` for a node that hangs off nothing: a repo, the sun, an endpoint. */
  p: number;
  /** `system` is a directory the crawler's `systems.json` names as an integration folder — one
   *  per outside system the repo talks to — a body like `dir` in every way but the mark. */
  k: 'galaxy' | 'core' | 'dir' | 'endpoint' | 'system' | 'source' | 'config' | 'docs' | 'data-sql' | 'assets' | 'other';
  /** Lines of the file; `0` for a directory or an endpoint, which have no length. */
  l: number;
  /** Epoch SECONDS of the newest commit touching it, from the same `git log` the map was built on. */
  t: number;
  /** Commits touching it — churn, the number that says whether a file is alive or a fossil. */
  c: number;
};

/**
 * The whole estate as one payload: every repo the registry covers, flattened into one node list
 * with every index already global.
 *
 * This is `merged.json` exactly as the crawler wrote it, and it is the only thing the fork reads —
 * the per-repo files beside it are the crawler's own working form. `mapId` is the first 12 hex of
 * the four repo HEAD shas joined by a newline, so it changes when, and only when, a repo's HEAD
 * moves: a client holding a different one refetches, and that is the entire invalidation rule.
 *
 * `resolve` is shipped as DATA rather than restated as code: a consumer takes the FIRST entry its
 * path starts with, and never re-sorts. The entries are ordered longest path first because the
 * ordering IS the rule — without it `/home/me/.claude` swallows the repo inside it.
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
  /** Logger name -> the node of the file that logs under it. */
  loggers: Record<string, number>;
  /** Table name -> the node of the file that touches it. */
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
 * One row of the estate's live activity: what happened, where, and how much of it since the last
 * frame. Rows are aggregated before they are sent — the raw stream is an edit per keystroke and an
 * execution per log line, and the wire carries neither.
 */
export type UniverseActivityRow = {
  /** Node index into the map; `-1` when nothing resolved. */
  node: number;
  kind: 'edit' | 'exec';
  /** Raw events this row aggregates since the last frame. */
  count: number;
  /** Epoch MILLISECONDS of the newest raw event in this row. */
  at: number;
  /** A systemd unit name, or `'session'`. */
  source: string;
  /** The Claude session id, when `source === 'session'`. */
  session?: string;
};
/**
 * One raw row as a tap pushes it, before the coalescer counts it: the coalescer's `push` input, and
 * therefore what `universe-journal.tap.ts` and `universe-transcript.tap.ts` produce. Named because
 * the one shape crosses three files — the two readers and the throttle between them.
 */
export type UniverseActivityInput = Omit<UniverseActivityRow, 'count'>;

/**
 * The activity digest, broadcast over `/ws`. `at` is epoch MILLISECONDS (`Date.now()`), unlike the
 * epoch-second timestamps on the map.
 *
 * Every frame carries the `mapId` its node indices belong to, so a client holding a different one
 * refetches the map and drops the in-flight rows rather than pointing them at the wrong stars.
 * `dropped` counts rows discarded for volume, so a busy window is visibly lossy instead of quietly
 * incomplete.
 */
export type UniverseActivityEvent = {
  kind: 'universe_activity'; mapId: string; rows: UniverseActivityRow[]; dropped: number; at: number;
};
/**
 * The announcement that a crawl landed: a new map is on disk, and the `mapId` in the frame is the
 * one a client should compare against the map it holds. Sent only when a repo's HEAD moved — a
 * crawl that changed nothing puts nothing on the wire.
 */
export type UniverseMapEvent = { kind: 'universe_map'; mapId: string; builtAt: number; at: number };

/**
 * One uvicorn app living in a registered repo, as `repos.json` declares it.
 *
 * `unit` is the pairing the journal tap needs: a systemd unit's HTTP access lines are routed to the
 * routes of the app served BY that unit, which is how a request to `web-app.service` pulses a star
 * in `backend-repo` — the two apps in that repo listen on two different units.
 */
export type UniverseRegistryApp = {
  name: string;
  /** The ASGI target, e.g. `backend.main:app`. */
  module: string;
  python: string;
  cwd: string;
  unit: string;
};

/**
 * One repo as `repos.json` declares it — the registry, and the only thing "deploying a project to
 * the universe" means (`scripts/universe/registry.py`). Adding a repo is one entry here and nothing
 * written into the repo itself, ever.
 *
 * The crawler WRITES this file, so the reader tolerates it: a hand-edited entry missing a field
 * follows nothing rather than failing, and every list below is normalized to `[]` instead of being
 * trusted. `role` is `sun` for the root project and `galaxy` for every other repo — a label for the
 * map's own use, not a behaviour switch.
 */
export type UniverseRegistryEntry = {
  id: string;
  /** Absolute path to the repo root — the key of the prefix rule `resolve` ships. */
  path: string;
  role: 'sun' | 'galaxy';
  /** systemd units whose journal lines belong to this repo. */
  units: string[];
  /** Repo-relative path of the star a journal line pulses when nothing else about it resolves. */
  entry_file: string;
  apps: UniverseRegistryApp[];
  /** Postgres endpoint names, e.g. `eis` -> node `pg:eis`. */
  pg: string[];
  /** MCP server names, e.g. `archpulse` -> node `mcp:archpulse`. */
  mcp: string[];
};
// ---------------------------

/**
 * Provider-neutral message envelope used in REST responses and realtime channels.
 *
 * Every provider-specific message must be converted into this shape before being
 * emitted outside provider-specific modules.
 */
export type NormalizedMessage = {
  id: string;
  /**
   * The provider's own identifier for the transcript row this message came
   * from, when the provider has stable per-row identity (today: Claude's
   * `uuid`). It is what "edit this message" and "fork from here" address, so it
   * has to survive a reload — never a value this app synthesized.
   */
  transcriptAnchorId?: string;
  sessionId: string;
  timestamp: string;
  provider: LLMProvider;
  kind: MessageKind;
  /**
   * Monotonic per-run sequence number assigned by the chat run registry when a
   * live event is forwarded to the websocket. History messages loaded over
   * REST do not carry it. Clients use it with `chat.subscribe` to replay only
   * the live events they missed across websocket reconnects.
   */
  seq?: number;
  role?: 'user' | 'assistant';
  content?: string;
  /**
   * The model id that produced this assistant turn, when the provider records one
   * per row (today: Claude). A conversation can change model mid-way, so this
   * belongs to the turn and not to the session. Mirrored, with this same comment,
   * on the client's own NormalizedMessage in src/shared/types.ts.
   */
  model?: string;
  /**
   * Optional display-oriented metadata used by providers that need to expose
   * richer transcript artifacts without introducing a brand-new message kind.
   *
   * Current Claude usage:
   * - local slash commands expose parsed command fields
   * - compact summaries are flagged so the UI can treat them differently later
   */
  displayText?: string;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  isLocalCommand?: boolean;
  isLocalCommandStdout?: boolean;
  isCompactSummary?: boolean;
  images?: unknown;
  /** Non-image files attached to a user turn after provider history normalization. */
  files?: unknown;
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;
  toolResult?: {
    content?: string;
    /** Pictures the tool returned (a Read of an image), drawn by the transcript under the call: an inline data URL on a live frame, the `path` of a stored chat asset in a loaded history. */
    images?: Array<{ data?: string; path?: string }>;
    isError?: boolean;
    toolUseResult?: unknown;
    /** When the result landed — for an agent, when it finished. Absent when the transcript does not say. */
    timestamp?: string;
  };
  isError?: boolean;
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  requestId?: string;
  input?: unknown;
  context?: unknown;
  reason?: string;
  newSessionId?: string;
  status?: string;
  summary?: string;
  tokenBudget?: unknown;
  /**
   * What this assistant row's request cost, reduced to the two figures a subagent's row is
   * read by (see `SubagentUsage`). Every row cut from one API message carries the same
   * `usageMessageId`, and a streamed message reaches the transcript as several records whose
   * `outputTokens` grows — so a reader keeps the LAST value per id, never a sum of rows.
   * Absent when the provider reports no usage, or an all-zero one (Claude's synthetic rows).
   */
  usage?: { contextTokens: number; outputTokens: number };
  usageMessageId?: string;
  /**
   * Timeline of everything a subagent did, attached to the `tool_use` that
   * spawned it. Present for Claude `Agent`/`Task` calls and Codex
   * `spawn_agent` calls; absent for every other tool.
   */
  subagentTools?: SubagentActivity[];
  /** Identity and lifecycle of the subagent this `tool_use` spawned. */
  subagent?: SubagentInfo;
  /** Stored memory the reply drew on, when the provider reports it. */
  memoryCitations?: MemoryCitation[];
  /**
   * What a custom compaction did, on the one `compaction` row it leaves in a chat's history and
   * live stream. Present only when `kind` is `compaction`. Mirrored on the client's own
   * NormalizedMessage in src/shared/types.ts.
   */
  compaction?: ChatCompactionMarker;
  toolUseResult?: unknown;
  sequence?: number;
  rowid?: number;
  [key: string]: unknown;
};

/**
 * One stored memory an assistant reply drew on.
 *
 * Codex appends these to a reply that used its memory files, naming the file
 * and line range it read plus a short note on what it took from there. The
 * transcript shows them as a footnote so a memory-derived claim is traceable
 * rather than arriving as an unattributed assertion.
 */
export type MemoryCitation = {
  /** File and line range that was read, e.g. `MEMORY.md:137-142`. */
  source: string;
  /** What the reply took from that range, when the provider states it. */
  note?: string;
};

/**
 * One entry in a subagent's recorded timeline.
 *
 * Providers store a subagent's work in a separate transcript (Claude:
 * `<session>/subagents/agent-<id>.jsonl`; Codex: a sibling rollout keyed by
 * `agent_thread_id`). Both are flattened into this shape so the transcript can
 * replay a subagent's run with the same renderers the main thread uses.
 *
 * `kind` decides which fields matter: `tool` uses the tool fields, `text` and
 * `thinking` use `content`. Consumers must not assume tool fields exist on the
 * text kinds.
 */
export type SubagentActivity = {
  kind: 'tool' | 'text' | 'thinking';
  timestamp?: string;
  /** Tool-call identity; only set when `kind` is `tool`. */
  toolId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: { content?: string; isError?: boolean } | null;
  /** Message body; only set when `kind` is `text` or `thinking`. */
  content?: string;
};

/**
 * Identity and lifecycle of one spawned subagent, normalized across providers.
 *
 * `status` is `running` until the call that spawned the agent resolves. After
 * that it is whatever the provider reported — Claude's task notification
 * carries one — and `completed` when the provider reported nothing. A failed
 * tool call *inside* the agent is not a failed agent, so it is never inferred
 * from the transcript.
 */
export type SubagentInfo = {
  /** Provider-native agent id — Claude `agentId`, Codex `agent_thread_id`. */
  id: string;
  /** Human-facing label: Claude's agent type, or Codex's assigned nickname. */
  name?: string;
  /** Agent type/preset when the provider records one (Claude `agentType`). */
  type?: string;
  /** One-line task summary shown in the collapsed header. */
  description?: string;
  /** `stopped` is the reader's own Stop, an interrupt or a teardown — not a failure. */
  status: 'running' | 'completed' | 'failed' | 'stopped';
  /** Model the subagent ran on, when the provider records it. */
  model?: string;
  /**
   * How many activities the agent actually recorded. It exceeds
   * `subagentTools.length` when a long run was truncated for transport, which
   * lets the UI say so instead of silently showing a partial timeline.
   */
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
 * A subagent's token reading, in the two figures that describe a run.
 *
 * `contextTokens` is the agent's context window as of its LATEST request — input, cache
 * creation, cache read and reply of that one request, summed. It is the number Claude Code
 * itself calls the agent's tokens (`totalTokens` on the `Agent` tool's result; equal on every
 * real result measured 2026-09-10), so the two never disagree. It is not a running total
 * across requests: that sum re-bills the same cached prompt every turn and reads ten times
 * the window for a long run.
 *
 * `outputTokens` is everything the agent wrote, summed over its requests — the work it has
 * actually done, which the context figure alone hides behind a large read-in prompt.
 * `requests` counts the API messages behind both figures.
 */
export type SubagentUsage = {
  contextTokens: number;
  outputTokens: number;
  requests: number;
};

/**
 * Output gateway shared by WebSocket and SSE provider runs.
 *
 * Runtime adapters only depend on this structural surface, which keeps them
 * independent from the transport that ultimately delivers normalized events.
 */
export type ProviderRuntimeWriter = {
  send(data: unknown): void;
  setSessionId?(sessionId: string): void;
  userId?: string | number | null;
  isWebSocketWriter?: boolean;
  isSSEStreamWriter?: boolean;
};

export type ProviderPermissionDecision = {
  allow: boolean;
  updatedInput?: unknown;
  message?: string;
  rememberEntry?: unknown;
};

/**
 * A pending approval as the STORE that holds it says it is now — what the phone's tap registry needs
 * to answer a button whose push a process now gone sent (`ProviderRuntimePermissionGateway.recall`):
 * the session the prompt belongs to — `null` when this app knows of none, as for a plan raised with
 * no chat — the tool it stands for and the input its options are read from.
 * Consumed by the dispatcher lane (which produces it), the provider runtime service (which asks every
 * gateway for it) and the ntfy act route (which registers it before spending the tap's token).
 */
export type ProviderRuntimeRecalledPrompt = { sessionId: string | null; toolName: string; input: unknown };

export type ProviderRuntimePermissionGateway = {
  /**
   * Settles the approval a decision belongs to, answering whether this gateway HELD it.
   *
   * `approvalKey` is the name the door that heard the answer gave the approval: an ask's own
   * `promptKey` when the answer came from a phone — a push outlives the process that sent it, so a
   * tap names the ask itself and not a handle some process minted — or whatever a runtime registers
   * its own approvals under for the chat that shows them. The gateways are asked in turn and the
   * FIRST to claim the key settles it (`providerRuntimeService.resolveToolApproval` stops there), so
   * a key a gateway does not hold is answered `false` in silence, and the service speaks once for a
   * key nobody claimed.
   *
   * A gateway whose asks live in a STORE claims every key of its own and settles it from the store
   * (the dispatcher's plan prompts): the process that hears an answer is not always the one that
   * raised the ask, so "this process has not registered it" is not "unknown".
   */
  resolve(approvalKey: string, decision: ProviderPermissionDecision): boolean;
  /**
   * OPTIONAL — only a gateway whose asks live in a store has one. Answers what the prompt named by
   * `approvalKey` is, read from that store now, or `null` when no open ask carries the name. Asked by
   * the phone's act route when a tap names a prompt this process never registered buttons for (it did
   * not send the push, and has not yet raised the prompt); it never throws.
   */
  recall?(approvalKey: string): Promise<ProviderRuntimeRecalledPrompt | null>;
  /**
   * OPTIONAL — ABSENT on a gateway whose asks are pending in NO CHAT: the dispatcher's, whose asks are
   * answered on the plan's card in the Roadmap tab's In flight face and in the Runs widget and on the phone, and are
   * listed for no chat at all. What that gateway's approvals in this session are right now, for the
   * chat that shows them.
   */
  listPending?(sessionId: string): unknown[];
  /**
   * OPTIONAL — the same absence as `listPending`. Every session with an approval waiting right now,
   * whether or not it still has a run.
   *
   * Beside `listPending` rather than derived from it, because the gateway that holds the approvals
   * is the only party that can enumerate them: a prompt outlives the run that raised it (a
   * backgrounded agent's continuation turn, a re-adopted host), so a caller holding a list of runs
   * cannot ask this question session by session. Read by `sessionsService
   * .listAwaitingInputSessionIds` for the sidebar's yellow dot.
   */
  listPendingSessions?(): string[];
};

// ---------------------------
//----------------- CUSTOM COMPACTION: the runtime's seams to a compaction it never imports ------------
// The Claude runtime learns everything about custom compaction through its context
// (`ProviderRuntimeContext.compaction`), the same seam it already uses for every other lookup the
// app answers for it. It imports nothing from the compaction module; that module registers the
// hooks (`providerRuntimeService.useChatCompaction`) and reads a process's activity back
// (`providerRuntimeService.activity`).

/**
 * What one chat's CLI process is doing right now, as the runtime sees it. `live` is whether a
 * process for the chat exists at all; `busy` is whether it must not be replaced yet — a turn
 * pending or in flight, or background work (tasks, watchers, deferred calls) still outstanding —
 * and `why` names which, in a sentence a status line can quote after "waits until"
 * ("a turn is in flight", "a turn is about to start" — a finished background task's follow-up,
 * "2 background tasks are running", "1 background call has not reported"). `why` is null whenever
 * `busy` is false. A chat with no process is
 * `{ live: false, busy: false, why: null }`: nothing to wait for.
 * Produced by the Claude runtime (`claude-compaction-seams.ts`) and the runtime service's
 * not-live default; consumed by the compaction module's guard and its triggers.
 */
export type ChatProcessActivity = { live: boolean; busy: boolean; why: string | null };

/**
 * What the runtime reports to the compaction when a process's `result` lands, after the turn's own
 * `complete` has gone out (so a hook can never delay or break the reply). `contextTokens` is the
 * context of the turn's last MAIN-THREAD request — input plus both caches plus output — and `null`
 * when the turn made none; `contextWindow` is the window of the model that request ran on, read off
 * the result's `modelUsage`, `null` when no entry names that model. `sendOptions` are the turn's own
 * send options without anything one turn carries (`attachments`, `images`, `files`, `transcriptAppend`,
 * `resumeFromScratch`, `resumeAnchorId`, `compactionSeed`, `compactionTrigger`, and `keepalive`, a
 * re-adopted run's descriptor), so a compaction started from a report sends its seed append at the
 * chat's own model, effort, permission mode and tools. A re-adopted run carries none of those until a
 * message joins it, so they are read from the launch profile the host recorded; a host with no record
 * leaves the options bare. `answered` is whether a client turn was waiting on this result (false for a background
 * follow-up turn); `aborted` whether the turn was a Stop's; `seed` whether it was a compaction's
 * own seed append. `activity` is the process's activity at that moment.
 * Produced by the Claude runtime's loop; consumed by the compaction module's triggers. A report the
 * runtime hands over for a turn it did not see end (`ChatCompactionHooks.turnRestored`) is read off the
 * host's journal by the same extractor: `answered`, `aborted` and `seed` are false there, and
 * `activity` is the adopted process's as it stands.
 */
export type ChatTurnReport = {
  appSessionId: string;
  userId: string | number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  sendOptions: AnyRecord;
  answered: boolean;
  aborted: boolean;
  seed: boolean;
  activity: ChatProcessActivity;
};

/**
 * The four questions a runtime asks of a custom compaction, answered by whoever registered them
 * (`providerRuntimeService.useChatCompaction`; the default answers `takesOver` false and does
 * nothing for the other three). `takesOver` is asked each time a message resolves launch options — twice for a message that replaces the process, once to plan the respawn and once to launch:
 * `appSessionId` is null for a run with no chat behind it (the git and agent one-shots); a chat is
 * taken over wherever its CLI runs, on this machine or on a co-located Cerberus node. `turnEnded`, `turnRestored` and
 * `activityChanged` are fire-and-forget notifications; the runtime wraps every call, so a hook that
 * throws is logged and the turn goes on. `turnRestored` is `turnEnded` for a turn the server did not
 * see end: a server that adopts a live host whose last turn was complete reads that turn's end off the
 * host's journal and hands it over, with the moment (`endedAt`, epoch ms) it ended and how many times
 * the idle check has already started a compaction for it (`idleTries`, from the host's meta, 0 for
 * none), so the idle deadline the restart dropped can be armed again within its bound. A host on a node is
 * reported too: its warden lists the turn its journal records.
 * Consumed by the Claude runtime through `ProviderRuntimeContext.compaction`.
 */
export type ChatCompactionHooks = {
  takesOver(input: { appSessionId: string | null }): Promise<boolean>;
  turnEnded(report: ChatTurnReport): void;
  turnRestored(report: ChatTurnReport, endedAt: number, idleTries: number): void;
  activityChanged(appSessionId: string, activity: ChatProcessActivity): void;
};

/**
 * The idle compaction check a chat's session host remembers for the chat's last turn end: `at` is when the
 * check last STARTED a compaction (epoch ms) and `tries` how many starts that turn end has had, a failed or
 * refused one counting as the limit. The compaction module writes it through the host's own `note` (the
 * runtime's `markIdleCheck`) and a restart reads it back out of the host's meta, so a turn end's idle check
 * is bounded across restarts instead of repeating at every boot. The host's meta is the one record of it. It describes only
 * the turn end it followed: a record older than the host's last `result` belongs to an earlier turn end and counts for nothing.
 * Produced by the compaction module through the Claude runtime; carried by the host meta, `LiveHost`,
 * `KeepaliveReattach` and `TurnBits`, and read by the compaction module's restore (`planIdleRestore`).
 */
export type IdleCheck = { at: number; tries: number };

// ---------------------------
//----------------- PROVIDER RUNTIME CONTEXT ------------
/**
 * Provider-scoped application capabilities supplied to a runtime for one run.
 *
 * Keeping these lookups outside concrete SDK/CLI adapters prevents the
 * adapters from importing services that resolve back through providerRegistry.
 */
export type ProviderRuntimeContext = {
  resolveProviderSessionId(sessionId: string | null | undefined): string | null;
  resolveResumeModel(
    sessionId: string | undefined,
    requestedModel?: string | null,
  ): Promise<string | undefined>;
  getProviderModels(): Promise<ProviderModelsDefinition>;
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  isProviderInstalled(): Promise<boolean>;
  /** Custom compaction's three hooks; always present, and inert until something registers them. */
  compaction: ChatCompactionHooks;
  /** Tool sets' one hook; always present, and inert until the toolsets module registers it. */
  toolsets: ChatToolsetHooks;
};

export type ProviderRunFunction = (
  command: string,
  options: AnyRecord,
  writer: ProviderRuntimeWriter,
) => Promise<unknown>;

/**
 * Shared options used to fetch historical provider messages.
 *
 * Consumers should pass provider-specific lookup hints (`projectPath`) only
 * when the selected provider requires them.
 *
 * `providerSessionId` is the provider-native session id from the sessions
 * index (transcript file name / provider database key). Provider adapters
 * must use it — never the app-facing session id they were called with — when
 * matching transcript rows on disk, because app-created sessions use an
 * app-allocated id that the provider has never seen.
 */
export type FetchHistoryOptions = {
  projectPath?: string;
  limit?: number | null;
  offset?: number;
  providerSessionId?: string;
};

/**
 * Standardized response payload returned from provider history readers.
 *
 * Use this as the contract for APIs that return paginated conversation history.
 */
export type FetchHistoryResult = {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number | null;
  tokenUsage?: unknown;
  /**
   * The conversation's running and recently finished agents, from the WHOLE history whatever
   * page was asked for — compact container rows for the pinned strip
   * (`collectSessionAgents`). Only on a latest page (offset 0).
   */
  agents?: NormalizedMessage[];
  /**
   * The launcher souls this conversation STARTED, from the WHOLE history whatever page was asked
   * for (`collectSessionSoulLaunches`), as launch ids the pinned strip joins against the
   * dispatch-souls lane. Only on a latest page (offset 0). An empty list is a real answer — this
   * history started no soul — and never a missing one.
   */
  soulLaunches?: string[];
};

// ---------------------------
//----------------- PROVIDER SKILL TYPES ------------
/**
 * Scope where a provider skill definition was discovered.
 *
 * Provider skill adapters should use this to describe the origin of each
 * skill markdown file without leaking provider-specific folder names into route
 * contracts. `repo` is used for Codex repository lookup locations, while
 * `project` is used for providers that treat workspace-local skills as project
 * scoped.
 */
export type ProviderSkillScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/**
 * Shared input accepted by provider skill listing operations.
 *
 * Routes pass `workspacePath` when a caller wants project/repository skills for
 * a specific folder. Providers should fall back to the backend process cwd when
 * this option is omitted.
 */
export type ProviderSkillListOptions = {
  workspacePath?: string;
};

/**
 * One supporting file bundled with an uploaded provider skill.
 *
 * `relativePath` is resolved below the installed skill directory and must never
 * be absolute or contain traversal segments. Text files may use `utf8`; binary
 * scripts and assets should use `base64` so JSON transport does not corrupt
 * their bytes.
 */
export type ProviderSkillCreateFile = {
  relativePath: string;
  content: string;
  encoding: 'utf8' | 'base64';
};

/**
 * One skill markdown payload submitted for provider-managed installation.
 *
 * `content` is the raw markdown body that will be written to `SKILL.md`.
 * `directoryName` lets callers control the target folder name explicitly when
 * they want stable filesystem paths that differ from the markdown front matter
 * `name` field. `fileName` is optional upload metadata used only as a final
 * fallback when no directory name or front matter name is present. `files`
 * carries scripts, references, and other files from a complete skill folder.
 */
export type ProviderSkillCreateEntry = {
  content: string;
  directoryName?: string;
  fileName?: string;
  files?: ProviderSkillCreateFile[];
};

/**
 * Shared input accepted by provider skill creation operations.
 *
 * The service layer batches multiple skill definitions in one request. Each
 * entry can contain only markdown or a complete skill folder.
 */
export type ProviderSkillCreateInput = {
  entries: ProviderSkillCreateEntry[];
};

export type ProviderSkillRemoveInput = {
  directoryName: string;
};

/**
 * Normalized skill record returned by provider skill adapters.
 *
 * The `command` value is the exact invocation text the selected provider expects
 * for this skill. Claude plugin skills use a namespaced command such as
 * `/plugin-name:skill-name`, while Codex skills use the `$skill-name` form.
 * `sourcePath` points to the skill markdown file that produced the record so
 * callers can distinguish duplicate skill names across scopes.
 */
export type ProviderSkill = {
  provider: LLMProvider;
  name: string;
  description: string;
  command: string;
  scope: ProviderSkillScope;
  sourcePath: string;
  pluginName?: string;
  pluginId?: string;
};

/**
 * Internal source descriptor consumed by shared provider skill discovery logic.
 *
 * Concrete provider adapters build these records from their native lookup rules.
 * The shared skills provider then scans `rootDir` for child skill markdown files
 * and uses `commandForSkill` or `commandPrefix` to produce the provider-specific
 * invocation command. Set `recursive` only when a provider stores skills under
 * arbitrary nested folders below the source root.
 */
export type ProviderSkillSource = {
  scope: ProviderSkillScope;
  rootDir: string;
  recursive?: boolean;
  commandPrefix?: '/' | '$';
  commandForSkill?: (skillName: string) => string;
  pluginName?: string;
  pluginId?: string;
};

// ---------------------------
//----------------- SHARED ERROR TYPES ------------
/**
 * Optional metadata used when constructing application-level errors.
 *
 * `statusCode` should reflect the HTTP response status, while `code` identifies
 * the stable machine-readable error category.
 */
export type AppErrorOptions = {
  code?: string;
  statusCode?: number;
  details?: unknown;
};

// ---------------------------
//----------------- MCP TYPES ------------
/**
 * Scope where an MCP server definition is stored and resolved.
 *
 * `user` is global for a user account, `local` is provider-local, and `project`
 * is tied to a specific project path.
 */
export type McpScope = 'user' | 'local' | 'project';

/**
 * Transport protocol used by an MCP server definition.
 */
export type McpTransport = 'stdio' | 'http' | 'sse';

/**
 * Normalized MCP server model exposed to frontend and route handlers.
 *
 * Provider adapters should map provider-native config to this structure before
 * returning results.
 */
export type ProviderMcpServer = {
  provider: LLMProvider;
  name: string;
  scope: McpScope;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

/**
 * Payload for create/update MCP server operations.
 *
 * Routes and services should accept this type, validate it, and then persist it
 * through provider-specific MCP repositories.
 */
export type UpsertProviderMcpServerInput = {
  name: string;
  scope?: McpScope;
  transport: McpTransport;
  workspacePath?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  envVars?: string[];
  bearerTokenEnvVar?: string;
  envHttpHeaders?: Record<string, string>;
};

// ---------------------------
//----------------- PROVIDER AUTH TYPES ------------
/**
 * Authentication status result returned by provider health checks.
 *
 * This shape is consumed by settings/status endpoints to report installation and
 * credential state for each provider.
 */
export type ProviderAuthStatus = {
  installed: boolean;
  provider: LLMProvider;
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

// ---------------------------
//----------------- SHARED DATABASE CREDENTIAL TYPES ------------
/**
 * Safe credential view returned by credential listing APIs.
 *
 * This intentionally excludes the raw credential secret while still exposing
 * metadata needed for UI rendering and management operations.
 */
export type CredentialPublicRow = {
  id: number;
  credential_name: string;
  credential_type: string;
  description: string | null;
  created_at: string;
  is_active: number;
};

/**
 * Result returned after creating a credential record.
 *
 * Use this return shape when callers need the created id and display metadata,
 * but must never receive the stored secret value.
 */
export type CreateCredentialResult = {
  id: number | bigint;
  credentialName: string;
  credentialType: string;
};

// ---------------------------
//----------------- PROJECT PERSISTENCE TYPES ------------
/**
 * Canonical project row shape returned by the projects repository.
 *
 * Use this type whenever backend services need to pass around one database
 * project record without leaking raw SQL row typing across modules.
 */
export type ProjectRepositoryRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
};

/**
 * Result category returned by `projectsDb.createProjectPath`.
 *
 * `created` means a fresh row was inserted, `reactivated_archived` means an
 * existing archived path was accepted and updated, and `active_conflict` means
 * an already-active path blocked project creation.
 */
export type CreateProjectPathOutcome =
  | 'created'
  | 'reactivated_archived'
  | 'active_conflict';

/**
 * Structured result returned by project-path upsert operations.
 *
 * Services should use this result to decide whether a request succeeded,
 * should return a conflict, or needs follow-up retrieval of row metadata.
 */
export type CreateProjectPathResult = {
  outcome: CreateProjectPathOutcome;
  project: ProjectRepositoryRow | null;
};

/**
 * Validation result for user-supplied workspace/project paths.
 *
 * `resolvedPath` is present only when validation succeeds. `error` is present
 * only when validation fails and is suitable for user-facing diagnostics.
 */
export type WorkspacePathValidationResult = {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
};

// ---------------------------
//----------------- GIT WORKTREE MANAGEMENT ------------
/**
 * Captured output of one completed `git` invocation.
 *
 * Returned by `GitCommandRunner` implementations so worktree services can read
 * both streams without caring about process plumbing.
 */
export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

/**
 * Executes `git <args>` inside `cwd` and resolves with the captured output.
 *
 * All worktree services receive their git access through this contract so
 * tests can inject a fake runner instead of spawning real processes. The
 * promise must reject (with `stderr` attached when available) on a non-zero
 * exit code.
 */
export type GitCommandRunner = (args: string[], cwd: string) => Promise<GitCommandResult>;

/**
 * One entry parsed from `git worktree list --porcelain`.
 *
 * This is the raw repository-level view (path/HEAD/branch/flags) before any
 * enrichment with project links or ahead/behind counts. `branch` is null for
 * detached-HEAD worktrees.
 */
export type WorktreePorcelainEntry = {
  path: string;
  headSha: string | null;
  branch: string | null;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
};

/**
 * Fully enriched worktree row served to the UI.
 *
 * Extends the porcelain entry with everything the Worktrees panel renders:
 * dirty-file count, ahead/behind relative to the base branch (the branch
 * checked out in the main worktree), last-commit metadata, and the CloudCLI
 * project row linked to the worktree directory (if one was registered).
 */
export type WorktreeDescriptor = {
  path: string;
  branch: string | null;
  headSha: string | null;
  isMain: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  isDetached: boolean;
  changedFileCount: number;
  ahead: number;
  behind: number;
  lastCommitSubject: string | null;
  lastCommitDate: string | null;
  linkedProjectId: string | null;
  linkedProjectArchived: boolean;
};

/**
 * Response payload of `GET /api/worktrees`.
 *
 * `baseBranch` is the branch checked out in the main worktree — the merge
 * target offered by the UI. `worktrees` always lists the main worktree first.
 */
export type WorktreeListResult = {
  repositoryRoot: string;
  baseBranch: string | null;
  worktrees: WorktreeDescriptor[];
};

// ---------------------------
//----------------- WORKTREE SERVICE INPUTS AND RESULTS ------------
/**
 * Input accepted by the worktree-listing workflow.
 *
 * `projectPath` may point at the main checkout or any linked worktree. The
 * service uses Git to resolve the complete repository-level worktree list.
 */
export type ListWorktreesInput = {
  projectPath: string;
};

/**
 * Input accepted when creating a linked Git worktree.
 *
 * `branch` is checked out when it already exists, otherwise it is created from
 * `baseBranch`. When `baseBranch` is omitted, the main worktree branch is used.
 */
export type CreateWorktreeInput = {
  projectPath: string;
  branch: string;
  baseBranch?: string | null;
};

/**
 * Result of successfully creating a linked Git worktree.
 *
 * `createdBranch` distinguishes a new branch from an existing branch checkout,
 * allowing API clients to accurately describe what Git changed.
 */
export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  createdBranch: boolean;
};

/**
 * Result of atomically creating and registering a worktree for project use.
 *
 * The Worktrees application service compensates the Git creation if project
 * registration fails, so routes only receive this shape after both steps pass.
 */
export type CreateAndOpenWorktreeResult = CreateWorktreeResult & {
  project: WorktreeProjectView;
};

/**
 * Input accepted when registering an existing worktree as a CloudCLI project.
 *
 * The service verifies that `worktreePath` belongs to the repository containing
 * `projectPath` before it creates or restores any project record.
 */
export type OpenWorktreeInput = {
  projectPath: string;
  worktreePath: string;
};

/**
 * Project view returned after a worktree is opened in CloudCLI.
 *
 * This deliberately mirrors the project-selection payload used by the Projects
 * module so the frontend can switch to the worktree without another lookup.
 */
export type WorktreeProjectView = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
  sessions: [];
  sessionMeta: { hasMore: false; total: 0 };
};

/**
 * Input accepted when removing a linked Git worktree.
 *
 * `force` permits removal with local changes. `deleteBranch` requests
 * best-effort branch cleanup after the worktree directory is removed.
 */
export type RemoveWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
  deleteBranch?: boolean;
};

/**
 * Result of removing a linked Git worktree.
 *
 * `archivalError` reports best-effort project archival failure after Git has
 * already removed the worktree, allowing callers to represent partial success.
 */
export type RemoveWorktreeResult = {
  removedPath: string;
  branch: string | null;
  branchDeleted: boolean;
  archivedProjectId: string | null;
  archivalError: string | null;
};

/**
 * Input accepted when merging a linked worktree into the main worktree branch.
 *
 * The service verifies both worktrees are clean, supports squash and regular
 * merges, and may remove the source worktree after a successful merge.
 */
export type MergeWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  squash?: boolean;
  message?: string | null;
  removeAfterMerge?: boolean;
};

/**
 * Result of a completed worktree merge.
 *
 * `removedWorktree` is populated only when post-merge removal succeeds.
 * `cleanupError` reports failed optional removal without misrepresenting the
 * already-completed merge as a failure.
 */
export type MergeWorktreeResult = {
  mergedBranch: string;
  targetBranch: string;
  squash: boolean;
  removedWorktree: RemoveWorktreeResult | null;
  cleanupError: string | null;
};

// ---------------------------
//----------------- WORKTREE MODULE DEPENDENCY CONTRACTS ------------
/**
 * Filesystem capability required by the Worktrees module.
 *
 * Production wiring checks the real filesystem; unit tests provide a small
 * deterministic fake so worktree creation never touches developer directories.
 */
export type WorktreeFileSystem = {
  pathExists(candidatePath: string): Promise<boolean>;
};

/**
 * Project-management boundary consumed by Worktrees workflows.
 *
 * The Worktrees module uses this contract instead of importing Database or
 * Projects internals. Production adapters delegate through those modules'
 * `index.ts` barrels, while unit tests supply in-memory functions.
 */
export type WorktreeProjectGateway = {
  getProjectPathById(projectId: string): string | null;
  getProjectByPath(projectPath: string): ProjectRepositoryRow | null;
  createProject(input: {
    projectPath: string;
    customName: string;
  }): Promise<{
    outcome: 'created' | 'reactivated_archived';
    project: { projectId: string };
  }>;
  restoreProject(projectId: string): void | Promise<void>;
  archiveProject(projectId: string): void | Promise<void>;
};

/**
 * Complete application-service surface used by the Worktrees HTTP router.
 *
 * Routes parse transport values and call these functions; they do not import
 * repositories, filesystem adapters, Git runners, or individual service files.
 */
export type WorktreeServices = {
  resolveProjectPath(projectId: string): string;
  list(input: ListWorktreesInput): Promise<WorktreeListResult>;
  create(input: CreateWorktreeInput): Promise<CreateWorktreeResult>;
  createAndOpen(input: CreateWorktreeInput): Promise<CreateAndOpenWorktreeResult>;
  open(input: OpenWorktreeInput): Promise<WorktreeProjectView>;
  merge(input: MergeWorktreeInput): Promise<MergeWorktreeResult>;
  remove(input: RemoveWorktreeInput): Promise<RemoveWorktreeResult>;
};

// ---------------------------
//----------------- FILE TREE MODULE CONTRACTS ------------
/**
 * One filesystem item returned by the File Tree API.
 *
 * The service populates metadata without following symlinks and recursively
 * attaches `children` only while the requested depth permits traversal. The
 * frontend uses the absolute `path` as the stable identifier for editor and
 * file-operation requests.
 */
export type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string | null;
  permissions: string;
  permissionsRwx: string;
  isSymlink?: boolean;
  children?: FileTreeNode[];
};

/**
 * One row of a directory listing as the file manager renders it.
 *
 * NOT `FileTreeDirectoryEntry` below — that is the `Dirent` adapter used while
 * walking the filesystem. This is the API shape the browser receives.
 *
 * `kind` is the entry's OWN kind, read without following symlinks: a link to a
 * directory reports `file`, so nothing outside the project can present itself
 * here as a folder to descend into.
 *
 * `bytes` and `mtime` are `null` — never `0`, never an invented timestamp —
 * when the per-entry `lstat` fails (a permission wall, or a name that vanished
 * between the directory read and the stat). The client renders that as "—".
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
 * `path` is the RESOLVED ABSOLUTE directory, matching every other File Tree
 * response (`FileTreeNode.path`, the read/save/upload results); the client
 * relativizes it against the project path it already holds. Entries arrive
 * sorted directories-first and then by name, so the browser never re-sorts.
 */
export type DirectoryListing = {
  path: string;
  entries: DirectoryEntry[];
};

/**
 * What the preview pane can show for one file.
 *
 * The three arms are a closed set and the client switches on `kind`:
 * - `text`  — `lines.length` lines, already split, beginning at `startLine` and
 *   NOT necessarily at the top of the file. `totalLines` is `null` when the READ
 *   did not walk the whole file — not merely when the file is large, because a
 *   window near the end of a big one walks to EOF anyway and its count is real —
 *   so a client can never render an invented line count, and can trust the one it
 *   is given to decide whether a line exists at all; `truncated` says truthfully
 *   whether the file holds more than the window returned — lines skipped BEFORE
 *   it count, so a window opened mid-file is truncated even when it runs to the
 *   last line.
 * - `image` — no pixels are read here. The browser loads the file through the
 *   existing content stream and measures it with `naturalWidth`/`naturalHeight`.
 * - `none`  — a binary this app will not guess at. Download is the only action.
 *
 * `bytes`/`mtime` are `null` only when the file's `stat` gave nothing.
 */
export type FilePreview =
  | {
      kind: 'text';
      lines: string[];
      /**
       * The line number `lines[0]` carries — 1 for a window opened at the top. When `lines`
       * is empty this is still the window that was ASKED for, and the file ends before it.
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
  path: string;              // project-relative, as asked
  rev: string;               // opaque revision token (I3) of the file the lines were read from
  startLine: number;         // 1-based number of lines[0]; echoes the clamped `start`
  lines: string[];           // each line without its terminator and without one trailing '\r'
  eof: boolean;              // true when this read reached the file's last line
  totalLines: number | null; // the file's line count when known (eof reached, or known to the line index for this rev), else null
  eol: '\n' | '\r\n';        // the file's FIRST line terminator; '\n' when the file has none
};

/** One contiguous line-range replacement against revision `baseRev`. */
export type FileLinePatch = {
  path: string;
  baseRev: string;
  startLine: number;   // 1-based first ORIGINAL line replaced; totalLines + 1 appends
  deleteCount: number; // original lines removed from startLine, >= 0
  lines: string[];     // replacement lines; none contains '\n' or '\r'
};

/** What a successful patch left on disk. */
export type FilePatchResult = { path: string; rev: string; totalLines: number };

/**
 * Raw lines the line index read: bytes of each line without its '\n' (a trailing '\r' is kept; the
 * service strips it). Server-only, because the index, the patch and the edit service all speak it.
 */
export type FileLineRead = {
  lines: Buffer[];
  startLine: number;
  eof: boolean;
  totalLines: number | null;
  tooLongLine: number | null; // the first line in the window over maxLineBytes; reading stopped there
  eol: '\n' | '\r\n' | null;  // the file's first terminator when the index knows it for this rev, else the first this read crossed; null when the file has none
};

/** The whole-file facts a patch needs, from one full scan per revision. */
export type FileLineShape = { size: number; totalLines: number; endsWithNewline: boolean; eol: '\n' | '\r\n' };

/**
 * THE line model of the edit path (`file-line-index.ts`).
 *
 * One model, shared by every reader and writer of a file's lines, so a line the editor sees is the
 * line the preview shows and the line a patch replaces. It works in BYTES: `0x0A` is the only
 * separator it knows, and it never decodes text or holds a line it was not asked for.
 */
export type FileLineIndex = {
  readWindow(realPath: string, rev: string, start: number, maxLines: number, maxBytes: number, maxLineBytes: number): Promise<FileLineRead>;
  lineOffset(realPath: string, rev: string, line: number): Promise<number | null>; // byte offset where `line` starts; totalLines + 1 → size; beyond → null
  fileShape(realPath: string, rev: string): Promise<FileLineShape>;
};

/** The edit service `file-tree.module.ts` builds and `file-tree-edit.routes.ts` calls. */
export type FileTreeEditService = {
  readEditWindow(projectId: string, filePath: string, start: number, lines: number): Promise<FileEditWindow>;
  patchTextFile(projectId: string, patch: FileLinePatch): Promise<FilePatchResult>;
};

/**
 * One file as it was actually stored by an upload.
 *
 * `name` and `path` are the SAVED name and location, which is not always what
 * the browser sent: an upload never overwrites, so a taken name becomes
 * `report (1).pdf` and `renamedFrom` carries the original. `renamedFrom` is
 * absent — not empty, not equal to `name` — when nothing was renamed, so its
 * presence alone is the client's signal to say so.
 */
export type UploadedFileRecord = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  renamedFrom?: string;
};

/**
 * Minimal directory-entry shape required during File Tree traversal.
 *
 * Production adapts Node `Dirent` objects to this structural contract. Tests
 * provide small handwritten entries and therefore never read real directories.
 */
export type FileTreeDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

/**
 * Minimal file-stat shape used for tree metadata and delete decisions.
 *
 * The numeric mode is converted to octal and rwx strings for the UI. `lstat`
 * supplies symlink state while `stat` is used when deciding file versus folder
 * deletion behavior.
 */
export type FileTreeStats = {
  size: number;
  mtime: Date;
  mode: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  // Optional so that a stat shape written before this member still satisfies the contract.
  // Production always supplies it (these are Node `fs.Stats`), so a caller ruling out a
  // FIFO, socket, or device node tests for a definite `false` and treats a missing
  // implementation as "not known" rather than as "not a regular file".
  isFile?(): boolean;
};

/**
 * Complete filesystem capability injected into File Tree services.
 *
 * The production composition root delegates these operations to Node's fs
 * APIs. Unit tests provide deterministic path-keyed fakes so service tests
 * cannot inspect, write, rename, or delete developer files.
 */
export type FileTreeFileSystem = {
  access(candidatePath: string): Promise<void>;
  stat(candidatePath: string): Promise<FileTreeStats>;
  lstat(candidatePath: string): Promise<FileTreeStats>;
  // Streamed rather than returned as an array so a directory with millions of
  // children is abandoned at the entry limit instead of being materialized.
  openDirectory(directoryPath: string): AsyncIterable<FileTreeDirectoryEntry>;
  realpath(candidatePath: string): Promise<string>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  makeDirectory(directoryPath: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  removeDirectory(directoryPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  // `exclusive` maps to `COPYFILE_EXCL`: the copy fails with `EEXIST` instead of
  // overwriting. Uploads pass it, which is the only thing that makes the "pick a
  // free name" check hold when two of them race for the same free name.
  copyFile(sourcePath: string, destinationPath: string, exclusive?: boolean): Promise<void>;
  /** `end` is inclusive, as in `fs.createReadStream`: `{ end: size - 1 }` reads exactly `size` bytes. */
  createReadStream(filePath: string, range?: { start?: number; end?: number }): Readable;
  /** `stat` with bigint fields, so the revision token carries nanosecond mtime. */
  statExact(candidatePath: string): Promise<BigIntStats>;
  /** Creates the file with flag 'wx' and `mode`; fails with EEXIST instead of opening an existing one. */
  openExclusive(filePath: string, mode: number): Promise<FileHandle>;
};

/**
 * Project lookup boundary consumed by File Tree workflows.
 *
 * File Tree services resolve DB-assigned project ids through this contract and
 * never import the Database module or its repositories directly.
 */
export type FileTreeProjectGateway = {
  getProjectPathById(projectId: string): string | null | Promise<string | null>;
};

/**
 * Workspace validation boundary used by filesystem browsing and folder creation.
 *
 * The injected validator enforces the configured workspace root and resolves
 * symlinks before the File Tree service exposes or mutates paths.
 */
export type FileTreeWorkspaceGateway = {
  rootPath: string;
  validatePath(candidatePath: string): Promise<WorkspacePathValidationResult>;
};

/**
 * Uploaded-file record passed from the Multer transport adapter into the File
 * Tree service.
 *
 * Transport-specific field names are normalized so upload workflows do not
 * depend on Express or Multer types.
 */
export type FileTreeUploadedFile = {
  originalName: string;
  temporaryPath: string;
  size: number;
  mimeType: string;
};

/**
 * Logger boundary for expected File Tree diagnostics.
 *
 * Production delegates to the server console. Unit tests use no-op or captured
 * loggers and never patch the global console singleton.
 */
export type FileTreeLogger = {
  error(message: string, error?: unknown): void;
};

/**
 * Required production dependencies for the File Tree application service.
 *
 * Filesystem, project lookup, workspace policy, MIME detection, concurrency,
 * and logging are all explicit so service construction has no hidden process,
 * repository, or machine-wide defaults.
 */
export type FileTreeServiceDependencies = {
  fileSystem: FileTreeFileSystem;
  projects: FileTreeProjectGateway;
  workspace: FileTreeWorkspaceGateway;
  resolveMimeType(filePath: string): string;
  fileSystemConcurrency: number;
  logger: FileTreeLogger;
};

/**
 * Complete File Tree application-service surface consumed by HTTP routes.
 *
 * Routes parse transport inputs and call these methods; they never resolve
 * project repositories, validate filesystem ownership, or perform filesystem
 * mutations themselves.
 */
export type FileTreeServices = {
  browseWorkspace(inputPath: string | null): Promise<{
    path: string;
    suggestions: Array<{ path: string; name: string; type: 'directory' }>;
  }>;
  createWorkspaceFolder(folderPath: string): Promise<{ success: true; path: string }>;
  readTextFile(projectId: string, filePath: string): Promise<{ content: string; path: string }>;
  openFile(projectId: string, filePath: string): Promise<{ contentType: string; size: number; stream: Readable }>;
  listProjectFiles(
    projectId: string,
    options?: { respectGitignore: boolean },
  ): Promise<FileTreeNode[]>;
  createEntry(input: {
    projectId: string;
    parentPath: string;
    type: 'file' | 'directory';
    name: string;
  }): Promise<{ success: true; path: string; name: string; type: 'file' | 'directory'; message: string }>;
  renameEntry(input: { projectId: string; oldPath: string; newName: string }): Promise<{
    success: true;
    oldPath: string;
    newPath: string;
    newName: string;
    message: string;
  }>;
  deleteEntry(input: { projectId: string; targetPath: string }): Promise<{
    success: true;
    path: string;
    type: 'file' | 'directory';
    message: string;
  }>;
  storeUploadedFiles(input: {
    projectId: string;
    targetPath: string;
    relativePaths: string[];
    requestedFileCount: number;
    files: FileTreeUploadedFile[];
  }): Promise<{
    success: true;
    files: UploadedFileRecord[];
    uploadedCount: number;
    requestedFileCount: number;
    targetPath: string;
    message: string;
  }>;
};

/**
 * Required production dependencies for the File Tree listing service.
 *
 * The project-root resolver is supplied by the composition root rather than the
 * project gateway itself, so this service never decides what an unknown project
 * id means; it receives a root or the resolver's own error.
 */
export type FileTreeListingServiceDependencies = {
  resolveProjectRoot(projectId: string): Promise<string>;
  resolveMimeType(filePath: string): string;
  fileSystem: FileTreeFileSystem;
};

/**
 * Directory-listing and file-preview surface consumed by the File Tree routes.
 *
 * Separate from `FileTreeServices` because these two read-only workflows share
 * no state with browsing, editing, or uploads — the routes call whichever
 * service owns the request.
 *
 * `maxLines` and `startLine` are already clamped by the route; the service treats them as
 * trusted positive counts. `startLine` opens the text window somewhere other than line 1, so
 * a file reference carrying `:line` can be shown at that line.
 */
export type FileTreeListingServices = {
  listDirectory(projectId: string, directoryPath: string): Promise<DirectoryListing>;
  previewFile(projectId: string, filePath: string, maxLines: number, startLine?: number): Promise<FilePreview>;
};

// ---------------------------
//----------------- VOICE MODULE CONTRACTS ------------
/**
 * Per-request voice settings parsed from authenticated HTTP headers.
 *
 * The Voice routes create this value from the optional `x-voice-*` headers and
 * pass it to the Voice service. Empty values mean "use the server-configured
 * default"; the backend base URL is intentionally absent because clients must
 * never control the server's outbound destination.
 */
export type VoiceRequestOverrides = {
  apiKey?: string;
  sttModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  ttsFormat?: string;
};

/**
 * Uploaded audio accepted by the Voice transcription service.
 *
 * Routes translate Multer's transport-specific file object into this minimal
 * shape so the service does not depend on Express or Multer types.
 */
export type VoiceAudioUpload = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

/**
 * Successful speech payload returned by the Voice service.
 *
 * The route copies `contentType` to the client response and pipes `body`
 * without buffering the complete synthesized audio in application memory.
 */
export type VoiceSpeechPayload = {
  contentType: string;
  body: ReadableStream<Uint8Array> | null;
};

/**
 * Explicit service result used by Voice routes instead of transport-aware
 * exceptions.
 *
 * Services return `ok: false` with the exact client status/message for expected
 * backend, validation, and timeout failures. Routes only translate the result
 * into HTTP output, while unexpected programming errors still reject normally.
 */
export type VoiceServiceResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; status: number; error: string };

/**
 * Complete application-service surface consumed by the Voice HTTP router.
 *
 * The composition root supplies a concrete implementation with environment
 * configuration and an injected outbound HTTP adapter. Unit tests use the same
 * contract with handwritten fetch fakes and never patch global state.
 */
export type VoiceService = {
  getHealth(): { configured: boolean };
  transcribe(input: {
    audio: VoiceAudioUpload;
    overrides: VoiceRequestOverrides;
  }): Promise<VoiceServiceResult<{ text: string }>>;
  synthesizeSpeech(input: {
    text: string;
    overrides: VoiceRequestOverrides;
  }): Promise<VoiceServiceResult<VoiceSpeechPayload>>;
};

// ---------------------------
//----------------- CLI MODULE CONTRACTS ------------
/**
 * Output boundary used by the CLI and Sandbox services.
 *
 * Production wiring delegates to the real console. Unit tests collect these
 * calls in arrays, which keeps command assertions deterministic and avoids
 * monkey-patching the global console singleton.
 */
export type CliOutput = {
  log(message?: string): void;
  error(message?: string): void;
};

/**
 * Minimal synchronous filesystem surface shared by CLI status reporting and
 * sandbox workspace validation.
 *
 * The production composition root adapts Node's filesystem module. Tests supply
 * path-keyed fakes, so service tests never inspect or modify the real machine.
 */
export type CliFileSystem = {
  pathExists(filePath: string): boolean;
  getFileStats(filePath: string): { size: number; modifiedAt: Date };
};

/**
 * Mutable environment view owned by the CLI application.
 *
 * CLI options update this object before the server starts. Production passes
 * `process.env`; tests pass a plain record to verify option precedence without
 * changing process-wide environment state.
 */
export type CliEnvironment = Record<string, string | undefined>;

/**
 * Package metadata displayed by CLI help, status, version, and update commands.
 *
 * The composition root reads this once from the application package file and
 * injects only the fields the service needs.
 */
export type CliPackageMetadata = {
  version: string;
  homepage?: string;
  bugsUrl?: string;
};

/**
 * Executable CLI application returned by the CLI composition root.
 *
 * The thin executable entrypoint passes `process.argv` arguments to `run` and
 * copies the returned code to `process.exitCode`. Tests invoke the same method
 * directly with isolated dependencies.
 */
export type CliApplication = {
  run(argumentsList: string[]): Promise<number>;
};

/**
 * Sandbox command service consumed by the top-level CLI command dispatcher.
 *
 * Keeping this behind one required dependency lets CLI tests use a tiny fake,
 * while focused Sandbox tests exercise subprocess and filesystem behavior with
 * their own handwritten adapters.
 */
export type SandboxCommandService = {
  execute(argumentsList: string[]): Promise<number>;
};

// ---------------------------
//----------------- CLAUDE ACCOUNT CONTRACTS ------------
// The account switcher's own wire shapes, produced by `server/modules/accounts/` and mirrored
// field-for-field in `src/shared/types.ts`. The envelope survives because the client is built on it:
// a read never fails, and a picture nobody can compute is a calm 200 `{reachable:false, reason}`,
// never a 5xx. Units differ and are not interchangeable — `expiresAt`/`liveExpiresAt` are epoch
// MILLISECONDS, `checkedAt`/`staleSince` epoch SECONDS, `resetsAt` an ISO-8601 string.
/** One Claude account slot the store holds. `expiresAt` is epoch MILLISECONDS, `null` when unread — never 0, so an unknown expiry cannot render as "expired". */
export type ClaudeAccountSlot = { slug: string; label: string; expiresAt: number | null; isActive: boolean };
/** The whole account picture, or the calm reason it is unknown. `liveExpiresAt` is epoch MILLISECONDS like `ClaudeAccountSlot.expiresAt` — NOT seconds like `ClaudeUsage.checkedAt`. `liveSessions` is how many Claude sessions this box can prove are running: a fact a row states, never a gate on switching.
 *  `unreadable:true` is the account store answering with nothing — no captured slot AND no readable live login: `slots` is `[]` and every label `null`. Say that in words, because an empty switcher reads as "you have no accounts". */
export type ClaudeAccounts =
  | { reachable: true; active: string | null; activeLabel: string | null; slots: ClaudeAccountSlot[]; liveLabel: string | null; liveExpiresAt: number | null; drift: boolean; liveSessions: number; unreadable: boolean; /** The door's picture, beside today's slot summary until the old switcher is removed; absent renders nothing. */ door?: ClaudeAccountsPicture | { reachable: false; reason: string } }
  | { reachable: false; reason: string };

/**
 * One account in the door's picture, relayed unchanged from `claude-account status --json`.
 * `slug` is the account's name in every sentence a person reads; `digest` stays in data. Times are
 * epoch SECONDS. `reading.five` and `reading.week` are fractions 0..1 — window POINTS once multiplied
 * by 100, never dollars (INV-4299) — and `reading.at` is when that reading was filed. `token` is the
 * stored sign-in token's state; `wall.kind: "refused"` is a token Claude would not accept. `why` is
 * the door's own sentence and is rendered as it arrives.
 */
export type ClaudeAccountRow = {
  slug: string;
  digest: string;
  token: 'none' | 'saved' | 'checking';
  expires_at: number | null;
  chosen: boolean;
  live: boolean;
  in_use: boolean;
  wall: { kind: 'usage' | 'credit' | 'spend' | 'rate' | 'refused'; until: number | null } | null;
  reading: { five: number; five_resets: number | null; week: number; week_resets: number | null; at: number; source: string } | null;
  pace: { five: { projected: number; ceiling: number } | null; week: { projected: number; ceiling: number } | null } | null;
  room: boolean;
  why: string;
};

/**
 * One switch, as `switches.jsonl` records it and the door relays it: `from`/`to` are digests,
 * `from_slug`/`to_slug` the accounts' names, `at` epoch SECONDS, `by` who made it, and `why` the
 * rule's own sentence — the one a person reads.
 */
export type ClaudeAccountSwitch = {
  at: number;
  from: string;
  from_slug: string;
  to: string;
  to_slug: string;
  by: 'operator' | 'auto';
  why: string;
};

/**
 * One launch credential, as `claude-account credential --fd N` answers it over the pipe the caller
 * opened: the account in use and the sign-in token to ride. `token` is `null` when the account holds
 * none, and every field is `null` when the door could not answer — a launch then rides the live login
 * exactly as before the account store existed. The token's only consumer is the environment a Claude
 * CLI is started with (`claude-launch-account.ts`); it is never relayed, logged or put in a wire shape.
 */
export type ClaudeAccountCredential = {
  account: string | null;
  slug: string | null;
  token: string | null;
};

/**
 * The account panel's whole picture, relayed unchanged by `GET /api/accounts` from
 * `claude-account status --json`: one row per account in slug order, the live identities the store
 * does not hold yet (`candidates`), whether automatic switching is on (`auto`), the chosen record
 * and whether it waits for room (`held`), and the last switch or `null`. No token and no token
 * digest is ever in it — a row carries only the token's STATE.
 */
export type ClaudeAccountsPicture = {
  accounts: ClaudeAccountRow[];
  candidates: { slug: string; digest: string }[];
  auto: boolean;
  held: boolean;
  chosen: { slug: string; digest: string; at: number; by: 'operator' | 'auto'; why: string } | null;
  last_switch: ClaudeAccountSwitch | null;
};
/** One usage window. A `null` `percent` is "no reading": draw an empty track, never 0 %. `rolled:true` is NOT that — the percent is a REAL but HISTORICAL figure whose window has since ended, so keep the bar at low opacity and label it "was"; draining it draws a full tank nobody measured (`server/modules/accounts/usage-windows.ts`, `markRolled`).
 *  `severity` is present ONLY when the vendor flagged the window non-benign; it may ESCALATE a meter's tone, never soften it — a flagged window can read a comfortable 12 % and still mean an account lock (`usage-windows.ts`, `parseWindows`). */
export type ClaudeUsageWindow = { key: string; label: string; percent: number | null; resetsAt: string | null; rolled?: boolean; severity?: string };
/** The pacer's projection for the account in use, in PERCENT as the usage route converts it (`usage.pace`): the two windows' used and projected figures and the ceilings the pacer holds new starts under. `null` on any figure the pacer could not give. `words` is the dispatcher's own one sentence for the 5-hour meter's caption. The key is ABSENT on a reading with no pace (an older server, or a pacer that could not read the window), and an absent pace draws the meters exactly as they were drawn before it existed. */
export type ClaudeUsagePace = {
  used5: number | null;
  projected5: number | null;
  ceiling5: number | null;
  used7: number | null;
  projected7: number | null;
  ceiling7: number | null;
  words: string;
};
/** Usage as the meter last measured it. `checkedAt` (epoch SECONDS) and `staleSince` are its own stamps, converted to seconds for the client and nowhere else.
 *  `reason` carries TWO vocabularies: with `reachable:false` it is the route's own `unreachable`; with `reachable:true` it is the meter's — `''` healthy, `pending` (a poll in flight: reading, NOT broken), `shape`, `credentials`, `auth`, `network`, `throttled`, `upstream`. `windows:[]` with `pending` means "not yet"; `windows:[]` with `degraded:true` means "no numbers under this account". `staleSince` is non-null only while degraded, and says how old the figures on screen are.
 *  `account` is the digest of the login these figures were read from (`liveAccountDigest()`), so the panel can tell whether they belong to the account in use; `''` is "could not be told". An expired token is degraded `credentials` with no fetch at all. */
export type ClaudeUsage =
  | { reachable: true; windows: ClaudeUsageWindow[]; account?: string; degraded: boolean; reason: string; staleSince: number | null; checkedAt: number; /** The pacer's projection, in percent, when the route attached one; absent draws no tick, no mark and no caption. */ pace?: ClaudeUsagePace }
  | { reachable: false; reason: string };

// ---------------------------
//----------------- MEMORY INTAKE CONTRACTS ------------
// The native memory lane's own wire shapes, produced by `server/modules/memory-intake/` and mirrored
// field-for-field in `src/shared/types.ts`. Same envelope, same calm 200: the queue answers what it
// can compute, and a candidate that is not there is an answer rather than an error.
/** One row of the memory-intake list. LEAN: no `body`, no `rationale` — enough to decide, not to read (`server/modules/memory-intake/memory.service.ts`); the body arrives from the by-id read for the ONE card the operator expands.
 *  `refusal` is the cap guard's own plain-English text, recorded on the row when an approve was refused — it stays on a PENDING card and is cleared on the next approve, so a non-null `refusal` means "still waiting, and here is what to trim", never "gone". One LEAN shape serves BOTH list reads, so `status` is the row's own word for which one it came back under (`pending` in the review queue, `approved` on the filed list); `assertedPath` is the file an approved card landed in, `null` while the card is still pending. `sessionId` is the APP session id of the chat that proposed the memory — the staging's unverified provenance column, resolved through `sessionsDb.resolveAppSessionId`, display only, and `null` when the staging never supplied one. */
export type MemoryCandidateLean = { id: string; name: string; target: string; project: string | null; status: string; source: string | null; assertedPath: string | null; refusal: string | null; createdAt: string | null; reviewedAt: string | null; sessionId: string | null };
/** One candidate read whole. `body` is the memory's proposed text and is REQUIRED — a full read without one is not a reading, so it fails the read rather than arriving empty. `indexLine` and `rationale` are `null` when the staging never supplied them. Operator-authored free text throughout: it reaches the DOM as a text node, never as markup. */
export type MemoryCandidateFull = MemoryCandidateLean & { body: string; indexLine: string | null; rationale: string | null };
/** One memory list — the review queue, or the filed memories when the read asked for them — or the calm reason it is unknown; a read never fails. `reason` is the lane's own word (`unreachable`) and never exception text. `candidates` is whole or absent: one row missing `id`, `name` or `target` fails the WHOLE read as `bad-response`, because a silently shortened queue reads as "nothing to review". The list is capped at 100 rows. */
export type MemoryPending =
  | { reachable: true; candidates: MemoryCandidateLean[] }
  | { reachable: false; reason: string };
/** One candidate read by id, or the calm reason it is unknown. `candidate: null` means ONE thing: no row carries that id. A card ALREADY REVIEWED still reads whole, `status` reading `approved` or `rejected` — the by-id read has no status filter, so a reviewed card is a candidate the queue no longer lists, never a null. The null is an ANSWER, not an error: the route stays 200 and the client draws "no longer there". `reason` is again only the lane's own word. */
export type MemoryCandidateRead =
  | { reachable: true; candidate: MemoryCandidateFull | null }
  | { reachable: false; reason: string };

// ---------------------------
//----------------- NOTES ------------
// The notes lane's own wire shapes, produced by `server/modules/notes/` and mirrored field-for-field in
// `src/shared/types.ts` § NOTES. The frame that says a list has moved is `NotesChangedEvent` above,
// beside the board's own frame, because it is built by the same kind of broadcaster.
/** One note as the wire carries it: a card a person wrote. `createdAt` orders the list and never moves; `updatedAt` is the last save. Both are ISO-8601 UTC with milliseconds. The account it belongs to never leaves the server. */
export type Note = { id: string; title: string; description: string; createdAt: string; updatedAt: string };
/** What the two writes take: the whole of both fields, never a patch. */
export type NoteInput = { title: string; description: string };

// ---------------------------
//----------------- CLI VERSION CONTRACTS ------------
// Two facts of the same shape, deliberately kept apart: `installed` is what the binary a run WOULD spawn answers
// to `--version` right now; a run's `cliVersion` is what THAT run's own process announced at init.
// Only the second is the truth about a turn already in flight — which is why nothing here copies one into the other.
/** One live run and the CLI version its own process reported. `startedAt` is epoch MILLISECONDS (`Date.now()` at the moment the run was admitted) — read as seconds it renders in 1970. `cliVersion` is `null` while the run's init message has not arrived yet — "not heard yet", never a guess and never the installed version stood in for it. */
export type CliVersionRun = { sessionId: string; startedAt: number; cliVersion: string | null };
/** What `GET /api/cli-version` answers. `installed` is `null` when no version could be read, with `reason` saying so in plain words — never `0.0.0`, which would compare equal to nothing and stale to everything. `binaryPath` is the binary actually probed, resolved the same way the SDK spawn resolves it; `null` when the file is only chosen once a run starts (a bare or relative `CLAUDE_CLI_PATH`), which is a "we don't know", not a fault. */
export type CliVersionReport = { installed: string | null; reason: string | null; binaryPath: string | null; running: CliVersionRun[] };

// ---------------------------
//----------------- DEEPSEEK CONTRACTS ------------
// The DeepSeek account this host spends on — the one Heph and Athena's builds ride. Read straight
// from the vendor with the key this host holds.
// Unknown is never zero and never an error wall: a key that is absent, refused, slow or answered
// with the wrong shape all arrive as `{reachable:false, reason}`, and the route stays 200.
/** One balance reading, or the calm reason there is none.
 *  `total` is the vendor's OWN decimal string (`"99.63"`), carried through unconverted: money is never put through a
 *  float on this side, and the client decides how to draw it. `available` is the vendor's `is_available` — whether the
 *  account can still serve requests; it is a FACT about a reading that came back, never a reason to refuse one.
 *  `checkedAt` is epoch MILLISECONDS (`Date.now()`) — NOT seconds like `ClaudeUsage.checkedAt`, since this stamp is
 *  ours rather than a vendor's.
 *  `reason` is one of five words: `unconfigured` (no key in the process env or in `.env`), `auth` (the vendor refused
 *  the key), `timeout`, `unreachable`, `bad-response` (a non-2xx status other than a refusal, a body that is not JSON,
 *  or a body this side cannot read — including an empty `balance_infos`, which names no amount and so is not a
 *  reading). Never the vendor's own error text: its 401 body echoes part of the key back. */
export type DeepseekBalance =
  | { reachable: true; available: boolean; currency: string; total: string; checkedAt: number }
  | { reachable: false; reason: string };

// ---------------------------
//----------------- AGENT LAUNCH RELAY: the launch table, through its CLI ------------
// The launch table (`~/.claude/charters/launch.toml`) says which model and effort every soul, and Metis,
// launches at. Its one reader and writer is the hooks' `launch_table` package, and this server only runs
// that package's CLI (`~/.claude/scripts/launch-table`): it never opens the file. So the census
// Settings → Agents → Edit Agent Chains draws is carried WHOLE as the CLI printed it, and its shape is written down once, in Python
// (`hooks/launch_table/census.py`) and mirrored for the client in `src/shared/types.ts`. The
// vocabulary (which models, which efforts) is Python's too: this side checks no word.
/**
 * What one call to the launch table's CLI came to: the object it printed, or why there is none.
 *
 *  - `refused`      the CLI answered no, in one sentence (exit 2 with `{"error"}`). `message` IS that sentence,
 *                   carried untouched, and it is the operator's own mistake, never a server fault.
 *  - `unreachable`  the CLI never answered: it could not be started, timed out, crashed or exited any other way.
 *  - `unreadable`   the CLI exited 0 and what it printed was not the one JSON object its contract promises.
 *
 * Nothing that produces one of these throws: a caller branches on `ok`. Read by the relay's service and
 * routes (the status each reason earns) and by kanban-metis's spawn (a failed resolve blocks a launch).
 */
export type AgentLaunchResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'refused' | 'unreachable' | 'unreadable'; message: string };

/**
 * What `launch-table resolve <name> --side <side>` answers: the `--model` word and the `--effort` word a
 * launch of `name` takes on that side. `effort` is `null` when no `--effort` flag is due, so the CLI's own
 * effortLevel applies. On the `deepseek` side `model` is the house's DeepSeek model word and `effort` is
 * the one house-wide DeepSeek effort. Read by the relay's service, which checks the shape, and by
 * kanban-metis's env service, which turns it into a child's argv.
 */
export type AgentLaunchResolved = {
  name: string;
  side: 'claude' | 'deepseek';
  model: string;
  effort: string | null;
};

/**
 * One row's edit, as `PUT /api/agent-launch/rows/:name` carries it and `launch-table set` takes it. A field
 * left out is left alone; a `null` clears that pin (the CLI's `default`), so the row falls back to the table's
 * defaults. The words themselves are not checked on this side. Read by the relay's routes (the body's shape)
 * and its service (the argv).
 */
export type AgentLaunchRowChange = { model?: string | null; effort?: string | null };

/**
 * An edit of the table's defaults, as `PUT /api/agent-launch/defaults` carries it and `launch-table defaults`
 * takes it. `model` is the default model; `effort` maps a model to its default effort word, or to `null` for
 * "no `--effort` flag on that model"; `deepseek_effort` is the one house-wide DeepSeek effort; `dactyl_model` and
 * `dactyl_effort` are the two words every dactyl launches at (the table's `[dactyl]`), and `summarizer_model` and
 * `summarizer_effort` are the two that write a chat's compaction while Custom compaction is on (the table's
 * `[summarizer]`); none of the four can be cleared.
 * A field left out is left alone. Read by the relay's routes (the body's shape) and its service (the argv).
 */
export type AgentLaunchDefaultsChange = {
  model?: string;
  effort?: Record<string, string | null>;
  deepseek_effort?: string;
  dactyl_model?: string;
  dactyl_effort?: string;
  summarizer_model?: string;
  summarizer_effort?: string;
};

// ---------------------------
//----------------- SUBAGENT TRANSCRIPTS ------------
// ONE subagent's own transcript, as the widget's transcript read answers it. Read from the file on
// demand and never off the history path, whose subagent activities are head-capped at 200
// (`MAX_TRANSMITTED_SUBAGENT_ACTIVITIES`) and belong to the rows they hang from — this read
// tail-slices instead.
/** What one subagent transcript read answers. `found` is `false` when the session, provider, file or launch cannot be resolved — then `activity` is empty, `total` is 0, `inFlight` is `false` and `finishedAt` is `null`, and "not found" is never an HTTP error but this shape with a 200. `activity` is the LAST `SUBAGENT_TRANSCRIPT_LIMIT` (1000) entries, each truncated for transport, and `total` is the untruncated entry count. */
export type SubagentTranscriptResult = { found: boolean; activity: SubagentActivity[]; total: number; inFlight: boolean; finishedAt: string | null };

// ---------------------------
//----------------- CRON REGISTRY: the tracked record of every scheduled job ------------
//
// FOUR consumers, which is why this contract lives here rather than beside any one of them:
// the schedules module's read service (the registry screen), its sync service (the reconcile
// that writes), the module's CLI door (add/remove/list/sync), and — mirrored field-for-field —
// `src/shared/types.ts` for the Schedules tab.
/** Which of the two things a tracked row is: `cron` is a line the box's crontab runs, `scheduled-prompt` is a message the app will send at a time the operator chose. The kind decides which half of `CronJobState` the row may carry — the two never trade values. */
export type CronJobKind = 'cron' | 'scheduled-prompt';
/** Whose job it is — always `user`: the registry tracks the operator's own crontab and scheduled prompts, and the OS's system cron is not read (operator ruling 2026-09-21: nothing the packages ship belongs on the screen). It stays a field because every stored row and every id carries it. */
export type CronJobOrigin = 'user';
/** Every state a tracked job can be in. The four cron values and the three scheduled-prompt values share one union because a row of either kind is read through the same shape — but a row is only ever one kind's set, never a mix. */
export type CronJobState =
  | 'ok' | 'failed' | 'missing' | 'unknown'   // a cron row is only ever one of these four
  | 'pending' | 'sent' | 'cancelled';         // a scheduled-prompt row adds these three
/** How far a tracked row has moved from what the box actually holds: `none` when the sync's read agrees with the record, `adopted` when the row was just discovered, `missing` when the line is gone from the box, `changed` when the schedule or the command moved underneath it. Only the CLI door clears drift. */
export type CronJobDrift = 'none' | 'adopted' | 'missing' | 'changed';
/** One tracked job, exactly as the registry holds it: one crontab line or one scheduled prompt, with everything the screen shows and the sync writes. Every field is declared here — a later phase writes what this shape carries and invents nothing. */
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
/** What one sync run did, told as counts rather than as a diff: what the box showed, what the registry gained, what it had to mark gone, and how long the read took. `ok: false` still carries a report — a sync that failed still ran, and the error text is the reason, never an exception thrown at the caller. */
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

// THE STATE MAPPING, named here so no phase has to invent it. A `cron` row's state is
// 'ok' when the sync saw its line on the box, 'missing' when it did not, 'failed' when a
// reader could not answer for it, 'unknown' before any sync. A `scheduled-prompt` row
// carries `ScheduledMessageStatus` (`server/modules/database/index.ts:62`) ONE-TO-ONE —
// 'pending' -> 'pending', 'sent' -> 'sent', 'failed' -> 'failed', 'cancelled' -> 'cancelled'.
// Nothing is collapsed: 'pending' is the operator's own question and must survive the trip.

/** The whole registry as one read: every tracked job, and the last sync that touched them — the answer `GET /api/schedules` gives. `lastSync: null` means no sync has ever been recorded, which is not the same as a sync that found nothing. */
export type CronRegistrySnapshot = {
  readAt: string;
  jobs: CronJob[];
  lastSync: CronSyncReport | null;
};

// ---------------------------
//----------------- CUSTOM COMPACTION RECORD: the facts of a compacted transcript ------------
// A compaction leaves the chat's old transcript behind as a `superseded_provider_sessions` row with
// `reason = 'compaction'`, so the two delete paths, `resolveAppSessionId` and the indexer's refusal
// cover it with no new reader. These two types are that row's contents: `sessionCompactionsDb`
// (`repositories/session-compactions.db.ts`) writes the facts and answers the record.

/** What a custom compaction knew about itself at the moment the chat swapped onto its new session; `sessionCompactionsDb.swapToCompactedSession` writes it and every field lands in its own column. `trigger` is what started it: the operator pressing Compact (`manual`), a turn's end past the window fraction (`auto`), or the chat sitting idle (`idle`). `summarizerModel` is the word the summarizer was launched with and `summarizerServed` the model that actually answered (`null` when no reply named one) — the two are kept apart because a launch word can be an alias. `summarizerEffort` is the effort it ran at. `preTokens` is the chat's context before the compaction, `null` when no turn had reported it. `summarizerTokensIn` and `summarizerTokensOut` are summed over every summarizer call, failed ones included, and `chunks` is the number of calls the transcript was parted into (1 when it fit one). Tokens only, never dollars — the house is on a subscription. */
export type CompactionFacts = {
  trigger: 'manual' | 'auto' | 'idle';
  summarizerModel: string;
  summarizerServed: string | null;
  summarizerEffort: string;
  preTokens: number | null;
  summarizerTokensIn: number;
  summarizerTokensOut: number;
  chunks: number;
};

/** One compaction as `sessionCompactionsDb.listCompactions` and `listAllCompactions` answer it: the facts, plus where the chat came from. `oldProviderSessionId` and `oldJsonlPath` name the transcript the chat left (still on disk, still searchable); `sessionId` is the app session that left it; `createdAt` is the swap's time as ISO-8601 UTC. `postTokens` is the chat's context after the seed append, and `null` until the append's context count has reported (`setCompactionPostTokens` fills it in) — a record read between the swap and that report is not malformed, it is early. */
export type CompactionRecord = CompactionFacts & {
  oldProviderSessionId: string;
  oldJsonlPath: string;
  sessionId: string;
  createdAt: string;
  postTokens: number | null;
};

/** What `sessionCompactionsDb.latestCompaction` answers for a chat: the four things the compaction module needs from the chat's NEWEST `compaction` row, and nothing else (`CompactionRecord` is the full row). `oldProviderSessionId` names the transcript that compaction left behind. `compactedAtMs` is when the swap was recorded (epoch ms, to the second): a chat compacted after a turn ended is no longer the size that turn left. `postTokens` is the chat's context after its seed append, `null` until the append's count has reported — the growth guard holds nothing against a chat with no `postTokens`. `seed` is the seed's blocks as the summarizer returned them, parsed back from the JSON array the swap stored; it is `null` for a compaction recorded before the column existed, and when the stored text is not a non-empty array of non-empty strings — a start-over then carries no seed and the chat reads as it did before the record. Consumers: the compaction module's auto-trigger (`postTokens`, and `compactedAtMs` for a restored idle deadline) and its decorator (`seed`). */
export type LatestCompaction = {
  oldProviderSessionId: string;
  compactedAtMs: number;
  postTokens: number | null;
  seed: string[] | null;
};

/** The `compaction` row a chat's history and live stream draw where a custom compaction swapped the chat onto a new session. `NormalizedMessage.compaction` carries it on a row of `kind: 'compaction'` (`id: 'compaction-<old provider session id>'`), built from a `CompactionRecord` by the Claude history reader and, live, by the compaction run itself. `trigger` is what started the compaction (`manual`: the operator pressed Compact; `auto`: a turn ended past the window fraction; `idle`: the chat sat idle). `summarizerModel` is the word the summarizer launched with and `summarizerServed` the model that answered, `null` when no reply named one. `preTokens` is the chat's context before and `postTokens` its context after the seed append — `null` until known, so a marker read early is not malformed. `summarizerTokensIn`, `summarizerTokensOut` and `chunks` say what the summarizer read, wrote and in how many calls (tokens only, never dollars — the house is on a subscription). `at` is the swap's time as an ISO-8601 string. The client mirrors this type in `src/shared/types.ts`; keep the two identical. */
export type ChatCompactionMarker = {
  trigger: 'manual' | 'auto' | 'idle';
  summarizerModel: string;
  summarizerServed: string | null;
  summarizerEffort: string;
  preTokens: number | null;
  postTokens: number | null;
  summarizerTokensIn: number;
  summarizerTokensOut: number;
  chunks: number;
  at: string;
};

// ---------------------------
//----------------- CUSTOM COMPACTION SWITCH: the summarizer's status ------------

/**
 * What `~/.claude/scripts/summarize --status` prints as its one JSON line: the summarizer's words
 * (`launch.toml`'s `[summarizer]`, which CloudCLI never parses) and whether the installed Claude Code
 * can serve them now. `ready: false` carries its sentence in `why`; `ready: true` carries `''`.
 * `cli` names the binary that answer was derived from, so a holder can ask again exactly when the
 * binary changes: `settings`' `summarizerStatus()` produces it and `modules/compaction` caches a READY
 * one by `cli.path`, `size` and `mtime_ns` (a not-ready one is asked again at the next launch, because
 * the operator's words change without the binary). `mtime_ns` is past 2^53, so a comparison against a `stat` goes
 * through `Number(stat.mtimeNs)` on a bigint stat — both sides then round the same way.
 */
export type SummarizerStatus = {
  model: string;
  effort: string;
  ready: boolean;
  why: string;
  cli: { path: string; size: number; mtime_ns: number; version: string };
};

// ---------------------------
//----------------- CLAUDE COMMAND CATALOG: the command list the engine advertises ------------

/**
 * One command of the Claude Code engine's own list, as `supportedCommands()` reports it and the
 * command catalog keeps it. `name` has no leading slash; `description` and `argumentHint` are `''`
 * when the engine gives none (never undefined), and `aliases` is `[]` when it names none. Only
 * `claude-command-catalog.ts` builds one, from a record read off the CLI or off its own cache file.
 */
export type ClaudeEngineCommand = {
  name: string;
  description: string;
  argumentHint: string;
  aliases: string[];
};

/**
 * The installed Claude CLI's command list plus the engine's own word on which of them are bound to a
 * local terminal. `terminalCommands` holds command names (no slash) taken from the `init` frame's
 * `terminal_slash_commands` of a chat that ran on this CLI version: it is EMPTY until such a chat has
 * run, and a command is never badged on a guess. Served by `readClaudeCommandCatalog`.
 */
export type ClaudeCommandCatalog = {
  commands: ClaudeEngineCommand[];
  terminalCommands: ReadonlySet<string>;
};

// ---------------------------
//----------------- CLAUDE API KEYS: the door's picture of who pays for a plan run ------------

/** One payer's wall, as `claude-api status --json` draws it: `kind` is the wall's class — `usage` and `credit` wait for a timed lift, `spend`, `rate` and `refused` stop launches until the wall clears — `until` is the epoch second it lifts, or `null` when no timed lift is promised, and `detail` is the door's own sentence, drawn as data. */
export type ClaudeApiWall = { kind: 'usage' | 'credit' | 'spend' | 'rate' | 'refused'; until: number | null; detail: string };

/** One of the two key slots as the door's picture carries it — by slot and label, never by id or digest, and never with any part of the key: `set` false means the slot holds nothing; `credit_usd`, `renews_day`, `saved_at`, `cycle_ends_at`, `spent_usd` and `left_usd` are the slot's month, the last two priced at read; `window.open` says the key is spending its credit down now and `window.opens_at` the epoch it opens at (`null` when it cannot open); `wall` is what the payer stands on, or `null`. */
export type ClaudeApiKeyPicture = {
  slot: number;
  set: boolean;
  label: string;
  credit_usd: number | null;
  renews_day: number | null;
  saved_at: string | null;
  cycle_ends_at: number | null;
  spent_usd: number;
  left_usd: number | null;
  window: { open: boolean; opens_at: number | null };
  wall: ClaudeApiWall | null;
};

/** The door's whole picture (`~/.claude/scripts/claude-api status --json`), relayed by Settings' API: who plan runs ride now and why (`rides.slot` 0 is the subscription, 1 or 2 a key, `null` every payer walled), the subscription's own wall, both key slots in slot order, the house's pace in USD per hour (the spend-down window's own reading), the models a key-paid launch ran that no price row covers, and when the door read it. It holds no key and no digest. */
export type ClaudeApiPicture = {
  rides: { slot: 0 | 1 | 2 | null; why: string };
  subscription: { wall: ClaudeApiWall | null };
  keys: ClaudeApiKeyPicture[];
  pace_usd_per_hour: number;
  unpriced: string[];
  checked_at: number;
};

/** The door's answer when its picture cannot be read: the card draws "unknown" in words, never "not set", and offers the retry. */
export type ClaudeApiUnreadable = { unreadable: true };
