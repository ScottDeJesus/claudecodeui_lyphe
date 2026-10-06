import { getCerberusConnection } from '@/modules/database/cerberus-connection.js';

/**
 * `enroll_tokens`, as row-level statements — the one-time install tokens of the Cerberus store.
 *
 * Only the sha256 of a token is ever stored (`token_hash`); the token itself is shown once, when the
 * operator mints it. A token names the node it may create (`name`) and lives 15 minutes. What decides
 * whether a presented token may enroll is `markUsed`: ONE `UPDATE` carrying every condition, whose
 * `changes` (1 or 0) is the verdict — so two sockets presenting the same token cannot both win, with
 * no read-then-write gap for them to slip through.
 *
 * Consumers: `server/modules/cerberus/` — the enrollment route (`insert`, `latestForName`), the
 * gateway's enroll check (`find`, to name the reason a token is refused), the warden link
 * (`markUsed`, inside the one transaction that also inserts the node) and the daily prune
 * (`pruneOlderThan`). Reach it through `@/modules/database/index.js`. Every statement runs on the
 * caller's connection and opens no transaction of its own.
 */

/** One `enroll_tokens` row, exactly as the table stores it. Times are epoch milliseconds. */
export type CerberusEnrollTokenRow = {
  token_hash: string;
  /** The node this token may enroll. */
  name: string;
  /** The node's description, carried onto `nodes.desc` at enrollment. */
  desc: string | null;
  issued_at: number;
  expires_at: number;
  /** NULL while the token is unspent; the moment `markUsed` won. */
  used_at: number | null;
};

const TOKEN_COLUMNS = 'token_hash, name, "desc", issued_at, expires_at, used_at';

export const cerberusEnrollDb = {
  /** Stores a freshly minted token's hash, unspent. Throws on a duplicate hash. */
  insert(token: Omit<CerberusEnrollTokenRow, 'used_at'>): void {
    getCerberusConnection()
      .prepare(
        `INSERT INTO enroll_tokens (token_hash, name, "desc", issued_at, expires_at)
         VALUES (@token_hash, @name, @desc, @issued_at, @expires_at)`
      )
      .run(token);
  },

  /** The row a token hash names, or `null` — spent and expired tokens are found too. */
  find(tokenHash: string): CerberusEnrollTokenRow | null {
    const row = getCerberusConnection()
      .prepare(`SELECT ${TOKEN_COLUMNS} FROM enroll_tokens WHERE token_hash = ?`)
      .get(tokenHash) as CerberusEnrollTokenRow | undefined;
    return row ?? null;
  },

  /** The most recently issued token for a node name, or `null` — what the enrollment screen polls. */
  latestForName(name: string): CerberusEnrollTokenRow | null {
    const row = getCerberusConnection()
      .prepare(
        `SELECT ${TOKEN_COLUMNS} FROM enroll_tokens WHERE name = ?
         ORDER BY issued_at DESC, rowid DESC LIMIT 1`
      )
      .get(name) as CerberusEnrollTokenRow | undefined;
    return row ?? null;
  },

  /**
   * Spends a token: stamps `used_at = now` only while the hash matches, the name matches, the token
   * is unspent and `expires_at > now`. Answers the statement's `changes` — 1 the token was spent
   * by this call, 0 it was refused (wrong name, already used, expired or unknown). The caller reads
   * `find` afterwards if it needs to say which.
   */
  markUsed(tokenHash: string, name: string, now: number): number {
    return getCerberusConnection()
      .prepare(
        `UPDATE enroll_tokens SET used_at = ?
         WHERE token_hash = ? AND name = ? AND used_at IS NULL AND expires_at > ?`
      )
      .run(now, tokenHash, name, now).changes;
  },

  /** Deletes tokens issued before `at`, spent or not. Answers how many went. */
  pruneOlderThan(at: number): number {
    return getCerberusConnection()
      .prepare('DELETE FROM enroll_tokens WHERE issued_at < ?')
      .run(at).changes;
  },
};
