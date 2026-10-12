import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `nodes`, as row-level statements — one row per enrolled warden, in the Cerberus store.
 *
 * A node is written once, at enrollment (`insert`). After that only bookkeeping moves, and every
 * verb below names the one thing it moves: the hello's version, machine id and facts
 * (`recordHello`), the heartbeat stamps (`recordHeartbeat`), the ack counter the warden's result
 * stream is deduplicated against (`setAckedSeq`), and the two numbers of the checks hand-off
 * (`setChecksVersion`, `setChecksAcked`). Nothing here deletes a node.
 *
 * Rows are exactly as the table stores them: snake_case, times in epoch milliseconds, `facts` as the
 * JSON text the caller wrote — parsing and camelCase are the service's.
 *
 * Consumers: `server/modules/cerberus/` — the warden link (enrollment, hello, heartbeat, ack,
 * checks hand-off), the gateway's connect check (`get`), ingest, and the read model (`list`). Reach
 * it through `@/modules/database/index.js`. Every statement runs on the caller's connection and
 * opens no transaction of its own: enrollment's "mark the token used, insert the node" is the
 * link's one transaction around `cerberusEnrollDb.markUsed` and `insert` below.
 */

/** One `nodes` row, exactly as the table stores it. */
export type CerberusNodeRow = {
  id: string;
  desc: string | null;
  /** The warden's ed25519 public key, base64 SPKI DER — what its connect signature is verified against. */
  public_key: string;
  cert_fingerprint: string;
  warden_version: string | null;
  machine_id: string | null;
  /** The hello's host facts as JSON text. */
  facts: string | null;
  enrolled_at: number;
  first_heartbeat_at: number | null;
  last_heartbeat_at: number | null;
  /** The highest result `seq` committed for this node; a frame at or below it is acked and skipped. */
  acked_seq: number;
  /** The version of the checks set last defined for this node. */
  checks_version: number;
  /** The version of the checks set the warden last acknowledged; NULL before its first ack. */
  checks_acked: number | null;
};

/** What enrollment writes: the columns with no default. The bookkeeping columns start empty. */
export type CerberusNodeInsert = Pick<
  CerberusNodeRow,
  | 'id'
  | 'desc'
  | 'public_key'
  | 'cert_fingerprint'
  | 'warden_version'
  | 'machine_id'
  | 'facts'
  | 'enrolled_at'
>;

// `desc` is a keyword (ORDER BY … DESC); SQLite tolerates it as a column name, and quoting keeps
// every statement that names it unambiguous.
const NODE_COLUMNS = `id, "desc", public_key, cert_fingerprint, warden_version, machine_id, facts,
  enrolled_at, first_heartbeat_at, last_heartbeat_at, acked_seq, checks_version, checks_acked`;

/** The least gap between two stored `last_heartbeat_at` values — a heartbeat comes every 15 s. */
const HEARTBEAT_WRITE_INTERVAL_MS = 60_000;

export const cerberusNodesDb = {
  /** One node, or `null` when none carries the id. */
  get(id: string): CerberusNodeRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${NODE_COLUMNS} FROM nodes WHERE id = ?`)
      .get(id) as CerberusNodeRow | undefined;
    return row ?? null;
  },

  /** Every enrolled node, oldest enrollment first (`id` breaks a tie). */
  list(): CerberusNodeRow[] {
    return getCerberusConnection()
      .prepare(`SELECT ${NODE_COLUMNS} FROM nodes ORDER BY enrolled_at, id`)
      .all() as CerberusNodeRow[];
  },

  /** Inserts a node. Throws on a duplicate id — enrollment checks the name is free before this. */
  insert(node: CerberusNodeInsert): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO nodes (id, "desc", public_key, cert_fingerprint, warden_version, machine_id, facts, enrolled_at)
         VALUES (@id, @desc, @public_key, @cert_fingerprint, @warden_version, @machine_id, @facts, @enrolled_at)`
      )
      .run(node);
  },

  /** Records what a warden said about itself in its hello. Answers whether the node exists. */
  recordHello(
    id: string,
    hello: { warden_version: string | null; machine_id: string | null; facts: string | null }
  ): boolean {
    const result = getCerberusConnection()
      .prepare(
        `UPDATE nodes SET warden_version = @warden_version, machine_id = @machine_id, facts = @facts
         WHERE id = @id`
      )
      .run({ id, ...hello });
    return result.changes > 0;
  },

  /**
   * Stamps a heartbeat: `first_heartbeat_at` once (it keeps the first value it ever got), and
   * `last_heartbeat_at` at most once a minute, through the statement's own `WHERE` — so the 15-second
   * stream costs one write in four, and the gate needs no memory in the caller. Answers whether a
   * row was written; a skipped beat is not an error.
   */
  recordHeartbeat(id: string, now: number): boolean {
    const result = getCerberusConnection()
      .prepare(
        `UPDATE nodes
            SET first_heartbeat_at = COALESCE(first_heartbeat_at, @now),
                last_heartbeat_at = @now
          WHERE id = @id
            AND (last_heartbeat_at IS NULL OR last_heartbeat_at < @now - @interval)`
      )
      .run({ id, now, interval: HEARTBEAT_WRITE_INTERVAL_MS });
    return result.changes > 0;
  },

  /**
   * Raises the node's `acked_seq` to `seq`. It never lowers it: a late or repeated call must not
   * reopen a window of frames that were already ingested. Answers whether it moved.
   */
  setAckedSeq(id: string, seq: number): boolean {
    const result = getCerberusConnection()
      .prepare('UPDATE nodes SET acked_seq = @seq WHERE id = @id AND acked_seq < @seq')
      .run({ id, seq });
    return result.changes > 0;
  },

  /** Records the version of the checks set now defined for the node. */
  setChecksVersion(id: string, version: number): void {
    getCerberusConnection()
      .prepare('UPDATE nodes SET checks_version = ? WHERE id = ?')
      .run(version, id);
  },

  /** Records the checks-set version the warden acknowledged. */
  setChecksAcked(id: string, version: number): void {
    getCerberusConnection()
      .prepare('UPDATE nodes SET checks_acked = ? WHERE id = ?')
      .run(version, id);
  },
};
