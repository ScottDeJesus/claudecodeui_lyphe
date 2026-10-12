//----------------- CERBERUS CONTRACTS ------------
// The client's view of Cerberus, the monitoring tab: every shape the tab reads off a wire or hands
// back to it — the status vocabulary, the read model, the definition and enrollment documents, the
// hint frame that says "read again" and the two frames that carry a fix's output lines and a
// diagnosis's steps as they arrive.
//
// It mirrors `server/shared/cerberus-types.ts` field for field, and that file is the home: look
// there when a shape here seems wrong, and add a frame or a read-model field there first. The two
// edit TOGETHER: a field renamed on one side and not the other is a screen that quietly stops
// reading.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// The browser never sees the warden wire. Its frames, envelopes, signatures and the four server-only
// seam types stay in the server file; the wire-born shapes repeated here are `CerberusProbeSpec`,
// because the definition document carries probes as their spec, `CerberusRunLine`, because a
// fix's output reaches the tab as the lines a warden sent, and `CerberusUpdateStep`, because an
// update's steps reach the tab as the words a warden sent.
//
// Every time is epoch MILLISECONDS and every duration (`every`, `timeout`, `cadence`, `staleAfter`)
// is SECONDS. JSON is camelCase, as it is on every Cerberus wire.

// ---------------------------

//----------------- VOCABULARY ------------

/**
 * The four statuses a result row's `status` can carry in the store: the only ones ever written
 * there. `ok`, `warn` and `failing` come from a probe's own verdict or a health document's green,
 * yellow and red; `denied` is the only red — a command the warden refused or a credential that was
 * said no to. A result with no status at all (`null`) means "not enabled" and `status` stores it as
 * null; only a row's `prev_status` spells it, as `not_enabled`, when the row before it had none.
 */
export type CerberusStoredStatus = 'ok' | 'warn' | 'failing' | 'denied';

/**
 * Every word a check can show on screen: the four stored ones plus the four worked out when the
 * screen reads and never written — `not_enabled` (the latest result's document status was muted:
 * the service has the feature switched off), `unknown` (no result within `staleAfter`, never shown
 * as passing), `muted` (warn/failing/denied while an unexpired mute covers the check) and `paused`
 * (the node's warden is restarting for an update). Read model only; no warden frame carries one of
 * the last four.
 */
export type CerberusStatus = CerberusStoredStatus | 'not_enabled' | 'unknown' | 'muted' | 'paused';

/**
 * A health document's own status for one component, as the service wrote it. A warden sends it
 * beside the mapped `CerberusStoredStatus` so the screen can say what the document said; `muted`
 * here is the service's switch, never Cerberus's mute.
 */
export type CerberusDocStatus = 'green' | 'yellow' | 'red' | 'muted';

/**
 * How a probe observes. `health_doc` fetches a service's health document and fans it out into one
 * result per component; the other five each report exactly one check. A `CerberusCheckView` carries
 * `'self'` instead of one of these when center is checking itself.
 */
export type CerberusProbeKind = 'health_doc' | 'http' | 'tcp' | 'exec' | 'file_age' | 'sql';

/**
 * The six words a warden reports an update's progress in, in the order a healthy update says them:
 * `waiting` (a fix or diagnosis is running and the restart will not interrupt it — said before the
 * upload, said again after `verified` when work started in the seconds between, and not said at all
 * when nothing is running), `uploading` (fetching the release), `verified` (its SHA-256 equals the
 * offer's, or the warden is already on the offered version), `swapping` (the new release is extracted
 * and `current` points at it), `restarting` (the warden is about to exit for its launcher to start
 * the new release) and `failed` (the warden gave up on the offer; `text` says why). Center files its
 * own last step under `failed` too, when an update ends other than by the warden's word (a rollback,
 * a silence), so how an update ended is read from `CerberusUpdateView.result`, never
 * from a `failed` step. Carried by every step of a `CerberusUpdateView`.
 */
export type CerberusUpdateStep =
  'waiting' | 'uploading' | 'verified' | 'swapping' | 'restarting' | 'failed';

// ---------------------------

//----------------- READ MODEL ------------

/**
 * A silence on one check, appended when a person mutes it and never edited but for `liftedAt`. While
 * it is unexpired and unlifted, a warn, failing or denied reading of its check shows `muted`; the
 * warden never hears of it, so a muted check keeps running and recording. `check` is the check key,
 * `by` who set it, `liftedAt` null until someone lifts it early. Answered by `POST /mutes` and
 * `POST /mutes/:id/lift`; carried inside every `CerberusCheckView` and `CerberusLookup` it covers.
 */
export type CerberusMute = {
  id: string;
  node: string;
  check: string;
  from: number;
  until: number;
  reason: string;
  by: string;
  liftedAt: number | null;
};

/**
 * One cell of a strip: the status over `[from, to)`, the worst status inside that window with the
 * mute and silence laid over it. `worst` is the check key that set the cell's status when the strip
 * folds several checks (a service's strip), null when it is one check's own or nothing set it.
 * `paused` takes part as a rank, not as a silence: it ranks with `muted`, above `ok` and
 * `not_enabled`, so it replaces every word below `warn` — `ok`, `not_enabled` and `unknown`, a
 * restart being the reason a check went unheard — in every cell its window touches, and a restart
 * never hides a reading that already needs attention (`warn`, `failing`, `denied`).
 * `at` is the first moment inside the cell's window (clipped at now) at which its word held, so a
 * lookup of the check `worst` names, at `at`, answers the cell's word: the moment a stored row
 * raised it, a lapse began, a silence began, a restart began or a mute took it, else the window's
 * first moment — moved past a mute that ran out, or a restart that ended, inside the window. A
 * minute's last second is not that moment — it can already read what came after. A minute whose
 * word came and went under a mute or a restart (the reading recovered before the mute began, or
 * before the cover ended) has no such moment, and `at` is then the nearest one inside the window.
 */
export type CerberusCell = {
  from: number;
  to: number;
  status: CerberusStatus;
  worst: string | null;
  at: number;
};

/**
 * One check as the screen reads it, now. `key` is `<service>/<id>` and `id` is the part after the
 * first `/`; `label` and `serviceLabel` are the plain-English names, null until one is written (the
 * key stands in on screen). `status` is the shown word and `stored` the stored status under it
 * (null when none, which is also what "not enabled" is); `value` is the sentence and `at` the
 * moment it is for; `since` is when `status` began. `every` and `staleAfter` are seconds. `origin`
 * says where the check came from — `component` (fanned out of a health document), `probe` (a probe
 * that reports exactly it) or `self` (center's own checks); `kind` is the probe kind, or `self`.
 * `mute` is the unexpired mute covering it, if any.
 */
export type CerberusCheckView = {
  node: string;
  key: string;
  service: string;
  id: string;
  label: string | null;
  serviceLabel: string | null;
  status: CerberusStatus;
  stored: CerberusStoredStatus | null;
  value: string | null;
  at: number | null;
  since: number | null;
  every: number;
  staleAfter: number;
  origin: 'component' | 'probe' | 'self';
  kind: CerberusProbeKind | 'self';
  mute: CerberusMute | null;
};

/**
 * One service on one node: its worst status folded from its checks, the checks themselves, a strip
 * of recent cells, and the counts the header row prints. `total` leaves out `not_enabled` checks,
 * which `notEnabled` counts on their own, and retired checks are in no count; `needsYou` is the
 * warn, failing and denied ones that are not muted.
 */
export type CerberusServiceView = {
  node: string;
  service: string;
  label: string | null;
  status: CerberusStatus;
  checks: CerberusCheckView[];
  cells: CerberusCell[];
  counts: {
    total: number;
    passing: number;
    needsYou: number;
    muted: number;
    notEnabled: number;
    unknown: number;
  };
};

/**
 * One project assigned to a node, as the node card lists it: the project's id (what
 * `PUT /api/projects/:projectId/node` takes), its custom name or else its folder's name, and its folder on
 * this machine.
 */
export type CerberusNodeProject = {
  projectId: string;
  name: string;
  path: string;
};

/**
 * One node as the fleet shows it. `role` is `hub` for center's own node and `node` for every warden.
 * The hub has no warden and no link state: its `link` is `reporting`, its `lastHeardAt` is the
 * moment of its newest self-check, its `wardenVersion`, `silentSince` and `enrolledAt` are null, and
 * no silence is laid over its checks.
 * For a warden, `link` is decided in this order: `never` when the node has no first heartbeat on
 * record (the tab says "Waiting for the first heartbeat"; it wins over `silent`, so a boot does not
 * turn it into one), else `reporting` when heard within 90 s, else `silent`. `lastHeardAt` is the
 * last frame of any kind, and when nothing has been heard since this boot it is the node row's
 * stored last heartbeat; `silentSince` is that plus 90 000 while silent, null otherwise.
 *
 * `paused` is the fourth link word, and it is never a silence: it is a node whose warden is
 * restarting under an update, from the update's `restarting` step until the update ends (its new
 * hello, the launcher's rollback hello, or the update's failure). The link is down by design for
 * those seconds, so it wins over `silent` and over `never`, `silentSince` is null while it holds, and
 * it is the same window the node's checks show as `paused`. It is laid over by the read model from
 * the update's steps and is not a state the warden's link ever reports. The hub is never paused.
 * `updating` is the node's update while one is queued or running — null otherwise, and always null
 * for the hub: `step` is the update's latest word (`queued` while it waits its turn in the batch),
 * `text` its sentence, `index` the node's place in its batch counting from 1 and `of` the batch's
 * size.
 *
 * The three fields of the node's sessions: `colocated` is whether the node runs on THIS machine
 * (the only kind that can take a project), `projects` lists the projects assigned to it, by folder,
 * and `sessions` counts the hosts its warden last listed. The hub is none of these: `colocated`
 * false, no projects, no sessions. A node's `sessions` is 0 before its warden has been asked, and
 * only moves when a re-adoption or a fresh list refreshes the cache.
 */
export type CerberusNodeView = {
  id: string;
  desc: string | null;
  role: 'hub' | 'node';
  link: 'reporting' | 'silent' | 'never' | 'paused';
  wardenVersion: string | null;
  lastHeardAt: number | null;
  silentSince: number | null;
  enrolledAt: number | null;
  colocated: boolean;
  projects: CerberusNodeProject[];
  sessions: number;
  updating: { step: CerberusUpdateStep | 'queued'; text: string; index: number; of: number } | null;
  services: CerberusServiceView[];
};

/**
 * One warden release, as `dist-warden/latest.json` names it: `version` is `major.minor.patch`,
 * `note` the one line of `warden/package.json`'s `cerberus.note` it was built with — what changed,
 * in words for a person, and a build refuses to ship a release without one — and `builtAt` when it
 * was built, epoch milliseconds (the file itself writes ISO text; center reads it into this unit).
 * Carried by `CerberusWardens.latest`.
 */
export type CerberusWardenRelease = { version: string; note: string; builtAt: number };

/**
 * One warden update — one node taken from one release to another — as the tab reads it. `batch` is
 * the id of the `POST /updates` that began it, shared by every node that call named; `node` the node
 * and `to` the release offered; `from` the version the node reported when the update began (null
 * when it had reported none). `startedAt` is when the update was queued and `endedAt` when it ended
 * (null while it runs); every time here, those two and each step's `at`, is center's clock — the
 * moment center stored it — so it compares directly with a result's cells and with now. `step` is
 * the update's latest word: `queued` until the warden's first `update.progress` (the update waits its
 * turn, one node at a time), then the `CerberusUpdateStep` of the newest one. `result` is null until
 * it ends, then `updated` (the node's next hello named `to`, or, for a node already on the release,
 * which never restarts, its `verified` step), `rolled_back` (its hello named the release it was
 * taken back from — the launcher swapped the old release back in) or
 * `failed` (the warden gave up, or said nothing for three minutes — ten after a `waiting` step, the
 * warden's own limit for a fix it waits on). `steps` is every word of the
 * update in order, each with its time and sentence. When an update ends other than by the warden's
 * word (a rollback, a silence), center adds the sentence as the last step, filed under
 * `failed`: `result`, never a `failed` step, says how the update ended. Updates and their steps are
 * kept forever.
 */
export type CerberusUpdateView = {
  id: string;
  batch: string;
  node: string;
  from: string | null;
  to: string;
  startedAt: number;
  step: CerberusUpdateStep | 'queued';
  endedAt: number | null;
  result: 'updated' | 'rolled_back' | 'failed' | null;
  steps: { at: number; step: CerberusUpdateStep; text: string }[];
};

/**
 * What `POST /api/cerberus/updates` answers when a warden update batch starts: the batch's id and its
 * updates as they stood, one per node named, all `queued`. The same updates come back from
 * `GET /api/cerberus/updates/:batch`, which the Update wardens dialog reads again to follow the batch.
 */
export type CerberusStartedBatch = { batch: string; updates: CerberusUpdateView[] };

/**
 * What `GET /api/cerberus/wardens` answers: where the fleet's wardens stand against the release
 * center holds. `latest` is the newest release built (null when none has been); `nodes` lists every
 * enrolled node with the warden version it last reported (null before it has) and `behind` — true
 * when `latest` is set and the node's version is older than it, a null version counting as older;
 * `running` is every update of the batch that is running now, the ended ones included until the whole
 * batch ends so a header can say "2 of 3", and empty when no batch is running. The tab reads it
 * again on `cerberus_changed`.
 */
export type CerberusWardens = {
  latest: CerberusWardenRelease | null;
  nodes: { node: string; version: string | null; behind: boolean }[];
  running: CerberusUpdateView[];
};

/**
 * One fix in the catalog, as the Fixes tab, a need and a check's sheet read it: a check paired with
 * one command to run on its node. `id` is the entry's slug (its name's, then `-2`, `-3` when taken)
 * and `check` the check key it is for; `checkLabel` and `serviceLabel` are that check's and its
 * service's plain names, null until one is written (the key stands in on screen). `when` is the
 * status that makes it apply — `failing`, or `warn` for a check nearing its limit; see
 * `CerberusNeed.fix` for which current statuses satisfy which. `cmd` is the exact command, run by
 * the node's warden as written, and `timeout` its seconds. `auto` says whether Cerberus runs it on
 * its own when the check moves into `when`; `limit` bounds that — at most `runs` runs in any `per`
 * seconds (3600 or 86400), however often the check keeps failing; `capped` is null, or the reason
 * the entry may never run on its own (auto stays off and its switch is locked: a settled decision,
 * not a fault). `recheck` asks for the check's probe to run again as soon as a run ends `ok`; a run that failed,
 * timed out or was refused asks for none. `origin`
 * says where the entry came from — written by a person (`by`, `at`) or promoted from a diagnosis
 * (`diagnosis` its id, `at` when it was promoted). The `diagnosis` member is promotion's alone:
 * `POST /api/cerberus/diagnoses/:id/promote` writes it, and `POST /api/cerberus/catalog` only ever
 * writes `written`; the entry then points back at the diagnosis whose `CerberusDiagnosisView.promotedTo`
 * points at it. `stats` counts the entry's runs that have ended: `runs` all of them, `ok` those
 * that succeeded, `lastRunAt` when the newest ended (null when none has). Answered by
 * `GET /api/cerberus/catalog`, `POST /api/cerberus/catalog` and `PUT /api/cerberus/catalog/:id/auto`.
 */
export type CerberusCatalogEntryView = {
  id: string;
  node: string;
  check: string;
  checkLabel: string | null;
  serviceLabel: string | null;
  name: string;
  when: 'failing' | 'warn';
  cmd: string;
  timeout: number;
  auto: boolean;
  limit: { runs: number; per: number };
  capped: string | null;
  recheck: boolean;
  origin:
    | { kind: 'written'; by: string; at: number }
    | { kind: 'diagnosis'; diagnosis: string; at: number };
  createdAt: number;
  stats: { runs: number; ok: number; lastRunAt: number | null };
};

/**
 * The body of `POST /api/cerberus/catalog`: the fields of a fix a person writes, whose answer is the
 * new `CerberusCatalogEntryView` (its `origin` is "written by" the signed-in user; `auto` always
 * starts off — `PUT /api/cerberus/catalog/:id/auto` is the one way to switch it). `node` and `check`
 * name an active check of an enrolled node; `name` is the entry's words (its slug becomes the id);
 * `when` must be `failing` or `warn`; `cmd` is run exactly as written; `timeout` is whole seconds,
 * 1 to 3600; `limit.runs` is 1 to 10 and `limit.per` 3600 or 86400 seconds. `recheck` defaults to
 * true. `capped` is the reason the entry may never run on its own, or null/absent when it may.
 * Every field the service refuses is a 400 `CERBERUS_BAD_ENTRY` naming it; a field of the wrong
 * kind (`timeout` as text) is a 400 `CERBERUS_BAD_REQUEST`.
 */
export type CerberusCatalogEntryInput = {
  node: string;
  check: string;
  name: string;
  when: string;
  cmd: string;
  timeout: number;
  limit: { runs: number; per: number };
  recheck?: boolean;
  capped?: string | null;
};

/**
 * One line of a fix's output: `n` is its place in the run, counting up from 1, and its identity —
 * a run never holds the same `n` twice; `t` is the seconds since the run started; `stream` is `out`
 * for what the command wrote on stdout and `err` for stderr; `line` is its text without the line
 * break. Lines are kept with their offset so the sheet can replay them at the pace they arrived.
 * Carried by `CerberusRunView.lines` and by every `CerberusRunOutputEvent`.
 */
export type CerberusRunLine = { n: number; t: number; stream: 'out' | 'err'; line: string };

/**
 * One run of a fix, as the tab reads it. `entry` is the catalog entry it ran, null when it ran a
 * diagnosis's proposal straight from the diagnosis (`diagnosis` is then that diagnosis's id, and
 * null otherwise); `name` is the entry's or the proposal's; `node` and `check` the check it was for;
 * `by` whether Cerberus's own rule (`auto`) or a person (`you`) started it; `cmd` exactly what was
 * sent to the warden. `requestedAt` is when center asked, by center's clock; `startedAt` is when the
 * warden accepted and began (null until it does, and for good on a run that was refused) and
 * `endedAt` when it ended (null while it runs). All three are center's clock: center brings the times
 * a warden reports onto its own with the node's clock offset when it stores them, never past the moment
 * it heard them and never before the run was asked for, so a run's moments compare with each other and
 * with now without a correction. `result` is null until it ends, then `ok` (exit 0), `failed` (any other exit, or a
 * run that could not finish — `note` says why), `refused` (the warden would not run it; drawn red)
 * or `timed_out`; `exit` is the exit code, null when there is none. `note` is one sentence for a
 * person, set when the run ended other than by its command's own exit — the warden's refusal
 * reason, "The warden restarted while it ran; the output ends where the link did." — and null
 * otherwise. `lastLine` is the text of the newest output line and `lastN` its number — the `n` its
 * `CerberusRunLine` carries, so a reader holding a line from a `cerberus_run_output` frame can tell whether the
 * overview has read past it (both null before any line). `lines` is every
 * line, present only where one run is asked for by itself (`GET /api/cerberus/runs/:id` and a
 * check's sheet); the overview and a need leave it off. Runs are kept for good; their output lines
 * for 90 days.
 */
export type CerberusRunView = {
  id: string;
  entry: string | null;
  diagnosis: string | null;
  name: string;
  node: string;
  check: string;
  by: 'auto' | 'you';
  cmd: string;
  requestedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  result: 'ok' | 'failed' | 'refused' | 'timed_out' | null;
  exit: number | null;
  note: string | null;
  lastLine: string | null;
  lastN: number | null;
  lines?: CerberusRunLine[];
};

/**
 * One row of "Needs you": a check whose current status is warn, failing or denied and unmuted.
 * `fix` is the catalog entry offered for it: the first unretired entry on the check — oldest first —
 * whose `when` the current status satisfies. A failing check satisfies `failing` and `warn` entries,
 * a warn check satisfies `warn` entries, and a denied check is offered what a failing one is but is
 * never run on its own. Null when no entry applies. `run` is the check's active run (the newest whose
 * `ended_at` is NULL) whatever its `since`, so the card never offers Run beside a run that is going;
 * failing that, the check's newest run requested since the check's `since`, for 90 s after it ended —
 * null when there is none (a check whose `since` is null shows no ended run). `since` is on the
 * warden's clock (`since` of a health document's check, on its service's) and a run's times and now
 * on center's, so the one comparison across them applies the node's clock offset to `since`. The
 * card draws its strip from `run` and offers `fix` only
 * while no run is going. `diagnosis` is the check's newest diagnosis requested since the same
 * `since` — running or ended, whatever its outcome, with the same clock rule as `run` — null when
 * there is none, or when `since` is: the card says "Diagnose" while it is null and "Diagnosing…" or
 * "See diagnosis" once it is not. It carries its `steps`, and its own `run` without `lines`.
 */
export type CerberusNeed = {
  check: CerberusCheckView;
  fix: CerberusCatalogEntryView | null;
  run: CerberusRunView | null;
  diagnosis: CerberusDiagnosisView | null;
};

/**
 * One thing a diagnosis said as it worked: `n` is its place in the diagnosis, counting up from 1,
 * and its identity — a diagnosis never holds the same `n` twice; `t` is the seconds since the
 * diagnosis started (center's clock); `text` is one line for a person. CENTER writes what the session
 * DID, in fixed words: an opening step ("Opened a read-only session on eis1"), one step per tool
 * call generated from the call's arguments ("Reading the journal of docstore.service · last 15
 * min", "Reading Cerberus history: <label> since 17:40") and a closing step ("Closed the session ·
 * nothing was changed"), and the one that says a node is out of reach ("<node>'s warden is not
 * connected: this diagnosis reads Cerberus history only"). The AGENT writes only what it FOUND,
 * through its `note` tool, one sentence each ("All 4 failed on one call — 401 from shadow
 * connector"). Kept for good, as the diagnosis is. Carried by `CerberusDiagnosisView.steps` and by
 * every `CerberusDiagStepEvent`.
 */
export type CerberusDiagnosisStep = { n: number; t: number; text: string };

/**
 * One diagnosis of one check, as the tab reads it: a read-only agent's look at a failing check, from
 * the question to what it found and what it proposes. `id` names it; `node` and `check` the check it
 * was for (`check` is the check key); `askedBy` who asked, `model` the model that ran it. Every time
 * is center's clock. `startedAt` is when it was asked, `endedAt` when it ended (null while it runs).
 * `status` is `running`, `done` (the agent submitted a diagnosis) or `failed` (the link was lost,
 * the agent ended without submitting, the ceiling of three minutes passed, or center could not
 * start it — `error` says which, in one sentence for a person, and is null otherwise).
 *
 * What a `done` diagnosis found: `summary` is one or two sentences saying what is wrong (null until
 * it is done, and on a failed one); `evidence` is each thing it FOUND that says so, one line each,
 * quoting what the journal, the file, the status or Cerberus's history actually said — the absence
 * of an error is never evidence and is never listed; `proposal` is the one fix it suggests, or null
 * when it suggests none. A proposal's `name` is what the fix button will say, `cmd` is the exact
 * command the diagnosis would run now (it may name an absolute time, `--since 17:50`), and `general`
 * is the same command with each absolute time made a relative window (`--since "15 min ago"`),
 * which is what promotion saves as a catalog entry's command — equal to `cmd` when nothing needed
 * generalising.
 *
 * `steps` are everything it said as it worked, in order. `oneOffExpiresAt` is when the one-off the
 * warden holds for `proposal` expires — the proposal is published to the node's catalog as a
 * one-off — null when there is no proposal or none is published; past it, running the proposal is
 * refused. `run` is the run of that one-off, null until someone presses "Run it once" (a run of a
 * diagnosis's proposal never touches the catalog); it carries `lines` where the diagnosis is asked
 * for by itself (`GET /api/cerberus/diagnoses/:id` and a check's sheet) and leaves them off inside a
 * need. `promotedTo` is the id (the slug) of the catalog entry the diagnosis was promoted into, null
 * until it is (that entry's `origin` points back here); the tab resolves the id against the catalog
 * entries it holds to show the entry's current name — the person may have renamed it in the dialog,
 * so `proposal.name` is not it — and shows the id itself when that entry has since been retired and
 * is no longer there. Diagnoses are kept for good; so are their steps.
 *
 * Two words are worked out by center, not stored with the diagnosis. `when` is the word an entry made of
 * this diagnosis would carry: `warn` when the check was only nearing its limit when the diagnosis began,
 * else `failing` — the check's STORED status at the diagnosis's start, the very word promotion writes, so
 * the Promote dialog shows what will be written and not a guess from the check's status now. `scope` is
 * `node` when the diagnosis was given the node's reads and `history` when it could read only Cerberus
 * history (the hub, a node that was not connected, busy or updating, or whose warden did not answer): its
 * first step says which, and a diagnosis with no step yet reads `node`.
 * Answered by `GET /api/cerberus/diagnoses/:id` and carried by `CerberusNeed.diagnosis` and
 * `CerberusCheckDetail.diagnosis`; `POST /api/cerberus/diagnoses` answers only its `id`.
 */
export type CerberusDiagnosisView = {
  id: string;
  node: string;
  check: string;
  askedBy: string;
  model: string;
  startedAt: number;
  endedAt: number | null;
  status: 'running' | 'done' | 'failed';
  summary: string | null;
  evidence: string[];
  proposal: { name: string; cmd: string; general: string } | null;
  error: string | null;
  steps: CerberusDiagnosisStep[];
  when: 'failing' | 'warn';
  scope: 'node' | 'history';
  oneOffExpiresAt: number | null;
  run: CerberusRunView | null;
  promotedTo: string | null;
};

/**
 * One line of "What happened", a union on `kind`. `check` is a check's status moving from one word
 * to another (`not_enabled` spells a null on either side); `mute` is a mute being set, lifted or
 * expiring; `node` is a node enrolling; `fix` is a run starting (`started`, `result` and
 * `durationS` null) or ending (`ended`, with its `result` — `refused` included — and `durationS`,
 * the seconds from start to end, null for a refusal that never started); `catalog` is an entry
 * being `added` or its auto-run switched `auto_on` or `auto_off`, `by` whoever did it; `warden` is
 * a warden update: `update_started` is a whole batch beginning (`node` null, `from` null, `nodes`
 * the number of nodes it took, `to` the release), and `updated`, `rolled_back` and `update_failed`
 * are one node's update ending (`node` named, `from` the version it left, `to` the release it was
 * offered, no `nodes`); `diagnosis` is a diagnosis being `asked` (its `at` the moment it was asked,
 * `summary` null), `ready` (its `at` the moment it ended `done`, `summary` the diagnosis's own) or
 * `failed` (`summary` the sentence that says why — the diagnosis's `error`); `diagId` names it and
 * `label` is the check's label as it reads now, null when it has none or the check is retired. A
 * reader switches on `kind` and ignores a kind it does not know.
 */
export type CerberusActivity =
  | {
      kind: 'check';
      at: number;
      node: string;
      check: string;
      label: string | null;
      serviceLabel: string | null;
      from: CerberusStatus;
      to: CerberusStatus;
      value: string | null;
    }
  | {
      kind: 'mute';
      at: number;
      node: string;
      check: string;
      label: string | null;
      serviceLabel: string | null;
      event: 'muted' | 'lifted' | 'expired';
      until: number;
      reason: string;
      by: string;
    }
  | {
      kind: 'node';
      at: number;
      node: string;
      event: 'enrolled';
      wardenVersion: string | null;
    }
  | {
      kind: 'fix';
      at: number;
      node: string;
      check: string;
      runId: string;
      name: string;
      by: 'auto' | 'you';
      event: 'started' | 'ended';
      result: 'ok' | 'failed' | 'refused' | 'timed_out' | null;
      durationS: number | null;
    }
  | {
      kind: 'catalog';
      at: number;
      entry: string;
      name: string;
      event: 'added' | 'auto_on' | 'auto_off';
      by: string;
    }
  | {
      kind: 'warden';
      at: number;
      node: string | null;
      event: 'update_started' | 'updated' | 'rolled_back' | 'update_failed';
      from: string | null;
      to: string;
      nodes?: number;
    }
  | {
      kind: 'diagnosis';
      at: number;
      node: string;
      check: string;
      label: string | null;
      diagId: string;
      event: 'asked' | 'ready' | 'failed';
      summary: string | null;
    };

/**
 * What `GET /api/cerberus/overview` answers: the whole fleet at `now`. `nodes` is hub first;
 * `needsYou` sorts by `since` then key; `muted` lists the checks a mute is covering; `running` is
 * every fix run that has not ended, oldest first and without `lines` — what marks a node or a
 * service as fixing; `activity` is the newest seven lines of "What happened"; `lastResultAt` is the
 * latest `at` of any stored result; `gateway` says whether the warden listener is bound and where.
 * `counts` excludes `not_enabled` and retired checks.
 */
export type CerberusOverview = {
  now: number;
  nodes: CerberusNodeView[];
  needsYou: CerberusNeed[];
  muted: CerberusCheckView[];
  running: CerberusRunView[];
  counts: { checks: number; passing: number; needsYou: number; muted: number; nodes: number };
  activity: CerberusActivity[];
  lastResultAt: number | null;
  gateway: { listening: boolean; address: string | null };
};

/** One stored result as the check's recent list prints it. */
export type CerberusResultRow = {
  at: number;
  status: CerberusStoredStatus | null;
  value: string | null;
};

/**
 * What a check was at one asked moment `at`. `verdict` is `result` (the check was fresh then — no
 * row need have been stored at that very moment, since a quiet check stores only a change or a
 * keep-alive), `stale` (no result had reached center within `staleAfter` of the moment, so the
 * answer is "no result" and never the old status), `too_early` (no result is recorded at or before
 * it) or `future` (the moment has not happened). Freshness rests on continuity, never on the stored
 * row's own age: between two stored rows a moment is fresh while it is no later than the next row's
 * `prevAt` + `staleAfter`, and past the latest row while it is no later than center's in-memory
 * last-received time for the check + `staleAfter`. `resultAt` is the `at` of the result the answer
 * rests on — the stored row, or, for a moment at or after center's newest received result when that
 * is newer than the row, that result (the store keeps a moving value only in its keep-alives) — and
 * `mute` the mute that covered the moment, if any. Answered by
 * `GET /api/cerberus/lookup` and carried inside `CerberusCheckDetail`.
 */
export type CerberusLookup = {
  node: string;
  check: string;
  at: number;
  verdict: 'result' | 'stale' | 'too_early' | 'future';
  status: CerberusStatus | null;
  value: string | null;
  resultAt: number | null;
  mute: CerberusMute | null;
};

/**
 * What `GET /api/cerberus/checks/:node/:service/:check` answers: the check and its sibling checks of
 * the same service (both as they read now), a strip of 60 cells, the stored change rows of the 3 h
 * before the strip's end and the lookup at the moment the caller asked about. The strip and the rows
 * stand at the caller's `end` — now unless one earlier is asked — and the lookup defaults to it.
 * `fixes` is every unretired catalog entry on the check, whatever its `when`, oldest first; `run` is
 * the check's newest run requested within the last hour, running or ended, with its `lines` (null
 * when there is none). Both are as of now: the sheet shows a fix's output beside the reading the
 * fix produced, so `run` is not bounded by the check's `since` as a need's is. `diagnosis` is the
 * check's newest diagnosis, running or ended, with its `steps` and its own `run` with `lines` — null
 * when there is none. It is as of now too, and reaches back the further of two bounds: 24 hours, or
 * the check's current `since` (the bound a need's diagnosis has), so a sheet opened from a need
 * always shows what its card said "See diagnosis" for, and a fix that worked still shows the
 * diagnosis that proposed it — with its "Add to catalog" — after the check turned green. It can
 * therefore be older than the incident its card is about: a check red for 2 hours whose newest
 * diagnosis is 10 hours old (an earlier incident) reads "Diagnose" on its card, and its sheet shows
 * that older diagnosis with the time it was asked (`startedAt`), "Diagnose again" and "Add to
 * catalog" — and "Run it once" only while its `oneOffExpiresAt` is still ahead.
 */
export type CerberusCheckDetail = {
  check: CerberusCheckView;
  siblings: CerberusCheckView[];
  cells: CerberusCell[];
  recent: CerberusResultRow[];
  lookup: CerberusLookup;
  fixes: CerberusCatalogEntryView[];
  run: CerberusRunView | null;
  diagnosis: CerberusDiagnosisView | null;
};

/**
 * One active check in the index `GET /api/cerberus/checks` answers — what a picker needs to name a
 * check without reading the whole fleet.
 */
export type CerberusCheckIndexEntry = {
  node: string;
  key: string;
  service: string;
  label: string | null;
  serviceLabel: string | null;
};

// ---------------------------

//----------------- DEFINITIONS AND ENROLLMENT ------------

/**
 * What `POST /api/cerberus/enrollments` answers: the node `name` the token is good for, the `token`
 * as printed once (`XXXX-XXXX-XXXX`; only its sha256 is kept), the `command` to run on the new
 * machine, and when the token `expiresAt`.
 */
export type CerberusEnrollment = {
  name: string;
  token: string;
  command: string;
  expiresAt: number;
};

/**
 * What `GET /api/cerberus/enrollments/:name` answers, so the screen can show how far an install has
 * got. `token` is `waiting` (unused and unexpired), `used`, `expired` or `unknown` (no such name).
 * `installRanAt` is the token's `used_at` — the install's enroll step presented the token and the
 * node row was written; `node.firstHeartbeatAt` is the running warden's first heartbeat. A node
 * with an `installRanAt` and no `firstHeartbeatAt` is a machine where the install ran and the
 * service has not yet spoken.
 */
export type CerberusEnrollmentStatus = {
  name: string;
  token: 'waiting' | 'used' | 'expired' | 'unknown';
  installRanAt: number | null;
  node: {
    enrolledAt: number;
    wardenVersion: string | null;
    firstHeartbeatAt: number | null;
  } | null;
};

/**
 * One probe as a warden runs it: `key` is `<service>/<id>` (unique per node), `kind` picks which of
 * the optional fields apply — `url` for `http` and `health_doc`, `host` and `port` for `tcp`, `cmd`
 * for `exec`, `path` for `file_age`, `dsn` and `query` for `sql`. `every` and `timeout` are seconds;
 * `cadence` is how often a health_doc service republishes its document, when that differs from
 * `every`. `pass` and `warn` are the check's expressions, evaluated on the warden (`age < 26h`);
 * `staleAfter` is the seconds after which a result no longer counts as fresh, when it differs from
 * the default of three times `cadence ?? every`. In the browser it is the probe half of
 * `CerberusProbeDefinition`, which the definitions routes read and write; the warden's own frames,
 * which carry the same shape, are not here.
 */
export type CerberusProbeSpec = {
  key: string;
  service: string;
  kind: CerberusProbeKind;
  every: number;
  timeout: number;
  cadence?: number;
  url?: string;
  host?: string;
  port?: number;
  cmd?: string;
  path?: string;
  dsn?: string;
  query?: string;
  pass?: string;
  warn?: string;
  staleAfter?: number;
};

/**
 * One probe as the definition document writes it: the spec a warden runs plus an optional plain
 * label for the check it reports. `PUT /api/cerberus/definitions/:node` takes it; the label goes to
 * the `checks` row and never to the warden.
 */
export type CerberusProbeDefinition = CerberusProbeSpec & { label?: string };

/**
 * One service of a node's definition. `label` is the service's plain name; `labels` maps component
 * ids (the part of a key after the `/`) to their plain labels, for the components a health_doc probe
 * fans out that no one has yet named one by one.
 */
export type CerberusServiceDefinition = {
  service: string;
  label: string | null;
  probes: CerberusProbeDefinition[];
  labels?: Record<string, string>;
};

/**
 * One node's whole definition, the document the definitions routes read and write. `version` is
 * the `checks.set` version it is at; a write that changes anything bumps it and is pushed to the
 * node's warden.
 */
export type CerberusDefinition = {
  node: string;
  version: number;
  services: CerberusServiceDefinition[];
};

// ---------------------------

//----------------- THE BROWSER EVENTS ------------

/**
 * The frame center puts on the browser's gateway socket to say "read again", `kind:
 * 'cerberus_changed'`. A HINT, not a picture: it says what moved and the screen reads again. `nodes`
 * are node ids; each entry of `checks` is `<node>/<key>` (`eis1/docstore/backup.age`), split at the
 * FIRST `/` because a key itself holds one. Coalesced to at most one a second; sent on a stored
 * change, a link change, a mute, a label, a definition change, a fix run starting or ending (it
 * names the run's check) or a diagnosis starting or ending (it names the diagnosis's check) — never
 * on a result that was not stored. The one exception to the second is a warden update's moments (a
 * batch's start, each step stored, each end): those go out at once, `updates: true`, because an update
 * is over in under half a second and a held frame would arrive after it; the screen reads on such a
 * frame without waiting out its own gap. The other browser frames are `CerberusRunOutputEvent` and
 * `CerberusDiagStepEvent`.
 */
export type CerberusChangedEvent = {
  kind: 'cerberus_changed';
  at: number;
  nodes: string[];
  checks: string[];
  /** Present (`true`) on the frame of a warden update's moment, sent at once rather than coalesced. */
  updates?: true;
};

/**
 * The frame center puts on the browser's gateway socket to carry a running fix's output, `kind:
 * 'cerberus_run_output'`. Unlike `cerberus_changed` it is a PICTURE, not a hint: a line must appear
 * the moment it arrives and a re-read cannot give it, so the frame holds the lines themselves — the
 * ones center has just stored for `runId`, in order, never coalesced with another run's. A sheet
 * that is open on the run appends them (by `n`, dropping one it already has) and a need's card on
 * the Needs-you list shows the newest line of its run; no other screen reads the frame. Whatever
 * it missed, `GET /api/cerberus/runs/:id` answers with every line.
 */
export type CerberusRunOutputEvent = {
  kind: 'cerberus_run_output';
  runId: string;
  lines: CerberusRunLine[];
};

/**
 * The frame center puts on the browser's gateway socket the moment a running diagnosis says
 * something, `kind: 'cerberus_diag_step'`. Like `cerberus_run_output` it is a PICTURE, not a hint: a
 * step must appear as it is said and a re-read cannot give it, so the frame holds the step itself —
 * the one center has just stored for `diagId`, never coalesced with another diagnosis's. A sheet
 * that is open on the diagnosis appends it (by `step.n`, dropping one it already has); every other
 * screen ignores the frame. Whatever it missed, `GET /api/cerberus/diagnoses/:id` answers with every
 * step. A diagnosis's start and end are announced by `cerberus_changed`, not by this frame.
 */
export type CerberusDiagStepEvent = {
  kind: 'cerberus_diag_step';
  diagId: string;
  step: CerberusDiagnosisStep;
};
