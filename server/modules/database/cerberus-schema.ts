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
 * `CERBERUS_MIGRATIONS` — the arc's `fixes`, `updates`, `diagnosis` and `sessions` plans each
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
];
