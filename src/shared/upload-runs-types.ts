//----------------- UPLOAD RUNS CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the Uploads view in Cerberus: every body `/api/upload-runs` answers — the overview of a window's
// upload-agent runs, one run whole, a page of one run's events — and the two frames its feed pushes when something moves.
// The surface is read-only: every body below is a GET answer, and nothing in this file is a request. Two answers are streams,
// and they are framed differently. The run's own stream (`/runs/{sid}/stream`) sends each event as a NAMED SSE event, `bubble`,
// whose `data:` is an `UploadRunEvent` (an `EventSource` listens for `bubble`, never `message`), with `id: <seq>` on every
// event but the two synthetic ones (`replay_gap`, `subscriber_dropped`: `seq: 0`, no `id:`). Its `?from=` and the browser's
// `Last-Event-ID` both name the last `seq` already held: the replay starts AFTER it. The feed (`/feed`) sends each `UploadRunsFrame`
// as a plain `data:` line, the default `message` event. Both send `: keepalive` comments between events.
//
// The one home is shadow-connector's `core/upload_engine/agent_sessions/` (/opt/shadow-connector): `runs_read.py` builds the
// overview and the run, `run_verdict.py` the verdict and its reasons, `runs_feed.py` the frames, and this file follows them
// key for key: look THERE when a shape here seems wrong, and change it there first. The walks and the confirmations keep their
// own homes, and `runs_read.py` passes them through as they are: `core/flow_kit/walk_projection.py` (`Walk`, `WalkStep`, read
// through `runs_lookup`) and `core/upload_engine/grants/by_walk.py` (`Confirmation`). The two sides edit TOGETHER: a key
// renamed on one side and not the other is a screen that quietly stops reading. CloudCLI's lane forwards every body untouched,
// so there is no third copy.
//
// Keys are snake_case on every body, as the engine writes them. Every datetime is ISO text and every id is text (a run's
// `session_id` is 12 lowercase hex; the rest are uuids). A body field is always present, a missing value written as `null`; the
// exceptions are the keys the engine leaves out when a thing has none: a reason's `count` and `detail`, a bubble's own fields.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an `import type` across that
// boundary is a bundle that cannot build.

// ---------------------------

//----------------- VOCABULARY ------------

/** Which upload a run was for: the first upload of a job, or its final. */
export type UploadType = 'initial' | 'final';

/** The window switch's three lengths, in days: the only values `?days=` takes. */
export type UploadRunsWindowDays = 7 | 30 | 90;

/**
 * What a run came to, as `run_verdict.verdict` words it. `live` while the registry holds this run as the live one — the
 * registry's word alone, never the run table's. Otherwise `hiccup` when any reason but `events_not_kept` stands, else `clean`.
 */
export type UploadRunVerdict = 'live' | 'clean' | 'hiccup';

/**
 * The verdict's colour word, which reaches paint only as a tone name: `live` is `info`, `clean` is `positive`, and a `hiccup`
 * takes the tone of its worst reason (`danger` or `warn`).
 */
export type UploadRunTone = 'info' | 'positive' | 'warn' | 'danger';

/** One reason's own tone. `neutral` is the one reason that is shown and never a hiccup (`events_not_kept`). */
export type UploadRunReasonTone = 'danger' | 'warn' | 'neutral';

/** THE CLOSED REASON VOCABULARY, worst first: all that can stand against a run. A screen words each code with a sentence of its own. */
export type UploadRunReasonCode =
  // How the run ended — at most one of these stands.
  | 'did_not_start' // danger; `detail` is why: spawn_failed, spawn_timeout, caller_disconnected, stopped_before_start
  | 'failed' // danger; `detail` is the CLI's terminal_reason
  | 'process_died' // danger; a non-zero exit code on its own; `detail` is the head of its stderr
  | 'ended_without_result' // danger; stdout closed with no result
  | 'server_restarted' // danger
  | 'survived_restart' // danger; the process outlived a restart (orphaned_live)
  | 'ran_too_long' // danger; the max-runtime watchdog
  | 'idle_too_long' // warn; the idle watchdog
  | 'stopped_by_person' // warn; `detail` is who pressed Stop
  | 'stopped_automatically' // warn; any other watchdog
  | 'ending_not_recorded' // warn; the row is open and the registry holds no such live run
  // Inside the run.
  | 'asked_you' // warn, `count`
  | 'went_quiet' // warn, `count`
  | 'rate_limited' // warn, `count`
  | 'stream_trouble' // warn, `count`
  // The flow, ARMED walks only.
  | 'walk_halted' // danger, `count`
  | 'walk_bumpy' // warn, `count`: the engine's stored `bumpy`, never re-derived
  // Shown, never a hiccup.
  | 'events_not_kept'; // neutral, `count`

// ---------------------------

//----------------- THE OVERVIEW: A WINDOW'S RUNS ------------

/**
 * One thing that stands against a run. `count` is present on the codes that count something and `detail` on those that
 * carry a word of their own (a login, a release reason, an error's first line): both are data, drawn as they arrive.
 */
export type UploadRunReason = {
  code: UploadRunReasonCode;
  tone: UploadRunReasonTone;
  count?: number;
  detail?: string;
};

/**
 * One run in the overview, and the head of one run whole. A DRY run is a test run: it is listed, and never counted clean or
 * hiccup. `ending`, `stop_reason` and `terminal_reason` are three facts and are never merged: how the run ended in the
 * registry's words (`session_ended.meta.reason`, `released:<why>`, or the boot reconcile's stamp), who asked it to end, and
 * the CLI's own report of how its turn ended. `model` is the model the run OBSERVED, never the pin. An `imported` run was
 * read back from disk after the fact: its operator answers and the server's own notes were never in the tee, so
 * `counts.answers` is 0 for it.
 */
export type UploadRunSummary = {
  session_id: string;
  /** `null` only on a dry run. */
  account_id: string | null;
  dry_run: boolean;
  imported: boolean;
  /** `null` on a dry run. */
  job_id: string | null;
  /** `null` where the launch named none. */
  upload_type: UploadType | null;
  archetype: string | null;
  customer_name: string | null;
  project_number: string | null;
  job_label: string | null;
  /** Who pressed, as the eis-app stamped it (`eis:<login>`); `null` where no launch act was matched. */
  generated_by: string | null;
  invocation_id: string | null;
  /** The CLI's own session id, which the heal ledger files this run's friction under. `null` until the CLI has said it. */
  claude_session_id: string | null;
  model: string | null;
  started_at: string;
  /** `null` while the run is open, or when its ending was lost (`ending_not_recorded`). */
  ended_at: string | null;
  /** The state machine's node as the registry last said it (`starting`, `running`, `awaiting_input`, …). */
  state: string;
  ending: string | null;
  stop_reason: string | null;
  /** The person who pressed Stop, as the eis-app stamped it. */
  stopped_by: string | null;
  terminal_reason: string | null;
  rc: number | null;
  stderr_head: string | null;
  counts: {
    turns: number;
    tool_calls: number;
    /** How many times the run stopped to ask a person something. */
    asked: number;
    answers: number;
    quiet: number;
    rate_limited: number;
    stream_errors: number;
    events: number;
    /** How many the record's queue had to drop; a run that dropped some says so as `events_not_kept`. */
    events_dropped: number;
  };
  walks: { total: number; armed: number; bumpy: number; halted: number };
  verdict: UploadRunVerdict;
  tone: UploadRunTone;
  /** Worst first; empty on a run that ran clean. */
  reasons: UploadRunReason[];
};

/**
 * One upload type's row of the overview. BOTH types are always present. `clean` and `hiccups` count the window's ARMED runs
 * of this type and never a dry one; `live` is 1 while the live run is of this type.
 */
export type UploadTypeCounts = {
  upload_type: UploadType;
  clean: number;
  hiccups: number;
  live: 0 | 1;
  /** The direction of this type's hiccup runs over the trailing 7 days against the 7 before; `null` when those 7 hold no run of the type. */
  trend: 'up' | 'down' | 'flat' | null;
  /** When the type last ran in the window; `null` with no run. */
  last_at: string | null;
};

/**
 * The body of GET /overview. `runs` is newest first and at most 2000 (`truncated` says the window held more). `live` is the
 * run the registry holds right now, or `null`. `filters` echoes what was asked. `people` is each person who pressed with how
 * many runs, and `accounts` the accounts that have runs, so a screen can offer a filter for each.
 */
export type UploadRunsOverview = {
  generated_at: string;
  window: { days: UploadRunsWindowDays; from: string; to: string };
  filters: { by: string | null; tests: 0 | 1; account: string | null };
  live: UploadRunSummary | null;
  types: [UploadTypeCounts, UploadTypeCounts];
  runs: UploadRunSummary[];
  truncated: boolean;
  people: { generated_by: string; runs: number }[];
  accounts: string[];
};

// ---------------------------

//----------------- ONE RUN WHOLE: ITS WALKS AND WHAT CAME AFTER ------------

/**
 * One step of a walk, as flow_kit's projection hands it over. `step` is `null` for a step the engine could not read (its status
 * is then `unreadable`). `status` is as the walker stored it, an open vocabulary, so a screen asks `status` whether a step is in
 * trouble, NEVER whether `reason` is there: `reason` is the step's own words (its `error`, else the facts it still lacked), and
 * a step that went fine can carry one. Names and statuses are the flow's own words, drawn as data.
 */
export type UploadWalkStep = {
  step: string | null;
  status: string;
  reason: string | null;
};

/**
 * One walk of a flow, as flow_kit's lookup reads its `upload_flow_runs` row. `armed` tells a preview from a walk made for
 * real; `mode` is the column as stored and NOT a closed set (old rows hold `armed` and `dry`), so a screen reads `armed` and
 * never `mode`. `outcome` is free text by design (`intent` while the walk is in flight, then `preview_complete`, `completed`,
 * `halted`, `error`, `refused_gate_open`, `waiting:<kind>`, …). `bumpy` is the engine's stored answer to "did that run go
 * smoothly" and `refused_count` its count of refused steps: both are `null` for a walk the engine never scored (a row older
 * than the columns, one refused before its first step, one that ended in `error`): "not known", never "clean".
 * `cleared_at` is set once a halted walk was retired by hand.
 */
export type UploadWalk = {
  id: string;
  archetype: string;
  /** The run-scoped modifier (`pause_the_clock`); `null` for a plain walk. */
  variant: string | null;
  mode: string;
  armed: boolean;
  outcome: string;
  bumpy: boolean | null;
  refused_count: number | null;
  generated_by: string | null;
  created_at: string;
  updated_at: string;
  cleared_at: string | null;
  steps: UploadWalkStep[];
};

/**
 * The person's confirmation of one armed walk: who confirmed it, through which surface, and what became of it. `walk_id` is the
 * walk confirmed (never `null` here: the lookup returns only grants that confirmed a walk it was asked about). `consumed_at` and
 * `consumed_by_run_id` say the press fired on it, and that press is one of the whole run's `presses`. `revoked_at` and
 * `revoke_reason` say it was revoked; `bookkeeping_revoke` is true when the revoke was the system's own bookkeeping (a newer
 * confirmation replaced this one, or the press found the job had moved on), and false does NOT say a person withdrew it.
 */
export type UploadConfirmation = {
  grant_id: string;
  walk_id: string;
  action_type: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  /** The surface the confirmation came through (`eis_app`, `terminal`). */
  granted_via: string;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  bookkeeping_revoke: boolean;
  consumed_at: string | null;
  consumed_by_run_id: string | null;
};

/**
 * The body of GET /runs/{sid}: the run, the walks that carry its invocation, the confirmations of its ARMED walks (`after`),
 * and the press walks those led to (`presses`). A run with no confirmation has an empty `after`: "not confirmed yet".
 */
export type UploadRunWhole = {
  run: UploadRunSummary;
  walks: UploadWalk[];
  after: UploadConfirmation[];
  presses: UploadWalk[];
};

// ---------------------------

//----------------- ONE RUN'S EVENTS ------------

/**
 * One event of a run, as the registry stamped it and the wire carried it (the browser's own bubble): `seq` is its place in
 * the run, from 1 (0 on the two synthetic kinds the stream sends and the record never holds). `kind` is a word of the
 * registry's CLOSED bubble vocabulary, kept as text here because a screen must draw a kind it does not know as a neutral
 * line with the kind as data. `role` is who spoke (`agent`, `operator`, `system`). The rest is present only where the kind
 * carries it: `text` is the words (clamped: `truncated` is `true` when it bit, and `null` on a `brief` or `operator_text`
 * bubble that was not cut, which the engine builds by hand), `tool` a tool call or its result, and `meta` the kind's own
 * facts — who answered an `operator_text` (`meta.by`), who stopped a `session_ended` (`meta.stopped_by`), where a `state` went.
 */
export type UploadRunEvent = {
  seq: number;
  ts: string;
  kind: string;
  role: string;
  text?: string;
  truncated?: true | null;
  tool?: { id: string | null; name: string | null; summary: string; ok: boolean | null };
  meta?: Record<string, unknown>;
};

/** The body of GET /runs/{sid}/events: a page of events in order, and the `seq` to ask `after=` for the next page (`null` on the last). */
export type UploadRunEventsPage = {
  events: UploadRunEvent[];
  next: number | null;
};

// ---------------------------

//----------------- THE FEED ------------

/**
 * One frame of GET /feed, pushed after the change it names committed. A frame says WHAT moved and never carries the new data:
 * a screen re-reads on it. `run` frames mark a run opened, moving to a new state, or ended; `walk` frames mark one flow walk
 * of a run writing progress (`step_cursor` is the step it stands at, `outcome` its outcome so far).
 */
export type UploadRunsFrame =
  | { type: 'run'; session_id: string; edge: 'opened' | 'state' | 'ended'; state: string; at: string }
  | { type: 'walk'; session_id: string; walk_id: string; step_cursor: string | null; outcome: string | null; at: string };
