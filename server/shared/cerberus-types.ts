//----------------- CERBERUS CONTRACTS ------------
// The shapes Cerberus puts on a wire: what a warden says to center and center says back, what a
// result, a check, a mute and a node look like when the tab reads them, and the one hint frame that
// tells the tab to read again. One home, so every plan of the arc adds here and none redefines.
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
//     hint event, field for field. The two files are edited together, always — a field renamed on
//     one side and not the other is a screen that quietly stops reading;
//   - later plans of the arc add frames and read-model fields HERE, and redefine nothing.
//
// What the browser never sees — the warden wire and the four server-only seam types at the end —
// stays in this file alone.

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

// ---------------------------

//----------------- WARDEN WIRE (SERVER ONLY) ------------

/**
 * The envelope every frame in both directions is wrapped in. `type` names the frame
 * (`CerberusFrameType` lists the ones this center knows; a newer warden may send others, which are
 * ignored). `id` is a short random id for the frame; `node` is the node the frame is about; `seq` is
 * the warden's per-node monotonic sequence on a `result` frame — the unit center acks by — and null
 * on every frame that is not sequenced, including every frame center sends; `at` is the sender's
 * clock in epoch milliseconds (its difference from the receiver's clock is the link's clock offset).
 * Sent by wardens, read by center's `warden-link.ts`; center's own frames are the envelope inside a
 * `CerberusSignedFrame`.
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
 * center sends `checks` in `welcome` only when they differ. `active` names the run and diagnosis
 * ids the warden still holds across a reconnect (empty until the plans that own those frames land).
 */
export type CerberusHelloBody = {
  version: string;
  startedAt: number;
  facts: CerberusHostFacts;
  checksVersion: number | null;
  catalogVersion: number | null;
  active: { runs: string[]; diags: string[] };
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
 * `welcome` — center's answer to `hello`, center → warden. `ackedUpto` is the highest `result` seq
 * center has stored for this node (0 on enrollment), so the warden resends only what is above it.
 * `cert` is present on enrollment and on every connect (the same bytes each time: a warden whose
 * enrollment `welcome` was lost still learns the key to pin; one that already holds a cert ignores
 * a repeat). `checks` is present on enrollment and whenever the warden's `hello.checksVersion`
 * differs from center's definition.
 */
export type CerberusWelcomeBody = {
  node: string;
  ackedUpto: number;
  cert?: CerberusNodeCert;
  checks?: CerberusChecksSet;
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

/** `ack` — center's receipt for a `result` frame: everything up to and including `upto` is stored. */
export type CerberusAckBody = { upto: number };

/** `checks.ack` — the warden's receipt for a `checks.set`: the version it now runs. */
export type CerberusChecksAckBody = { version: number };

/** `error` — center's refusal, sent just before it closes a link (`token used`, for one). */
export type CerberusErrorBody = { message: string };

/**
 * The frame types this center knows. Later plans WIDEN this union (`run.*`, `diag.*`, `update.*`,
 * `session.*` and `catalog.*` arrive with the plans that own them); a frame whose `type` is outside
 * it is logged once per link and ignored, since a newer warden may speak frames this center does
 * not.
 */
export type CerberusFrameType =
  'hello' | 'welcome' | 'heartbeat' | 'checks.set' | 'checks.ack' | 'result' | 'ack' | 'error';

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
 */
export type CerberusCell = {
  from: number;
  to: number;
  status: CerberusStatus;
  worst: string | null;
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
 * One node as the fleet shows it. `role` is `hub` for center's own node and `node` for every warden.
 * The hub has no warden and no link state: its `link` is `reporting`, its `lastHeardAt` is the
 * moment of its newest self-check, its `wardenVersion`, `silentSince` and `enrolledAt` are null, and
 * no silence is laid over its checks.
 * For a warden, `link` is decided in this order: `never` when the node has no first heartbeat on
 * record (the tab says "Waiting for the first heartbeat"; it wins over `silent`, so a boot does not
 * turn it into one), else `reporting` when heard within 90 s, else `silent`. `lastHeardAt` is the
 * last frame of any kind, and when nothing has been heard since this boot it is the node row's
 * stored last heartbeat; `silentSince` is that plus 90 000 while silent, null otherwise.
 */
export type CerberusNodeView = {
  id: string;
  desc: string | null;
  role: 'hub' | 'node';
  link: 'reporting' | 'silent' | 'never';
  wardenVersion: string | null;
  lastHeardAt: number | null;
  silentSince: number | null;
  enrolledAt: number | null;
  services: CerberusServiceView[];
};

/** One row of "Needs you": a check whose current status is warn, failing or denied and unmuted. */
export type CerberusNeed = { check: CerberusCheckView };

/**
 * One line of "What happened", a union on `kind`. `check` is a check's status moving from one word
 * to another (`not_enabled` spells a null on either side); `mute` is a mute being set, lifted or
 * expiring; `node` is a node enrolling. Later plans add four more kinds — `fix`, `catalog`,
 * `diagnosis` and `warden` — so a reader switches on `kind` and ignores a kind it does not know.
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
    };

/**
 * What `GET /api/cerberus/overview` answers: the whole fleet at `now`. `nodes` is hub first;
 * `needsYou` sorts by `since` then key; `muted` lists the checks a mute is covering; `activity` is
 * the newest seven lines of "What happened"; `lastResultAt` is the latest `at` of any stored result;
 * `gateway` says whether the warden listener is bound and where. `counts` excludes `not_enabled`
 * and retired checks.
 */
export type CerberusOverview = {
  now: number;
  nodes: CerberusNodeView[];
  needsYou: CerberusNeed[];
  muted: CerberusCheckView[];
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
 * last-received time for the check + `staleAfter`. `resultAt` is the `at` of the stored row the
 * answer rests on and `mute` the mute that covered the moment, if any. Answered by
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
 */
export type CerberusCheckDetail = {
  check: CerberusCheckView;
  siblings: CerberusCheckView[];
  cells: CerberusCell[];
  recent: CerberusResultRow[];
  lookup: CerberusLookup;
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

//----------------- THE HINT EVENT ------------

/**
 * The one frame center puts on the browser's gateway socket, `kind: 'cerberus_changed'`. A HINT, not
 * a picture: it says what moved and the screen reads again. `nodes` are node ids; each entry of
 * `checks` is `<node>/<key>` (`eis1/docstore/backup.age`), split at the FIRST `/` because a key
 * itself holds one. Coalesced to at most one a second; sent on a stored change, a link change, a
 * mute, a label or a definition change — never on a result that was not stored.
 */
export type CerberusChangedEvent = {
  kind: 'cerberus_changed';
  at: number;
  nodes: string[];
  checks: string[];
};

// ---------------------------

//----------------- SERVER-ONLY SEAMS ------------

/**
 * One node's link as `wardenLinks.states()` answers it: whether a socket is open now, the last time
 * any frame was heard (null until the first since boot), when the silence began (`lastHeardAt` +
 * 90 000; null while reporting, and null while `lastHeardAt` is), the clock offset (the median of
 * the last five `receivedAt − env.at`, null until a frame has been heard) and the warden's version
 * from its `hello`. A node is silent whether or not its socket is still open, and every enrolled
 * node is silent from boot until it is heard; the read model fills a null `lastHeardAt` from the
 * node row's stored last heartbeat (see `CerberusNodeView`). Built by `warden-links.ts`.
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
 * vouched for at boot. Built by `ingest.service.ts`; read by the read model.
 */
export type CerberusCheckMemory = { lastReceivedAt: number | null; since: number | null };

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
