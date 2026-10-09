//----------------- CERBERUS CONTRACTS ------------
// The shapes Cerberus puts on a wire: what a warden says to center and center says back, what a
// result, a check, a mute, a fix and a node look like when the tab reads them, the hint frame that
// tells the tab to read again and the two frames that carry a fix's output lines and a diagnosis's
// steps as they arrive. One home, so every plan of the arc adds here and none redefines.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason every
// other sibling here exists: that file is far past the house ceiling of 300 lines for a module, and
// the Kanban board established the pattern (`server/shared/kanban-types.ts` beside ten more).
//
// Four readings the whole contract stands on:
//   - every time is epoch MILLISECONDS, and every duration (`every`, `timeout`, `cadence`,
//     `staleAfter`) is SECONDS — the unit the eis1 definition writes (`every 30, timeout 15`);
//   - JSON is camelCase on every wire, and SQL is snake_case (`staleAfter` here, `stale_after` in
//     the store);
//   - the browser half is `src/shared/cerberus-types.ts`: the vocabulary, the read model and the
//     three browser events, field for field. The two files are edited together, always — a field
//     renamed on one side and not the other is a screen that quietly stops reading;
//   - later plans of the arc add frames and read-model fields HERE, and redefine nothing.
//
// What the browser never sees — the warden wire, the node-session, fix and diagnosis frames, and the
// server-only seam types at the end — stays in this file alone.

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
 * from a `failed` step. Carried by `update.progress` and by every step of a `CerberusUpdateView`.
 */
export type CerberusUpdateStep =
  'waiting' | 'uploading' | 'verified' | 'swapping' | 'restarting' | 'failed';

// ---------------------------

//----------------- WARDEN WIRE (SERVER ONLY) ------------

/**
 * The envelope every frame in both directions is wrapped in. `type` names the frame
 * (`CerberusFrameType` lists the ones this center knows; a newer warden may send others, which are
 * ignored). `id` is a short random id for the frame; `node` is the node the frame is about; `seq` is
 * the warden's per-node monotonic sequence on a `result` frame, on every warden → center run
 * frame and on `update.progress` — the frames that ride the warden's outbox, one counter for all of
 * them and the unit center acks by — and null on every frame that is not sequenced, including every
 * frame center sends; `at` is the sender's clock in epoch milliseconds (its difference from the
 * receiver's clock is the link's clock offset). Sent by wardens, read by center's `warden-link.ts`;
 * center's own frames are the envelope inside a `CerberusSignedFrame`.
 */
export type CerberusEnvelope<B> = {
  type: string;
  id: string;
  node: string;
  seq: number | null;
  at: number;
  body: B;
};

/**
 * What center puts on the socket, center → warden only: `env` is the envelope's JSON TEXT and `sig`
 * the base64 ed25519 signature of that text's UTF-8 bytes. `sig` is checked against the exact UTF-8
 * bytes of `env`, never a re-serialisation — a parse and a stringify may reorder or respace the
 * same object into different bytes, and a signature over different bytes proves nothing. Frames a
 * warden sends are plain envelopes: its link is authenticated once, at the upgrade.
 */
export type CerberusSignedFrame = { env: string; sig: string };

/**
 * What a warden knows about the machine it runs on, sent inside `hello` and stored on the node row
 * as JSON. `machineId` is the machine's own id when the warden could read one, else null; `memMb`
 * is total memory in whole megabytes.
 */
export type CerberusHostFacts = {
  hostname: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  machineId: string | null;
  cpus: number;
  memMb: number;
};

/**
 * `hello` — the first frame on every link, warden → center, required within ten seconds of the
 * upgrade. `version` is the warden build; `startedAt` is when its process started. `checksVersion`
 * and `catalogVersion` are the last definition versions the warden acked (null before any), so
 * center sends `checks` and `catalog` in `welcome` only when they differ. `active` names the work
 * the warden still holds across a reconnect: `runs` the ids of the fix runs whose child is still
 * running; `owed` the ids of runs that are over but whose `run.*` frames still wait on its outbox for
 * center's ack (a run is named in one of the two, never both); `diags` the ids of the diagnoses the
 * warden holds open — at most one, since a node has one open diagnosis at a time, and none in
 * practice (see the last paragraph on diagnoses). `owed` is absent from a warden that does not
 * report it.
 *
 * A run center holds live that `runs` and `owed` both leave out is lost, and `owed` is what makes that
 * certain: the process that ran it is gone (a restart kills the child and drops the outbox together),
 * or its `run.start` never reached the warden (the link dropped with the frame in flight). Nothing more
 * will ever arrive for it, so center ends it `failed` — "The warden restarted while it ran; the output
 * ends where the link did." for one the warden had accepted, "The warden never started it." for one it
 * never accepted. A run in `owed` is left: its frames are resent after `welcome` and end it.
 * A hello with no `owed` cannot tell a lost run from one that ended on its own while the link was
 * down, so center ends only a run that belongs to a process that is gone, by `startedAt` (the
 * process's start, on the warden's clock): a run accepted before it, and one never accepted that was
 * asked for before it (both brought onto the warden's clock with the link's clock offset).
 *
 * Diagnoses. A diagnosis lives and dies with its link, so a hello — the first frame of a new link —
 * lists none: the warden ends its session on `link.down`, and no `diag.*` frame rides the outbox.
 * When a hello arrives for a node whose diagnosis center holds `running`, center ends it `failed`,
 * its `error` saying the link was lost, whatever `diags` lists: the link its calls went out on is
 * gone and the new one has no session to answer them. That hello is the one event center always
 * sees — `linked` stays true when a new link replaces one that died without a close, so no down
 * edge fires. An id `diags` does list is one center does not hold running, and center answers it
 * with `diag.close`.
 *
 * `update` is how an update ends after a restart, and it is on the hello of the process that restart
 * started: the warden writes it from the `pending-update.json` its launcher left, repeats it on
 * every hello of that process until a `welcome` has followed one (a link that drops between the two
 * sends it twice), and drops the file then, so it is never on a hello after that welcome.
 * `{ updateId, from, to }` is the new release coming up — `version` is then `to` and `from` the
 * release it replaced — and ends the update `updated`. `{ updateId, failed, reason }` is the launcher
 * having taken the new release back — this hello is the OLD release's, `failed` the version that did
 * not hold, `reason` the launcher's own sentence ("no hello within 60 s", "1.4.0 exited with code 1
 * on start") — and ends the update `rolled_back`; so does that `failed` for an update center ended
 * `updated` under 120 s ago whose `to` it names (the new release died after center heard its hello).
 * A hello without `update` ends nothing, and so does one naming an `updateId` center holds as already
 * ended (but for that late `failed`) or does not hold at all (a repeat; a pending file from before a
 * center restart): the first end wins, as a run's does.
 */
export type CerberusHelloBody = {
  version: string;
  startedAt: number;
  facts: CerberusHostFacts;
  checksVersion: number | null;
  catalogVersion: number | null;
  active: { runs: string[]; diags: string[]; owed?: string[] };
  update?:
    | { updateId: string; from: string; to: string }
    | { updateId: string; failed: string; reason: string };
};

/**
 * The certificate center issues a node at enrollment: its name and the fingerprint (sha256 hex of
 * the DER bytes) of the public key it enrolled with, when it was issued, and center's own public key
 * (base64 SPKI DER) so the warden can verify every signed frame it is sent. `sig` is center's base64
 * ed25519 signature of the UTF-8 bytes of the text `cerberus-cert\n<node>\n<fingerprint>\n<issuedAt>`
 * (`issuedAt` in decimal milliseconds), the shape of the connect header's
 * `cerberus-connect\n<node>\n<at>`; the warden verifies those exact bytes. `centerKey` is not in
 * that text: it is the key being pinned, and every frame after the cert is verified against it.
 * Sent in the enrollment's `welcome` and again in every connect's: it is a pure function of the node
 * row and ed25519 signs deterministically, so each copy is byte for byte the first.
 */
export type CerberusNodeCert = {
  node: string;
  fingerprint: string;
  issuedAt: number;
  centerKey: string;
  sig: string;
};

/**
 * `welcome` — center's answer to `hello`, center → warden. `ackedUpto` is the highest outbox seq (a
 * `result`'s, a run frame's or an `update.progress`'s) center has stored for this node (0 on
 * enrollment), so the warden resends only what is above it.
 * `cert` is present on enrollment and on every connect (the same bytes each time: a warden whose
 * enrollment `welcome` was lost still learns the key to pin; one that already holds a cert ignores
 * a repeat). `checks` is present on enrollment and whenever the warden's `hello.checksVersion`
 * differs from center's definition. `catalog` is present whenever center holds a published catalog
 * set for the node and the warden's `hello.catalogVersion` differs from it (a node that has never
 * acked one included); the warden takes it exactly as it takes a `catalog.set` and answers
 * `catalog.ack`.
 */
export type CerberusWelcomeBody = {
  node: string;
  ackedUpto: number;
  cert?: CerberusNodeCert;
  checks?: CerberusChecksSet;
  catalog?: CerberusCatalogSet;
};

/**
 * One probe as a warden runs it: `key` is `<service>/<id>` (unique per node), `kind` picks which of
 * the optional fields apply — `url` for `http` and `health_doc`, `host` and `port` for `tcp`, `cmd`
 * for `exec`, `path` for `file_age`, `dsn` and `query` for `sql`. `every` and `timeout` are seconds;
 * `cadence` is how often a health_doc service republishes its document, when that differs from
 * `every`. `pass` and `warn` are the check's expressions, evaluated on the warden (`age < 26h`);
 * `staleAfter` is the seconds after which a result no longer counts as fresh, when it differs from
 * the default of three times `cadence ?? every`. At rest the spec is split across two tables:
 * `probes` holds the probe's own fields (the kind's fields as JSON, `every`, `timeout`, `cadence`)
 * and the `checks` row of the check it reports holds `pass`, `warn` and `staleAfter`, so a
 * `checks.set` is built by joining the two; a `file_age` spec without its `pass` cannot be judged.
 * Sent by center inside `CerberusChecksSet`, read by the warden's scheduler. It is also the one
 * wire-born shape the browser file repeats, because the definition document carries probes as their
 * spec.
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
 * `checks.set` — the whole of a node's probes at one version, center → warden. Versioned: `version`
 * bumps whenever any probe of the node changes, and the warden answers `checks.ack` with the version
 * it now runs. It is a full replacement, never a patch.
 */
export type CerberusChecksSet = { version: number; probes: CerberusProbeSpec[] };

/**
 * One result as a warden reports it, inside `CerberusResultBody`. `check` is the check key
 * (`<service>/<id>`) and `source` the probe key that produced it (the same key for a single-check
 * probe, the health_doc probe for a component). `at` is when the result is FOR: a health document's
 * own `checked_at` (the service's clock), the probe's run time for every other kind. `fetchedAt` is
 * when the warden read it. `status` is null when the check is not enabled; `docStatus` is the
 * document's own word, null for a non-document probe. `value` is the sentence shown on screen — the
 * service's own reason, or the warden's; `data` is raw and never a label. `prevAt` is the `at` of the
 * previous result the warden sent for this check (null for its first), which is how center tells a
 * quiet stretch from a lapse.
 */
export type CerberusResultWire = {
  check: string;
  source: string;
  at: number;
  fetchedAt: number;
  status: CerberusStoredStatus | null;
  docStatus: CerberusDocStatus | null;
  value: string | null;
  data: Record<string, unknown> | null;
  tookMs: number | null;
  prevAt: number | null;
};

/**
 * `heartbeat` — warden → center every 15 seconds. `uptimeS` is the warden process's uptime in
 * seconds and `probesRunning` how many probes it has scheduled. Hearing any frame at all keeps a
 * node reporting; the heartbeat is what keeps a quiet one heard.
 */
export type CerberusHeartbeatBody = { version: string; uptimeS: number; probesRunning: number };

/**
 * `result` — a batch of results, warden → center. The envelope's `seq` is the batch's sequence;
 * center stores, then answers `ack` with the same number.
 */
export type CerberusResultBody = { results: CerberusResultWire[] };

/**
 * `ack` — center's receipt for a sequenced frame, a `result`, a run frame or an `update.progress`
 * alike: everything up to and including `upto` is stored.
 */
export type CerberusAckBody = { upto: number };

/** `checks.ack` — the warden's receipt for a `checks.set`: the version it now runs. */
export type CerberusChecksAckBody = { version: number };

/** `error` — center's refusal, sent just before it closes a link (`token used`, for one). */
export type CerberusErrorBody = { message: string };

/**
 * The frame types this center knows. Later plans WIDEN this union; a frame whose `type` is outside
 * it is logged once per link and ignored, since a newer warden may speak frames this center does
 * not. The seven `session*` types are the node-session frames below; `catalog.*`, `run.*` and
 * `probe.run` are the fix frames below them; the five `diag.*` types are the diagnosis frames
 * (`CerberusDiagOpenBody` and the four after it, none of which rides the outbox); `update.offer`
 * and `update.progress` are the warden update frames.
 */
export type CerberusFrameType =
  | 'hello'
  | 'welcome'
  | 'heartbeat'
  | 'checks.set'
  | 'checks.ack'
  | 'result'
  | 'ack'
  | 'error'
  | 'catalog.set'
  | 'catalog.ack'
  | 'probe.run'
  | 'run.start'
  | 'run.accepted'
  | 'run.refused'
  | 'run.output'
  | 'run.end'
  | 'session.open'
  | 'session.frame'
  | 'session.detach'
  | 'session.closed'
  | 'sessions.list'
  | 'sessions.listed'
  | 'session.retire'
  | 'sessions.changed'
  | 'diag.open'
  | 'diag.opened'
  | 'diag.call'
  | 'diag.result'
  | 'diag.close'
  | 'update.offer'
  | 'update.progress';

// ---------------------------

//----------------- NODE SESSIONS (SERVER ONLY) ------------
// The frames that carry a Claude session's host over a warden's link, so a project can run its
// sessions on the machine a node is. The warden is the session host's client there: it holds a
// unix socket to each host (`session-host/host.js`) and relays that socket's NDJSON lines as
// `session.frame` frames, one line per frame, in both directions.
//
// NONE OF THESE RIDES THE OUTBOX. The outbox (`result`, run and `update.progress` frames, `seq`,
// `ack`) exists because a result, a run frame or an update step lost on a dropped link is lost for
// good unless it is re-sent. A session
// frame is different: the host journals every `out` line it emits and keeps a cursor of what its
// client acked, so a lost frame is not lost — it is replayed from the host's journal when a client
// attaches again, at `fromSeq: 'acked'` after a center restart or at the exact last seq seen after
// a link blink. The journal and the cursor ARE the replay; a second one in the warden would only
// disagree with it.
//
// A CHANNEL is one center-side holder of one host: `chan` is a short random id center picks in
// `session.open`; every later frame of that session names it. A channel dies with its link — the
// warden ends every channel socket when the link goes down (a client socket closing is a DETACH to
// a host, never end-of-input) and center calls each channel's `closed('link lost')`.
//
// A FRAME HAS A CEILING. The gateway takes no frame past 8 MiB (`MAX_FRAME_BYTES`, `warden-gateway.ts`):
// a bigger one closes the WHOLE link with code 1009 and no `error` frame, every channel on the node
// with it, and a host line that large is replayed from the journal at the next attach and closes the
// link again. A `session.frame` carries a CLI line verbatim, so the warden must not put one past the
// ceiling on the link: a line whose frame would not fit ends THAT channel with `session.closed`
// naming the size, and the link stands. Transcript lines under `~/.claude/projects` reach 6.25 MB
// (measured 2026-10-06), a proxy for the CLI's own lines: inside the ceiling, with little to spare.

/**
 * One host's frame on the wire: the host protocol's NDJSON object, verbatim — `t` is its
 * discriminator (`spawn`, `hello`, `stdin`, `end_input`, `kill`, `note` toward the host; `out`,
 * `live`, `exit`, `err` back). Neither side reads past `t` except the two that own the protocol,
 * the host and the session host's facade. See `session-host/MANUAL.md`.
 */
export type CerberusHostFrame = { t: string; [field: string]: unknown };

/**
 * One live session host on a node, as the warden lists it: today's `LiveHost` fields of the
 * session host (`session-host/hosts.ts`) plus `lastTurnFinishedAt`, when the host's CLI last ended
 * a turn — the `at` of the newest `result` line in its journal, null when it never has. Center keeps
 * the last list it was given per node (`nodeSessions.lastListed`) and shows its length as "N
 * sessions running here". `cwd` and `profile` are what the host's meta recorded at spawn; `cliPid`
 * is the pid of the CLI the host owns on the NODE's machine.
 */
export type CerberusNodeHost = {
  hostId: string;
  appSessionId: string;
  userId: string | number | null;
  cwd: string | null;
  startedAt: number;
  turnCompleteSent: boolean;
  heldForBackgroundWork: boolean;
  deferredTools: string[];
  profile: Record<string, unknown> | null;
  cliVersion: string | null;
  cliPid: number | null;
  lastTurnFinishedAt: number | null;
};

/**
 * `session.open` — center → warden: open a channel to a host. `op: 'spawn'` starts a FRESH host
 * under `hostId` in `cwd` and `frame` is the host protocol's first frame for one, `spawn` (command,
 * args, env, ids); `op: 'attach'` joins a host that is already running — `cwd` is null — and
 * `frame` is `hello`. The warden writes `frame` to the host's socket as the first line. A refusal
 * (no session server, the host gone, a socket that would not connect) is answered with
 * `session.closed` on the same `chan`, never with silence. `hostId` is `<appSessionId>-<base36
 * time>` and the warden joins it into a socket path and a tmux target, so it refuses — with
 * `session.closed` — an id that is not a name of letters, digits, `-` and `_` within the warden's own
 * length limit; center does not check it.
 */
export type CerberusSessionOpenBody = {
  chan: string;
  op: 'spawn' | 'attach';
  hostId: string;
  cwd: string | null;
  frame: CerberusHostFrame;
};

/**
 * `session.frame` — both ways: one host frame on a channel. Center → warden it is a client frame
 * (`stdin`, `end_input`, `kill`, `note`) written to the host's socket; warden → center it is a line
 * the host wrote, verbatim, and so as large as that line: see A FRAME HAS A CEILING above.
 */
export type CerberusSessionFrameBody = { chan: string; frame: CerberusHostFrame };

/**
 * `session.detach` — center → warden: let go of the host. The warden closes its socket to the host
 * (`socket.end()`) and never writes `end_input`: a client closing is a detach, and the CLI keeps
 * running for the next one to attach. Nothing is answered.
 */
export type CerberusSessionDetachBody = { chan: string };

/**
 * `session.closed` — warden → center: the channel is over without the host having said `exit` —
 * its socket closed, or the open failed. `reason` is a sentence fit to show a person. A host that
 * ended on its own says so in an `exit` frame first, as a `session.frame`; no `closed` follows it,
 * and center forgets the channel once it has delivered that frame (a later `send` answers false).
 */
export type CerberusSessionClosedBody = { chan: string; reason: string };

/** `sessions.list` — center → warden: which hosts are running there. Answered by `sessions.listed`. */
export type CerberusSessionsListBody = Record<string, never>;

/**
 * `sessions.listed` — warden → center: the answer to `sessions.list`. `re` is the `id` of the
 * request's envelope, the one thing that ties an answer to its question.
 */
export type CerberusSessionsListedBody = { re: string; hosts: CerberusNodeHost[] };

/**
 * `session.retire` — center → warden: end a host that is no longer wanted (an older host of the
 * same session, one running a stale CLI while idle). Nothing is answered at once; when the retire is
 * over the warden says `sessions.changed`, and the next `sessions.list` no longer holds the host. A
 * `hostId` outside `[A-Za-z0-9_-]` is refused by the warden, as in `session.open`.
 */
export type CerberusSessionRetireBody = { hostId: string };

/**
 * `sessions.changed` — warden → center: the retire it was asked for (`session.retire`) is over — the
 * host said `exit` and its files are gone, the host was already gone, or the warden gave up waiting
 * for it — so the list center last read of this node may be stale. Center lists the node again; the
 * frame carries no host list of its own. It is how a host that takes long to leave stops being
 * counted: a CLI in the middle of a tool call can outlast any settle center waits after the retire.
 * A warden older than the frame never sends it, and center never waits for it.
 */
export type CerberusSessionsChangedBody = { hostId: string };

// ---------------------------

//----------------- FIXES: CATALOG AND RUNS (SERVER ONLY) ------------
// The frames that let center offer a node a fix and a warden run one: the catalog the warden checks
// every command against, and one run's life from `run.start` to `run.end`.
//
// CENTER DECIDES, THE WARDEN VERIFIES. Whether a fix runs — offered to a person, or started on its
// own within its limit — is decided in center and nowhere in a warden, so the catalog a warden
// holds carries only what it must check a command against: an id, the exact command, a timeout.
// Never a trigger, a limit or an auto-run switch. Every frame center sends is signed, and the warden
// still refuses a `run.start` whose version, id or command is not what it acked.
//
// EVERY WARDEN → CENTER RUN FRAME RIDES THE OUTBOX (`run.accepted`, `run.refused`, `run.output`,
// `run.end`): each is sequenced with the same counter as `result` frames, acked by `ack`, resent
// after a reconnect above `ackedUpto`, and held in order — so a center restart in the middle of a
// run loses no line and `run.end` is never seen before the output it ends. Center → warden frames
// (`catalog.set`, `run.start`, `probe.run`) are never queued: a `run.start` is not sent into a link
// that is down, and a run asked for while a node was unreachable is never started late. `catalog.ack`
// is the warden's receipt, like `checks.ack`: unsequenced, repeated after each `welcome` that
// carried a catalog.

/**
 * `catalog.set` — the whole of a node's fixes at one version, center → warden; the `catalog` of a
 * `welcome` is the same shape. Versioned like `CerberusChecksSet`: `version` bumps whenever what the
 * set holds changes, the warden answers `catalog.ack` with the version it now holds, and a set is a
 * full replacement, never a patch. `entries` are the node's unretired catalog entries — `id` is the
 * entry's slug, `cmd` the exact command text, `timeout` its seconds. `oneOffs` are the proposals of
 * the diagnoses that ended with one within the last hour: `id` is the diagnosis's id (the proposal's),
 * `cmd` the proposal's exact command, `timeout` its seconds (600) and `expiresAt` the epoch
 * millisecond an hour after the diagnosis ended — the warden drops a one-off past it and refuses a
 * run that names it. Sent by center on any change to the set; read by the warden's catalog.
 */
export type CerberusCatalogSet = {
  version: number;
  entries: { id: string; cmd: string; timeout: number }[];
  oneOffs: { id: string; cmd: string; timeout: number; expiresAt: number }[];
};

/**
 * `catalog.ack` — the warden's receipt for a `catalog.set` (or a `welcome`'s `catalog`), warden →
 * center: the version it now holds. A run is only ever started with a version the node has acked;
 * center records the ack on the set's row.
 */
export type CerberusCatalogAckBody = { version: number };

/**
 * `run.start` — center → warden: run this fix now. `runId` is center's id for the run and every
 * later frame of it names it; `catalogVersion` is the version center believes the warden acked;
 * `entryId` names a catalog entry or `proposalId` a diagnosis's one-off — exactly one is set, the
 * other null; `cmd` is the exact command text and `timeout` its seconds; `by` says whether
 * Cerberus's own rule (`auto`) or a person (`you`) asked, which the warden records and never weighs.
 * The warden runs it only if three things hold, checked in this order against the catalog it acked:
 * `catalogVersion` is the version it acked, the id is in that version (and a one-off is not past its
 * `expiresAt`), and `cmd` is that id's command byte for byte. A miss is `run.refused`, its reason
 * saying which. A command is `/bin/sh -c <cmd>` as the warden's own account, in its home directory.
 */
export type CerberusRunStartBody = {
  runId: string;
  catalogVersion: number;
  entryId: string | null;
  proposalId: string | null;
  cmd: string;
  timeout: number;
  by: 'auto' | 'you';
};

/**
 * `run.accepted` — warden → center, on the outbox: the command verified and the child started, at
 * `startedAt` by the warden's clock. The `t` of every output line of the run counts seconds from it.
 */
export type CerberusRunAcceptedBody = { runId: string; startedAt: number };

/**
 * `run.refused` — warden → center, on the outbox: verification failed and nothing ran. `reason` is a
 * sentence fit to show a person (`Catalog version 13 is not the one this warden acked (12)`). The
 * run ends `refused` with the reason as its note, and nothing else follows it — no `run.accepted`,
 * no output, no `run.end`. A refusal is a run's outcome and never a check result: only what a probe
 * measured is stored as one.
 */
export type CerberusRunRefusedBody = { runId: string; reason: string };

/**
 * `run.output` — warden → center, on the outbox: a batch of a run's lines in order, sent every
 * 250 ms while the child has written any. Each line is one line of the child's stdout or stderr
 * without its line break; `n` counts up from 1 within the run and is the line's identity — center
 * stores each `(runId, n)` once and drops a repeat, which a resend after a lost ack makes — and
 * `t` is the seconds since `run.accepted`'s `startedAt`.
 */
export type CerberusRunOutputBody = { runId: string; lines: CerberusRunLine[] };

/**
 * `run.end` — warden → center, on the outbox, the last frame of a run that was accepted: `result` is
 * `ok` for exit 0, `failed` for any other exit, `timed_out` when the child outlived `timeout` and
 * was ended (SIGTERM, then SIGKILL five seconds later); `exit` is the exit code, null when the
 * child ended on a signal and has none; `endedAt` is when, by the warden's clock. `refused` is never
 * a result here: that is `run.refused`. A frame for a run center already holds as ended changes
 * nothing — the first end wins, and a resend of the same one is a repeat.
 */
export type CerberusRunEndBody = {
  runId: string;
  result: 'ok' | 'failed' | 'timed_out';
  exit: number | null;
  endedAt: number;
};

/**
 * `probe.run` — center → warden: run the named probe once now, beside its schedule, so a check
 * moves within seconds of the fix that was meant to move it. `probe` is the probe's key, as in
 * `CerberusProbeSpec.key`; one already running finishes and runs once more, and a key the warden
 * does not run is ignored. Its answer is the probe's ordinary `result` frame.
 */
export type CerberusProbeRunBody = { probe: string };

// ---------------------------

//----------------- DIAGNOSIS (SERVER ONLY) ------------
// The five frames that let an agent read a node while it diagnoses a check. A diagnosis is a SESSION
// on one link: center opens it (`diag.open`), the warden accepts it (`diag.opened`), the agent's
// reads go over as `diag.call` and come back as `diag.result`, and center ends it (`diag.close`).
// (The warden's `diag.opened` says it HEARD the open, not that the diagnosis is the open one: below.)
// The warden holds a fixed menu of three read tools — `log.read`, `file.read`, `status.read` — each
// an argv-spawned read with no shell, and they are open only while that node's diagnosis is. There
// is no tool that runs a command or writes a file; what a diagnosis proposes it can only propose.
//
// ONE OPEN DIAGNOSIS PER NODE. A warden answers EVERY `diag.open` with `diag.opened` — it is the
// receipt for the frame, sent even for an id it refuses because another diagnosis is open — and
// refuses on the first read: every call that names the refused id is answered `diag.result { ok:
// false, text: 'Another diagnosis is open on this node' }`, so center's loop and the agent learn it
// from their first call. A `diag.call` outside an open diagnosis — no diagnosis open, or one naming
// an id other than the open one — is refused the same way (`ok: false`, a sentence for the agent).
//
// NONE OF THESE RIDES THE OUTBOX, and none is sequenced (`seq` null in both directions). A fix
// run's frames are re-sent after a lost link because a run goes on without center; a diagnosis does
// not — it is a conversation with an agent that is waiting for the answer on this very link. A link
// lost mid-diagnosis FAILS it: center ends it `failed` — on the node's link going down, or, when a
// new link replaces the dead one without a down edge, on the next `hello` (`CerberusHelloBody`) —
// and the warden ends its session on `link.down`, so a diagnosis is never resumed, only asked again.
//
// A `diag.call`'s answer is a `diag.result` carrying the call's `callId`, however the call ended
// while its diagnosis was open: a read that was refused, failed or timed out is `ok: false` with a
// sentence, never silence — the agent is blocked on it. The two exceptions are a call with no
// `diagId` or `callId` (ignored: nothing names it) and a call whose diagnosis ends while it runs
// (the warden kills it and says nothing: nobody is waiting).
//
// `ok` AND `truncated` MEAN ONE THING EACH, in every `diag.result`. `ok` is whether the read produced
// an answer: `true` for a read that ran, even one that found nothing; `false` for a read that was
// refused or could not run. `truncated` is whether the text ends before what was asked for did:
// `true` only when the 64 KB cap, `file.read`'s `maxBytes` or the directory listing's 200 entries
// cut it, never for a window the caller chose itself (`lines`, `sinceMin`). The cases, each one
// `(ok, truncated)` pair:
//   refused (a denylisted path, an argument out of range, no diagnosis open) ... (false, false)
//   could not run (a path unreadable or gone, a program missing, a non-zero exit
//     that printed nothing) ............................................ (false, false)
//   killed at 10 s (text is what it had printed, then `[killed after 10 s]`) ... (false, false)
//   ran and found nothing (empty file, `(no output)`, `(no line contains "x")`) ... (true, false)
//   a non-zero exit that still printed (`systemctl status` of a stopped unit) .... (true, false)
//   cut by the 64 KB cap, `maxBytes` or the listing's 200 entries ............... (true, true)
//   cut by `lines` or `sinceMin`, the caller's own window ........................ (true, false)

/**
 * The three reads a warden offers a diagnosis, named as they ride a `diag.call`. `log.read` reads a
 * systemd unit's journal or the tail of a log file; `file.read` reads a regular text file's head or
 * lists a directory; `status.read` runs one of a fixed set of status commands (a unit's status, the
 * failed units, containers, disks, memory, uptime, listening sockets). The arguments of each are
 * `CerberusDiagCallBody.args`; the warden validates them and answers `ok: false` for any it does not
 * accept. The agent's other three tools (`history_read`, `note`, `submit_diagnosis`) are center's
 * own and never cross the wire.
 */
export type CerberusDiagTool = 'log.read' | 'file.read' | 'status.read';

/**
 * `diag.open` — center → warden: open a diagnosis of `check` on this node. `diagId` is center's id
 * for it and every later frame of it names it; `check` is the check key being diagnosed, which the
 * warden records for its own log and never weighs. The warden answers `diag.opened` every time; when
 * this node already has a diagnosis open it refuses on the first read instead (see the banner). Not
 * on the outbox.
 */
export type CerberusDiagOpenBody = { diagId: string; check: string };

/**
 * `diag.opened` — warden → center: the receipt for `diag.open`, sent for every one, so center knows
 * the warden heard it. It does NOT say the diagnosis is the open one: a warden with another
 * diagnosis open sends it too, and answers the first call under the refused id `ok: false`
 * ("Another diagnosis is open on this node"), which the agent reads for itself. Not on the outbox.
 */
export type CerberusDiagOpenedBody = { diagId: string };

/**
 * `diag.call` — center → warden: run one read for the diagnosis `diagId`. `callId` is center's id
 * for this call and its answer names it, so concurrent calls can never be mistaken for each other;
 * `tool` is one of `CerberusDiagTool`; `args` is the tool's arguments as the agent gave them,
 * untrusted and validated by the warden. Not on the outbox: a call a lost link swallowed is not
 * re-sent — the diagnosis failed with it.
 */
export type CerberusDiagCallBody = {
  diagId: string;
  callId: string;
  tool: CerberusDiagTool;
  args: Record<string, unknown>;
};

/**
 * `diag.result` — warden → center: the answer to the `diag.call` named by `callId`. `ok` is whether
 * the read produced an answer, `truncated` whether the text ends before what was asked for did —
 * the banner above gives the `(ok, truncated)` pair of every case (a read that found nothing is
 * `ok: true`; one cut by `lines` is not `truncated`). When `ok` is false `text` is a sentence for the
 * agent ("Refused: <path> may hold a secret", "Another diagnosis is open on this node"). `text` is
 * what was read, with every credential-looking value masked (`password=<masked>`) and capped at
 * 64 KB; the refusals are masked too. Not on the outbox. Center keeps no state for a result it
 * cannot place — a `callId` it never issued, or one that arrives after `diag.close` or after the
 * diagnosis failed (a read killed at 10 s can race center's close): it drops the frame, stores
 * nothing and answers nothing.
 */
export type CerberusDiagResultBody = {
  diagId: string;
  callId: string;
  ok: boolean;
  text: string;
  truncated: boolean;
};

/**
 * `diag.close` — center → warden: the diagnosis `diagId` is over, whatever its outcome; the warden
 * drops it, kills any read of it still running, and a diagnosis of another check may open. A close
 * for any id but the open one changes nothing (it only forgets a refused id). Also the answer to an
 * id a `hello` lists that center does not hold running. Not on the outbox, and a warden that never
 * hears it (a link lost first) ends the session on `link.down`.
 */
export type CerberusDiagCloseBody = { diagId: string };

// ---------------------------

//----------------- WARDEN UPDATES (SERVER ONLY) ------------
// The two frames that move a node's warden from one release to the next. Center OFFERS one release to
// one node at a time; the warden says each step it takes. An update that restarts the warden ends on
// the node's next `hello` (`CerberusHelloBody.update`), not on any `update.*` frame — the restart that
// proves a release is the very thing that drops the link, so only the new process's own hello can say
// how it went. The two updates that never restart end on their last step: a `failed` one, and an
// offer for the version the warden already runs (see `CerberusUpdateOfferBody`).
//
// THE OFFER IS SIGNED, AND THAT IS THE SIGNATURE. Every frame center sends is wrapped in a
// `CerberusSignedFrame` the warden verifies against the key it pinned at enrollment, so the `sha256`
// inside `update.offer` is a hash center vouched for: a tarball that hashes to anything else is
// refused ("The download does not match its signed hash"), whoever served it.
//
// `update.progress` RIDES THE OUTBOX, like a run frame: sequenced with the same counter as `result`,
// acked by `ack`, resent after a reconnect above `ackedUpto`. A step must survive the link blinking
// mid-update, and the last one (`restarting`) is followed by the warden exiting — it waits up to two
// seconds for the ack of that frame so center has the word before the link goes. Center → warden
// `update.offer` is never queued: an offer is not sent into a link that is down.
//
// A warden waits for the work in flight (a fix run, a diagnosis) before it swaps, so an update's
// restart seldom ends one; a run that does end with it is ended by the lost-run rules in
// `CerberusHelloBody`, like any other restart's.

/**
 * `update.offer` — center → warden: take this release. `updateId` is center's id for the update
 * (the `updates` row's id) and every `update.progress` and the hello that ends it name it; `version`
 * is the release (`major.minor.patch`), `url` where to fetch its tarball, `sha256` the tarball's hash
 * as lowercase hex, `size` its bytes (the warden prints it as "2.1 MB" in its `uploading` step) and
 * `note` the release's one line from its `latest.json`. `url` is `/cerberus/warden/<file>`, a path
 * the warden joins to the `center` address it enrolled with, or an absolute http(s) address built
 * from the configured `CERBERUS_LISTEN` the way the enroll script's is — never one built from a
 * request's `Host`, which a node may not reach. The warden answers with `update.progress` frames, in
 * order, and never refuses silently: every way out of an offer says so with `failed`.
 *
 * An offer for the version the warden already runs is answered `verified`, "Already on <version>",
 * and nothing else: the warden does not restart, so no hello will follow. Center ends that update
 * `updated` on the `verified` step itself, recognising it by the node's reported version already
 * being `to` when the step arrives (in an update that goes on, the warden is still on `from` at its
 * `verified`), never by reading `text`. `startBatch` does not refuse a node that is not `behind`, so
 * this ending is reachable; it is a finished update, never a fault.
 */
export type CerberusUpdateOfferBody = {
  updateId: string;
  version: string;
  url: string;
  sha256: string;
  size: number;
  note: string;
};

/**
 * `update.progress` — warden → center, on the outbox: one step of an offer the warden is acting on.
 * `step` is one of the six `CerberusUpdateStep` words and `text` a sentence fit to show a person
 * ("Waiting for 1 fix to finish", "Uploading warden 1.4.0 · 2.1 MB", "Signature checks out",
 * "Swapping the binary · 1.3.0 kept for rollback", "Restarting the warden", "The download does not
 * match its signed hash"). Center stores each one against its update — `text` verbatim, `at` its own
 * clock at the moment it stores it, never the envelope's — and the tab shows them as they come; a
 * frame resent after a lost ack (the same `seq`) is never stored twice. `failed` is final for the
 * offer: nothing more follows it, and center ends the update `failed` with `text` as its last step.
 * `waiting` may repeat, each time the count of work being waited for changes.
 */
export type CerberusUpdateProgressBody = {
  updateId: string;
  step: CerberusUpdateStep;
  text: string;
};

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
 * Carried by `CerberusRunView.lines` and by every `CerberusRunOutputEvent`; it is also the shape a
 * warden's `run.output` frame holds.
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

// ---------------------------

//----------------- SERVER-ONLY SEAMS ------------

/**
 * One node's link as `wardenLinks.states()` answers it: whether a socket is open now, the last time
 * any frame was heard (seeded at start from the node row's `last_heartbeat_at` by `seedFromStore`,
 * so a boot does not erase it; null only for a node that has never sent a heartbeat and has not
 * been heard since), when the silence began (`lastHeardAt` + 90 000; null while reporting, and null
 * while `lastHeardAt` is), the clock offset (the median of the last five `receivedAt − env.at`,
 * null until a frame has been heard) and the warden's version from its `hello`. A node is silent
 * whether or not its socket is still open; from boot it is silent only when that stored heartbeat
 * is already more than 90 s old. For a node the registry holds no state for, the read model reads
 * the node row's stored last heartbeat (see `CerberusNodeView`). Built by `warden-links.ts`.
 */
export type CerberusLinkState = {
  linked: boolean;
  lastHeardAt: number | null;
  silentSince: number | null;
  clockOffsetMs: number | null;
  version: string | null;
};

/**
 * The warden gateway as the read model reports it: `listen` is the configured `CERBERUS_LISTEN`
 * (null when unset), `address` where the listener is bound, `error` the bind failure. Built by
 * `warden-gateway.ts`; read by the read model's "Cerberus itself" checks and the overview.
 */
export type CerberusGatewayState = {
  listen: string | null;
  address: string | null;
  error: string | null;
};

/**
 * Ingest's in-memory facts for one check: `lastReceivedAt` is the open end of the freshness rule —
 * the `at` of the latest accepted result, stored or not, or — for a check that was reporting just
 * before this boot — the boot's own moment until its next result arrives — and `since` the moment
 * the check's current status began. Both null for a check ingest has neither heard of since boot nor
 * vouched for at boot. `newest` is the newest accepted result's `at` and `value`, stored or not: the
 * store keeps a value that moves under an unchanged status only in a keep-alive every five minutes,
 * so the read model shows `newest` when it is newer than the check's stored row. Null until the
 * check's first result of this process arrives (a boot starts it empty), and the read model then
 * falls back to the stored row. Built by `ingest.service.ts`; read by the read model.
 */
export type CerberusCheckMemory = {
  lastReceivedAt: number | null;
  since: number | null;
  newest: { at: number; value: string | null } | null;
};

/**
 * One span a node's checks read `paused` — the half-open `[from, to)` its warden is expected to be away
 * restarting for an update, in epoch milliseconds on center's clock. `from` is the update's first
 * `restarting` step; `to` is the update's end, or while it is still live the longest a restart may last,
 * and never more than 90 s after `from`: the node's silence threshold, so a rollback that takes longer is
 * a real silence and reads as one rather than as a pause with no end. The node is `paused` while
 * `from <= now < to`. Built by `updates.service.ts` (`pauseWindows`) from the `updates` rows and read by
 * the read model's overlays; nothing here is stored or sent to a warden.
 */
export type CerberusPauseWindow = { from: number; to: number };

/**
 * What every read-model entry point takes beside the store: the moment being read, every node's
 * link, the gateway, and a lookup into ingest's memory for one check. Passing them in keeps the read
 * model a pure function of its inputs, which is what lets one rule answer both "now" and "a minute
 * ago".
 */
export type CerberusReadInputs = {
  now: number;
  links: Map<string, CerberusLinkState>;
  gateway: CerberusGatewayState;
  memory: (node: string, key: string) => CerberusCheckMemory;
};

/**
 * What the diagnosing agent hands in with `submit_diagnosis`: `summary` is one or two sentences saying
 * what is wrong, `evidence` each thing it FOUND that says so (an empty list when it found nothing —
 * the absence of an error is never listed), and `proposal` the one fix it suggests or `null` for none:
 * `cmd` is the exact command to run on the node now, `general` the same command with every absolute
 * time made a relative window (equal to `cmd` when nothing needed generalising), `name` what the fix
 * button would say. The tool's schema and the store's `end` both refuse an empty string anywhere in it.
 * Built by `diagnosis-tools.ts`; answered by `runDiagnosisAgent`, and ended into a `diagnoses` row by
 * the diagnosis service.
 */
export type CerberusDiagnosisSubmission = {
  summary: string;
  evidence: string[];
  proposal: { name: string; cmd: string; general: string } | null;
};

/**
 * One `history_read` as the agent asked it: `sinceMin` minutes back from now, optionally narrowed to
 * one `node` and one `check` key, to some of the three `kinds` (all when absent) and at most `limit`
 * lines IN ALL, the newest across the kinds. Always whole numbers; `diagnosis-tools.ts` has already
 * applied its defaults and ceilings by the time a reader sees it. Read from the store, every node at
 * once — history is the one thing a diagnosis reads beyond its own node (spec Table 7).
 */
export type CerberusDiagnosisHistoryQuery = {
  node?: string;
  check?: string;
  sinceMin: number;
  kinds?: Array<'results' | 'runs' | 'diagnoses'>;
  limit: number;
};

/**
 * Everything the diagnosing agent's six tools reach, handed in by whoever runs the diagnosis — the
 * seam that keeps `diagnosis-tools.ts` free of the link, the store and the loop's bookkeeping:
 *   - `node` is the node the diagnosis is open on, and `linked` whether the node's session opened:
 *     false for the hub, for a node whose warden is updating, for one another diagnosis holds, and
 *     for a warden that is not connected or did not answer. A node that is not linked has no
 *     `log_read`, `file_read` or `status_read` at all.
 *   - `callNode` sends one read to that node's warden and resolves with its answer (`ok`, `text`,
 *     `truncated` as in `CerberusDiagResultBody`); it rejects when the frame could not be put on the
 *     link, when nobody answered within 20 s, and when the diagnosis has already ended. A rejected
 *     read ends nothing: the tool hands the agent the reason, and a diagnosis fails on its link going
 *     down (the diagnosis service's rule), not on a read.
 *   - `historyRead` answers from the store as compact lines, whatever the node.
 *   - `note` files one finding, masked, as a step; `submit` takes the conclusion and refuses what cannot
 *     be kept: a proposal for a node that runs no warden, a proposed command (`cmd` or `general`) that
 *     carries a credential — masking would break the command, so it is refused to the agent, never
 *     altered — an evidence line that is not one stretch of one line of a read's answer, verbatim (an
 *     absence, the check's own value, a paraphrase, a spliced or edited line), and a quotation no read
 *     returned. Last it has a second reader (`diagnosis-audit.ts`) name any clause of the summary that states as found what no
 *     evidence line shows — it answers late, and refuses a diagnosis at most twice. The summary and evidence it takes are stored masked.
 * Each call may throw; the tool turns that into an error the agent reads, never a crash of the loop.
 */
export type CerberusDiagnosisToolDeps = {
  node: string;
  linked: boolean;
  callNode: (
    tool: CerberusDiagTool,
    args: Record<string, unknown>,
  ) => Promise<Pick<CerberusDiagResultBody, 'ok' | 'text' | 'truncated'>>;
  historyRead: (query: CerberusDiagnosisHistoryQuery) => string | Promise<string>;
  note: (text: string) => void;
  submit: (submission: CerberusDiagnosisSubmission) => void | Promise<void>;
};

// ---------------------------
