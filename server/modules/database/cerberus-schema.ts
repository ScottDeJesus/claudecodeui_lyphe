/**
 * Cerberus's store, as an ordered list of migration steps — NOT one idempotent script.
 *
 * WHY THIS IS NOT LIKE `notes-schema.ts`: that file is `IF NOT EXISTS` DDL exec'd at every boot,
 * and its header warns that editing a column there changes NOTHING on a database that already has
 * the table. This store takes the other road. It is its own SQLite file (`cerberus.db`), counted by
 * `PRAGMA user_version`, and `cerberus-connection.ts` runs step `i` only while `user_version == i`,
 * then sets it to `i + 1`, both inside one `BEGIN IMMEDIATE` transaction. A step is therefore
 * applied once per file, atomically, no matter how many processes open it.
 *
 * THE RULE, which the counter makes absolute: a step that has run on the live store is NEVER
 * edited. Editing it changes nothing there and builds a different shape on every scratch file, so
 * a probe passes and the live store is wrong. A change is a NEW step appended at the end of
 * `CERBERUS_MIGRATIONS` — the arc's `fixes`, `updates`, `diagnosis` and `judgment` plans each
 * append one — and a step is never reordered or removed, for the position is the version.
 *
 * Plain `CREATE TABLE`, not `IF NOT EXISTS`: a step runs against the exact shape the steps before
 * it left, so a table that is already there means the counter and the file disagree, and failing
 * loudly beats skipping silently.
 *
 * The only consumer is `cerberus-connection.ts`, which owns the runner.
 */
export const CERBERUS_MIGRATIONS: readonly string[] = [
  // Step 0 — the store the first plan needs: who is enrolled, what they run, what they reported,
  // and who silenced what.
  `
-- A node is one machine's warden. Written once at enrollment; afterwards only bookkeeping moves:
-- the hello's version/machine/facts, the heartbeat stamps, and the two ack counters.
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    desc TEXT,
    public_key TEXT NOT NULL,
    cert_fingerprint TEXT NOT NULL,
    warden_version TEXT,
    machine_id TEXT,
    facts TEXT,
    enrolled_at INTEGER NOT NULL,
    first_heartbeat_at INTEGER,
    last_heartbeat_at INTEGER,
    acked_seq INTEGER NOT NULL DEFAULT 0,
    checks_version INTEGER NOT NULL DEFAULT 0,
    checks_acked INTEGER
);

-- One-time install tokens. Only the hash is stored; used_at is set by the single UPDATE that
-- decides whether a token may enroll.
CREATE TABLE enroll_tokens (
    token_hash TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    desc TEXT,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

-- What a node's warden is told to run. spec is the kind's own fields (url, host, port, cmd, path,
-- dsn, query) as JSON; every, timeout and cadence are seconds.
CREATE TABLE probes (
    node TEXT NOT NULL,
    key TEXT NOT NULL,
    service TEXT NOT NULL,
    kind TEXT NOT NULL,
    spec TEXT NOT NULL,
    every INTEGER NOT NULL,
    timeout INTEGER NOT NULL,
    cadence INTEGER,
    version INTEGER NOT NULL,
    PRIMARY KEY(node, key)
);

-- What a result can be filed under. label stays NULL until a person writes one (the key stands in);
-- source names the health_doc probe a component was discovered through, probe the probe that is
-- the check's own; retired_at hides a check and keeps its history.
CREATE TABLE checks (
    node TEXT NOT NULL,
    key TEXT NOT NULL,
    service TEXT NOT NULL,
    service_label TEXT,
    label TEXT,
    source TEXT,
    probe TEXT,
    pass TEXT,
    warn TEXT,
    stale_after INTEGER,
    version INTEGER NOT NULL,
    discovered_at INTEGER,
    retired_at INTEGER,
    PRIMARY KEY(node, key)
);

-- Append-only. The primary key IS the spec's (check, at desc) index: a lookup of "the last row at
-- or before a moment" walks it backwards. kind 'keepalive' rows are the only ones ever deleted.
CREATE TABLE results (
    node TEXT NOT NULL,
    check_key TEXT NOT NULL,
    at INTEGER NOT NULL,
    source TEXT,
    seq INTEGER,
    fetched_at INTEGER,
    status TEXT,
    doc_status TEXT,
    value TEXT,
    data TEXT,
    took_ms INTEGER,
    prev_at INTEGER,
    prev_status TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('change','keepalive')),
    PRIMARY KEY(node, check_key, at)
);

-- Append-only but for lifted_at, which is set once when a person unmutes.
CREATE TABLE mutes (
    id TEXT PRIMARY KEY,
    node TEXT NOT NULL,
    check_key TEXT NOT NULL,
    from_at INTEGER NOT NULL,
    until_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    by TEXT NOT NULL,
    lifted_at INTEGER
);

CREATE INDEX ix_mutes_check ON mutes(node, check_key, until_at);
`,

  // Step 1 (user_version 1 → 2) — the `cerberus--fixes` plan: what Cerberus may run, who was told,
  // and what came of it. The tables are `design/cerberus/Cerberus Spec.dc.html` Table 4 (the store):
  // `catalog`, `catalog_sets` and `catalog_changes` are kept forever; `runs` is kept forever and
  // `run_output` for 90 days (the daily prune).
  `
-- A fix an operator wrote for one check. The id is the name's slug. run_when is the status that
-- makes the check need a fix (failing, or warn when it nears its limit). cmd is run as written,
-- byte for byte, and timeout is seconds. auto is 0 until a person switches it on; limit_runs runs
-- in limit_per seconds (3600 or 86400) bound it, and capped holds the reason a fix may never run
-- on its own (NULL when it may). recheck asks for the check's probe to run again once the fix ends.
-- origin is how it came to be, as JSON — written by a person, or lifted from a diagnosis. Never
-- deleted: retired_at hides an entry and keeps its runs' history readable.
CREATE TABLE catalog (
    id TEXT PRIMARY KEY,
    node TEXT NOT NULL,
    check_key TEXT NOT NULL,
    name TEXT NOT NULL,
    run_when TEXT NOT NULL CHECK(run_when IN ('failing','warn')),
    cmd TEXT NOT NULL,
    timeout INTEGER NOT NULL,
    auto INTEGER NOT NULL DEFAULT 0,
    limit_runs INTEGER NOT NULL,
    limit_per INTEGER NOT NULL,
    capped TEXT,
    recheck INTEGER NOT NULL DEFAULT 1,
    origin TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    retired_at INTEGER
);

-- The catalog as one node was told it: a new version row each time the node's entries change.
-- entries and one_offs are the wire's lists as JSON. sent_at is when the signed set went down the
-- link, acked_at when the warden answered catalog.ack for that version.
CREATE TABLE catalog_sets (
    node TEXT NOT NULL,
    version INTEGER NOT NULL,
    entries TEXT NOT NULL,
    one_offs TEXT NOT NULL,
    sent_at INTEGER,
    acked_at INTEGER,
    PRIMARY KEY(node, version)
);

-- Append-only: every edit of an entry, one row per field (a new entry is field 'added'; an
-- auto-run toggle is field 'auto'). from_value and to_value are the field's text, NULL for none.
CREATE TABLE catalog_changes (
    entry TEXT NOT NULL,
    at INTEGER NOT NULL,
    field TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    by TEXT NOT NULL,
    PRIMARY KEY(entry, at, field)
);

-- One attempt to run a fix. entry or diagnosis names what it came from (a one-off from a diagnosis
-- has no catalog entry). cmd is the exact command sent and catalog_version the version it was
-- verified against. The row is written when Cerberus asks (requested_at); started_at is the
-- warden's accepted, ended_at its end; result is NULL while the run is live. A warden that refuses
-- the run ends it as 'refused' with the reason in note.
CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    entry TEXT,
    diagnosis TEXT,
    node TEXT NOT NULL,
    check_key TEXT NOT NULL,
    by TEXT NOT NULL CHECK(by IN ('auto','you')),
    cmd TEXT NOT NULL,
    catalog_version INTEGER NOT NULL,
    requested_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    result TEXT CHECK(result IN ('ok','failed','refused','timed_out')),
    exit INTEGER,
    note TEXT
);

CREATE INDEX ix_runs_check ON runs(node, check_key, requested_at);

-- A run's output, one row per line. n is the line's number within the run and t its offset in
-- seconds from the start; the primary key makes a resent batch a no-op.
CREATE TABLE run_output (
    run TEXT NOT NULL,
    n INTEGER NOT NULL,
    t REAL NOT NULL,
    stream TEXT NOT NULL CHECK(stream IN ('out','err')),
    line TEXT NOT NULL,
    PRIMARY KEY(run, n)
);
`,

  // Step 2 (user_version 2 → 3) — the `cerberus--updates` plan: the record of every warden update.
  // The tables are `design/cerberus/Cerberus Spec.dc.html` Table 4 (the store), "updates … Forever":
  // an update and its steps are appended and never pruned — the daily prune names neither table.
  `
-- One warden update of one node. batch groups the nodes a person picked in one go (they run one at a
-- time, in the order given). from_version is what the node ran when the row was written (NULL when
-- it had never said); to_version is the release offered. step is the latest step — 'queued' until
-- the node's turn, then what its warden last reported. ended_at and result are NULL while the update
-- is live: 'updated' when the node's next hello names to_version, 'rolled_back' when it names a
-- failed swap, 'failed' when a step said so or the warden went silent (the reason is in note).
CREATE TABLE updates (
    id TEXT PRIMARY KEY,
    batch TEXT NOT NULL,
    node TEXT NOT NULL,
    from_version TEXT,
    to_version TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    step TEXT,
    ended_at INTEGER,
    result TEXT CHECK(result IN ('updated','rolled_back','failed')),
    note TEXT
);

-- Append-only: every progress frame an update produced, stamped with the center's clock. text is the
-- line the dialog shows. The primary key makes a frame resent inside one millisecond a no-op. A
-- node's "paused" window is read from these rows (its 'restarting' step to the update's end) and is
-- never written anywhere.
CREATE TABLE update_steps (
    update_id TEXT NOT NULL,
    at INTEGER NOT NULL,
    step TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY(update_id, at, step)
);
`,

  // Step 3 (user_version 3 → 4) — the `cerberus--diagnosis` plan: what a read-only diagnosis was
  // asked, what it read and what it concluded. The tables are `design/cerberus/Cerberus Spec.dc.html`
  // Table 4 (the store), "diagnoses · diag_steps … Forever": nothing here is ever pruned.
  `
-- One diagnosis of one check. asked_by is who pressed Diagnose and model the model that read.
-- status is 'running' until the loop ends it as 'done' or 'failed'; a failed one keeps its reason
-- in error and proposes nothing. summary is the conclusion in prose, evidence a JSON array of
-- strings (only what was found), proposal JSON { name, cmd, general } or NULL when no fix was
-- proposed — cmd is the exact command a one-off run sends, general the same command with absolute
-- times made relative, the text a promotion saves. Never deleted.
CREATE TABLE diagnoses (
    id TEXT PRIMARY KEY,
    node TEXT NOT NULL,
    check_key TEXT NOT NULL,
    asked_by TEXT NOT NULL,
    model TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('running','done','failed')),
    summary TEXT,
    evidence TEXT,
    proposal TEXT,
    error TEXT
);

CREATE INDEX ix_diagnoses_check ON diagnoses(node, check_key, started_at);

-- What a diagnosis did, one row per step. n is the step's number within the diagnosis and t its
-- offset in seconds from the start; the primary key makes a repeated step a no-op. Never deleted.
CREATE TABLE diag_steps (
    diagnosis TEXT NOT NULL,
    n INTEGER NOT NULL,
    t REAL NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY(diagnosis, n)
);
`,

  // Step 4 (user_version 4 → 5) — the `cerberus--judgment` plan: the two reads that scanned the whole
  // `results` table get an index each. Both are PARTIAL, so each holds only the rows its read wants:
  // ingest now stores a change only for a move of status or document status (or a lapse), and a
  // keep-alive every five minutes, so the first holds the status moves alone and the second the
  // keep-alives alone. SQLite uses a partial index only when the query carries its terms, so
  // `cerberus-results.db.ts` spells the same WHERE in `transitions` (What happened) and
  // `pruneKeepalivesBefore` (the 04:10 prune). Additive: no row is read or rewritten.
  `
CREATE INDEX ix_results_moves ON results(at)
    WHERE kind = 'change' AND prev_status IS NOT NULL AND prev_status <> COALESCE(status, 'not_enabled');

CREATE INDEX ix_results_keepalives ON results(at) WHERE kind = 'keepalive';
`,

  // Step 5 (user_version 5 → 6) — the red watch: a check that stays failing or denied for an hour wakes the
  // operator's phone, and this table is what keeps a restart of the server from waking it again. Additive.
  `
-- One row per red incident of one check: opened when the watcher first paged it, closed when the check turned
-- ok again ('ok'), was muted ('mute') or left the fleet's sight ('gone'). notified_at is the last push that
-- carried it as a new red, last_reminder_at the last "still red" push; both are the clock of the cadence.
-- The partial unique index is the guard against two overlapping server processes opening the same incident.
CREATE TABLE cerberus_red_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node TEXT NOT NULL,
    "key" TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    notified_at INTEGER NOT NULL,
    last_reminder_at INTEGER,
    closed_at INTEGER,
    closed_by TEXT CHECK(closed_by IN ('ok','mute','gone'))
);

CREATE UNIQUE INDEX ix_red_alerts_open ON cerberus_red_alerts(node, "key") WHERE closed_at IS NULL;
CREATE INDEX ix_red_alerts_check ON cerberus_red_alerts(node, "key", opened_at);
`,

  // Step 6 (user_version 6 → 7) — when the red began. The recovery push says how long the check was red, and
  // `opened_at` is when the watcher paged (an hour or more after the red began), so the beginning is kept on
  // the row, on center's clock. Step 5 had run on the live store before this was needed, so it is a step and
  // not an edit of that one; the table held no row. The DEFAULT only satisfies SQLite's rule for a NOT NULL
  // column added to an existing table: every row the watcher writes names its own.
  `
ALTER TABLE cerberus_red_alerts ADD COLUMN red_since INTEGER NOT NULL DEFAULT 0;
`,
];
