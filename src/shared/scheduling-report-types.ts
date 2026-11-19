//----------------- SCHEDULING REPORT CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the Scheduling view in Cerberus: every body `/api/scheduling-report` answers — the overview of a window's
// scheduled-visit entries, one entry whole, and the frame its feed pushes when something moves. The surface is read-only: every
// body below is a GET answer, and nothing in this file is a request. `/overview` and `/entries/{id}` answer plain JSON. The feed
// (`/feed`) sends each `SchedulingFeedFrame` as a plain `data:` line, the default `message` event, with `: keepalive` comments between.
//
// The one home is shadow-connector's `eis_backend/scheduling_report/` (/opt/shadow-connector): `internal_routes.py` answers the
// three routes, `read.py` builds the overview, the entries and the whole, `entries.py` folds acts and sessions into entries,
// and `verdict.py` the verdict and its reasons. `contracts.py` holds the closed words of an act (`KINDS`, `SURFACES`,
// `OPENERS`, `OUTCOMES`, `CALENDAR`), each bound by a CHECK of eis-app's migration 356, so a word added there needs the
// migration, `contracts.py` and this file together. This file follows them key for key: look THERE when a shape here seems
// wrong, and change it there first. The two sides edit TOGETHER: a key renamed on one side and not the other is a screen
// that quietly stops reading. CloudCLI's lane forwards every body untouched, so there is no third copy.
//
// Keys are snake_case on every body, as the backend writes them. Every datetime is ISO text and every id is a lowercase uuid as text.
// A body field is always present, a missing value written as `null`; the one exception is a reason's `count` and `detail`.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an `import type` across that boundary
// is a bundle that cannot build.

// ---------------------------

//----------------- VOCABULARY ------------

/** The window switch's three lengths, in days: the only values `?days=` takes, 30 when left out (internal_routes.py). */
export type SchedulingWindowDays = 7 | 30 | 90;

/** What an entry did: `book` or `change` by form mode, `cancel` when its last done act was one; a direct takes its act's (entries.py). */
export type SchedulingEntryKind = 'book' | 'change' | 'cancel';

/** What an entry ended in: its last act that ended ok and was not an Undo; `nothing` when none did (entries.py). */
export type SchedulingEntryResult = 'booked' | 'changed' | 'cancelled' | 'nothing';

/** A form's report: `reported` (row held), `open` (no row, under 30 min), `not_reported` (older), `direct` (no session) (entries.py). */
export type SchedulingEntryState = 'reported' | 'open' | 'not_reported' | 'direct';

/** What an entry came to: a `hiccup` when a danger or warn reason stands, else `clean` (verdict.py). */
export type SchedulingVerdict = 'clean' | 'hiccup';

/** The colour word, which reaches paint only as a tone name: `clean` is positive; a hiccup takes its worst reason's tone (verdict.py). */
export type SchedulingTone = 'positive' | 'warn' | 'danger';

/** One reason's own tone; `neutral` is shown and never a hiccup (verdict.py). */
export type SchedulingReasonTone = 'danger' | 'warn' | 'neutral';

/** THE CLOSED REASON VOCABULARY, worst first: all that can stand against an entry; a screen words each code in a sentence (verdict.py). */
export type SchedulingReasonCode =
  // From the presses.
  | 'server_fault' // danger, `count`; an act that ended fault
  | 'scheduling_unavailable' // danger, `count`; an act that ended unavailable; `detail` is its code
  | 'calendar_failed' // danger, `count`; `detail` is the calendar's reason
  | 'no_answer' // danger, `count`; presses that got no HTTP answer (the session's `unanswered`)
  | 'crew_refused' // warn, `count`; code crew_not_confirmed_for_job_type
  | 'login_required' // warn; a 403
  | 'request_refused' // warn, `count`; outcome invalid or not_found; `detail` is the code
  // From what was offered.
  | 'nobody_offered' // warn
  | 'availability_unread' // warn
  | 'visit_unreadable' // warn; the edit form could not read the visit
  | 'no_open_times' // warn; open times were on, none came back, and somebody was offered
  // From the ending.
  | 'gave_up' // warn; a form's newest press did not end ok (verdict.py: form entry, state reported or not_reported)
  | 'undone' // warn; an Undo inside the entry, or as the very next act on the same visit
  | 'not_reported' // warn; the form's report never arrived
  // Shown, never a hiccup.
  | 'closed_without_booking' // neutral; nothing done and nothing pressed
  | 'calendar_paused' // neutral, `count`
  | 'crew_downgraded' // neutral
  | 'drive_times_not_checked' // neutral
  | 'not_best_fit' // neutral; a booked entry whose lead was not first on the list
  | 'own_time'; // neutral; open times were offered and none was picked

/** What an act asked: create, edit or cancel (contracts.py). */
export type SchedulingActKind = 'create' | 'edit' | 'cancel';

/** Outcome: 2xx `ok`, 404 `not_found`, 403 or crew refusal `refused`, 503 `unavailable`, other 4xx `invalid`, 5xx `fault` (contracts.py). */
export type SchedulingOutcome = 'ok' | 'refused' | 'not_found' | 'invalid' | 'unavailable' | 'fault';

/** The calendar's state on an act's answer (contracts.py). */
export type SchedulingCalendar = 'none' | 'paused' | 'confirmed' | 'error';

/** Where a press came from; `api` for a request that named none (contracts.py). */
export type SchedulingSurface = 'form' | 'grid_move' | 'grid_resize' | 'undo' | 'api';

/** The door the form was opened from (contracts.py). */
export type SchedulingOpener =
  | 'schedule_new' | 'schedule_slot' | 'schedule_drag' | 'schedule_visit'
  | 'calendar_entry' | 'unscheduled_list' | 'job_schedule_band' | 'work_list'
  | 'call_script' | 'carrier_region' | 'unknown';

/** Who pressed: a person, or a machine (machine entries never count toward clean or hiccup) (contracts.py). */
export type SchedulingActorKind = 'person' | 'machine';

/** The form's mode as it was opened (contracts.py). */
export type SchedulingSessionMode = 'create' | 'edit';

// ---------------------------

//----------------- THE OVERVIEW: A WINDOW'S ENTRIES ------------

/**
 * One thing that stands against an entry, or a neutral one shown beside it (verdict.py). `count` and `detail` are present only on
 * the codes that carry them; both are data, drawn as they arrive.
 */
export type SchedulingReason = {
  code: SchedulingReasonCode;
  tone: SchedulingReasonTone;
  count?: number;
  detail?: string;
};

/** A person on the roster as `technician_people()` names them (read.py); `name` is `null` for an id the roster no longer holds. */
export type SchedulingPerson = {
  id: string;
  name: string | null;
};

/** The job's label from v_job_list (read.py); each field is `null` when the view does not list the job. */
export type SchedulingJob = {
  id: string;
  customer_name: string | null;
  project_number: string | null;
  loss_type: string | null;
};

/** An entry's presses, counted by how they ended (entries.py). */
export type SchedulingPresses = {
  total: number;
  ok: number;
  refused: number;
  failed: number;
};

/**
 * One entry in the window (entries.py folds it; verdict.py gives `verdict`, `tone` and `reasons`). A FORM entry is the acts sharing
 * one session id, with that session's row when it has landed, and its id is the session id. A DIRECT entry is one act with no
 * session, and its id is the act's id. It sits in the window by when it started: the session's `started_at`, else its first act's `created_at`.
 */
export type SchedulingEntry = {
  id: string;
  form: boolean;
  state: SchedulingEntryState;
  account_id: string;
  actor: string; // `eis:<login>`
  actor_kind: SchedulingActorKind;
  kind: SchedulingEntryKind;
  result: SchedulingEntryResult;
  opener: SchedulingOpener | null; // a form entry's; null on a direct one, or on a form whose report has not landed
  surface: SchedulingSurface | null; // a direct entry's; null on a form one
  job: SchedulingJob | null;
  visit_id: string | null;
  started_at: string;
  ended_at: string | null;
  open_seconds: number | null;
  presses: SchedulingPresses;
  lead: SchedulingPerson | null;
  verdict: SchedulingVerdict;
  tone: SchedulingTone;
  reasons: SchedulingReason[]; // worst first; neutral ones included
};

/**
 * One kind's row of the overview (read.py); all three kinds are always present. `clean` and `hiccups` count PEOPLE's entries
 * of the window, never a machine's. `trend` is the kind's hiccup entries over the trailing 7 days against the 7 before, `null`
 * when those 7 hold none of the kind.
 */
export type SchedulingKindCounts = {
  kind: SchedulingEntryKind;
  clean: number;
  hiccups: number;
  trend: 'up' | 'down' | 'flat' | null;
  last_at: string | null;
};

/**
 * The body of GET /overview (internal_routes.py answers it; read.py builds it). Entries are newest first, at most 2000
 * (`truncated` says the window held more). `filters` echoes the ask: `machines` false leaves machine entries out of `entries`,
 * `openers` and `people`; `by` and `account` narrow all of them. `accounts` lists the accounts with entries, so a screen can
 * offer a filter for each.
 */
export type SchedulingOverview = {
  generated_at: string;
  window: { days: SchedulingWindowDays; from: string; to: string };
  filters: { by: string | null; machines: boolean; account: string | null };
  kinds: [SchedulingKindCounts, SchedulingKindCounts, SchedulingKindCounts];
  entries: SchedulingEntry[];
  truncated: boolean;
  openers: { opener: SchedulingOpener; entries: number }[];
  people: { actor: string; entries: number }[];
  accounts: string[];
};

// ---------------------------

//----------------- ONE ENTRY WHOLE: ITS ACTS, ITS FORM AND WHAT CAME AFTER ------------

/**
 * One answered request to a scheduled-visit write route, recorded at the API's own door (read.py). `start_at`, `end_at`, `visit_type`
 * and the crew are the answer's on a 2xx, else what was asked; a refused cancel carries none of them.
 */
export type SchedulingAct = {
  id: string;
  at: string;
  kind: SchedulingActKind;
  surface: SchedulingSurface;
  session_id: string | null;
  actor: string;
  actor_kind: SchedulingActorKind;
  status: number; // the HTTP status answered
  outcome: SchedulingOutcome;
  code: string | null; // the answer's own code, never its free text
  calendar: SchedulingCalendar;
  calendar_reason: string | null;
  crew_downgraded: boolean;
  start_at: string | null;
  end_at: string | null;
  visit_type: string | null;
  lead: SchedulingPerson | null;
  support: SchedulingPerson[];
  touched: string[]; // an edit's touched fields
  latency_ms: number; // the server's own measure
};

/** What the door proposed when the form opened (read.py). */
export type SchedulingProposal = {
  job_id: string | null;
  visit_type: string | null;
  trust: string | null;
};

/** What the form offered at its last press, or at close (read.py). */
export type SchedulingOffered = {
  roster_count: number;
  available_count: number;
  best_fit_id: string | null;
  none_offered: boolean;
  availability_unread: boolean;
  gate_warn: boolean;
  left_out_count: number;
  slots_count: number;
  slots_on: boolean;
  travel_checked: boolean;
  hint_crew: number | null;
  hint_hours: number | null;
};

/** What the person chose (read.py); `lead_rank` 0 is the best fit, `null` when the lead was not on the list. */
export type SchedulingChosen = {
  lead_id: string | null;
  lead_rank: number | null;
  lead_available: boolean | null;
  support_count: number;
  temp_count: number;
  start_at: string | null;
  duration_minutes: number;
  slot_picked: boolean;
  visit_type: string;
  type_changed: boolean;
  job_changed: boolean;
  duration_stepped: boolean;
};

/** The form's report as stored: ids, counts and flags only, with the best fit named (read.py). */
export type SchedulingSession = {
  mode: SchedulingSessionMode;
  opener: SchedulingOpener;
  proposal: SchedulingProposal;
  offered: SchedulingOffered;
  chosen: SchedulingChosen;
  presses: number;
  unanswered: number; // presses that got no HTTP answer
  edit_unreadable: boolean; // the edit form could not read the visit
  best_fit: SchedulingPerson | null;
};

/** The visit as it stands now, read through the scheduling module (read.py); `status` is the visit row's own word, drawn as data. */
export type SchedulingVisitNow = {
  status: string;
  start_at: string | null;
  end_at: string | null;
  visit_type: string | null;
  cancelled_at: string | null;
};

/**
 * The body of GET /entries/{id} (internal_routes.py answers it; read.py builds it), 404 for an unknown entry. `session` is `null`
 * on a direct entry and on a form whose report has not landed. `acts` is this entry's, oldest first; `after` is the later acts on
 * the same visit that belong to other entries, oldest first.
 */
export type SchedulingEntryWhole = {
  entry: SchedulingEntry;
  session: SchedulingSession | null;
  acts: SchedulingAct[];
  visit_now: SchedulingVisitNow | null; // null when the entry wrote no visit
  after: SchedulingAct[];
};

// ---------------------------

//----------------- THE FEED ------------

/**
 * One frame of GET /feed (internal_routes.py), pushed once per pulse after an act or a session row committed. It names nothing:
 * no row, id or account rides it, so a screen re-reads on it.
 */
export type SchedulingFeedFrame = { type: 'changed' };

// ---------------------------
