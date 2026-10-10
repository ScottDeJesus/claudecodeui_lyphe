import fs from 'fs';
import path from 'path';

import { getConnection } from '@/modules/database/connection.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
import type { CompactionFacts, CompactionRecord, LatestCompaction } from '@/shared/types.js';

/**
 * The `superseded_provider_sessions.reason` this repository writes. NULL in that column is an
 * edit's rewind, so a compaction's two kinds of row are named rather than left as bare strings.
 */
const REASON_COMPACTION = 'compaction';
const REASON_COMPACTION_ABANDONED = 'compaction-abandoned';

type CompactionRow = {
  provider_session_id: string;
  jsonl_path: string;
  session_id: string;
  /** `created_at` as ISO-8601 UTC, converted in the query so the ORDER BY still sorts the raw column. */
  created_iso: string;
  compaction_trigger: string;
  summarizer_model: string;
  summarizer_served: string | null;
  summarizer_effort: string;
  pre_tokens: number | null;
  post_tokens: number | null;
  summarizer_tokens_in: number;
  summarizer_tokens_out: number;
  summarizer_chunks: number;
};

const COMPACTION_SELECT_SQL = `
  SELECT provider_session_id, jsonl_path, session_id,
         strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS created_iso,
         compaction_trigger, summarizer_model, summarizer_served, summarizer_effort,
         pre_tokens, post_tokens, summarizer_tokens_in, summarizer_tokens_out, summarizer_chunks
  FROM superseded_provider_sessions
  WHERE reason = '${REASON_COMPACTION}'`;

// `rowid` breaks the tie between two compactions inside one second, the resolution of CURRENT_TIMESTAMP.
const COMPACTION_ORDER_SQL = 'ORDER BY created_at, rowid';

function toCompactionRecord(row: CompactionRow): CompactionRecord {
  // Only `swapToCompactedSession` writes a 'compaction' row, and it writes every fact, so the
  // columns the type calls non-null are non-null here.
  return {
    oldProviderSessionId: row.provider_session_id,
    oldJsonlPath: row.jsonl_path,
    sessionId: row.session_id,
    createdAt: row.created_iso,
    trigger: row.compaction_trigger as CompactionFacts['trigger'],
    summarizerModel: row.summarizer_model,
    summarizerServed: row.summarizer_served,
    summarizerEffort: row.summarizer_effort,
    preTokens: row.pre_tokens,
    postTokens: row.post_tokens,
    summarizerTokensIn: row.summarizer_tokens_in,
    summarizerTokensOut: row.summarizer_tokens_out,
    chunks: row.summarizer_chunks,
  };
}

/**
 * A provider session id is a bare file-name stem (the CLI's are UUIDs). The new one is joined into a
 * transcript path that the delete paths later unlink, so it may not carry a separator or climb out
 * of the project folder.
 */
const PROVIDER_SESSION_ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const COMPACTION_TRIGGERS: ReadonlyArray<CompactionFacts['trigger']> = ['manual', 'auto', 'idle'];

/**
 * The shape of a seed on both sides of the column: one or more blocks, none of them empty. `Array.from`
 * first, because `every` skips the holes of a sparse array and `JSON.stringify` would store them as null.
 */
function isSeedBlocks(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && Array.from(value).every((block) => typeof block === 'string' && block !== '');
}

/**
 * The seed column read back: the blocks, or null when the column is NULL (an edit's rewind, or a
 * compaction recorded before the column) or holds something that is not what the swap wrote.
 */
function parseStoredSeed(sessionId: string, stored: string | null): string[] | null {
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (isSeedBlocks(parsed)) return parsed;
    console.error(`[compaction-record] session=${sessionId} the stored seed is not a list of non-empty blocks; reading it as no seed.`);
  } catch (error) {
    console.error(`[compaction-record] session=${sessionId} the stored seed is not JSON; reading it as no seed:`, error instanceof Error ? error.message : error);
  }
  return null;
}

/** The two ids and the old path a swap and its take-back both build a transcript path from. */
function assertTranscriptMove(input: {
  oldProviderSessionId: string;
  oldJsonlPath: string;
  newProviderSessionId: string;
}): void {
  for (const [label, id] of [
    ['oldProviderSessionId', input.oldProviderSessionId],
    ['newProviderSessionId', input.newProviderSessionId],
  ] as const) {
    if (typeof id !== 'string' || !PROVIDER_SESSION_ID_PATTERN.test(id)) {
      throw new Error(`${label} is not a provider session id: ${JSON.stringify(id)}.`);
    }
  }
  if (input.oldProviderSessionId === input.newProviderSessionId) {
    throw new Error('A compaction cannot move a chat onto the provider session it is leaving.');
  }
  if (typeof input.oldJsonlPath !== 'string' || !path.isAbsolute(input.oldJsonlPath)) {
    throw new Error(`oldJsonlPath must be an absolute path, got ${JSON.stringify(input.oldJsonlPath)}.`);
  }
}

function assertCount(label: string, value: unknown, nullable: boolean): void {
  if (value === null && nullable) {
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer${nullable ? ' or null' : ''}, got ${String(value)}.`);
  }
}

/**
 * Refuses facts the columns would store as the wrong thing — a NaN as NULL, a fraction as a REAL in an
 * INTEGER column — and a `listCompactions` would then answer `null` where `CompactionRecord` says a number.
 */
function assertCompactionFacts(facts: CompactionFacts): void {
  if (!COMPACTION_TRIGGERS.includes(facts.trigger)) {
    throw new Error(`trigger must be one of ${COMPACTION_TRIGGERS.join(', ')}, got ${JSON.stringify(facts.trigger)}.`);
  }
  for (const [label, value] of [['summarizerModel', facts.summarizerModel], ['summarizerEffort', facts.summarizerEffort]] as const) {
    if (typeof value !== 'string' || value === '') {
      throw new Error(`${label} must be a non-empty string, got ${JSON.stringify(value)}.`);
    }
  }
  if (facts.summarizerServed !== null && (typeof facts.summarizerServed !== 'string' || facts.summarizerServed === '')) {
    throw new Error(`summarizerServed must be a non-empty string or null, got ${JSON.stringify(facts.summarizerServed)}.`);
  }
  assertCount('preTokens', facts.preTokens, true);
  assertCount('summarizerTokensIn', facts.summarizerTokensIn, false);
  assertCount('summarizerTokensOut', facts.summarizerTokensOut, false);
  assertCount('chunks', facts.chunks, false);
}

/**
 * Where the Claude CLI wrote the transcript of a session it started in the same working directory
 * as another: beside it, named by its own id. The compaction's seed append runs in the chat's own
 * cwd, so its transcript lands in the old transcript's project folder.
 */
function siblingTranscriptPath(oldJsonlPath: string, providerSessionId: string): string {
  return path.join(path.dirname(oldJsonlPath), `${providerSessionId}.jsonl`);
}

/**
 * The transcript path a chat swapped onto a new session is pointed at: the new session's own file
 * when the CLI has already written it, else the old transcript, which exists.
 *
 * The CLI creates the new session's file about 100 ms AFTER it announces the session id, which is
 * the moment the swap is written. A row pointing at a file that is not there yet is deleted by the
 * next full sync (`pruneOrphanedSessions` runs on every project-list fetch), taking the chat and its
 * queued messages with it. The indexer sets the path itself once the file appears: it finds the chat
 * by `provider_session_id` and writes `jsonl_path` — and it can only see the file after this
 * synchronous transaction has committed, so there is no window in which the file is missed.
 */
function transcriptPathAfterSwap(oldJsonlPath: string, newProviderSessionId: string): string {
  const seedTranscriptPath = siblingTranscriptPath(oldJsonlPath, newProviderSessionId);
  return fs.existsSync(seedTranscriptPath) ? seedTranscriptPath : oldJsonlPath;
}

/**
 * The record of what a custom compaction did to a chat, and the one place that moves the chat onto
 * its new session and back. Callers outside the database module reach it through the barrel: the
 * compaction module writes it (swap, unswap, post-tokens), and the providers module reads it
 * (`listCompactions` for the chat's stitched history and its sync, `listAllCompactions` for search,
 * `latestCompaction` for the auto-trigger's growth guard and a start-over's seed).
 *
 * A compacted transcript is a `superseded_provider_sessions` row, the table that already means
 * "a transcript this chat left behind" — so the two delete paths, `resolveAppSessionId` and the
 * indexer's refusal cover it without a reader of their own. Rows of every `reason` are read by
 * those; only the two list functions here filter to `compaction`.
 */
export const sessionCompactionsDb = {
  /**
   * Moves a chat onto the new session its compaction started, and records the transcript it left.
   *
   * ONE transaction, so the sidebar and the history can never observe a chat on its new session
   * with no record of the old one, or the reverse. The old transcript's row is upserted (a swap
   * redone over a row of the same id replaces it, with `post_tokens` empty again), then the chat
   * is repointed the way an edit repoints one: `provider_session_id` AND `jsonl_path` together,
   * with any row the watcher already made for the new transcript deleted.
   *
   * `assignProviderSessionId` is the wrong move here on purpose: it keeps `jsonl_path` (its own
   * comment says why), and the history reads the live transcript from `jsonl_path`, so a chat
   * swapped through it would read the old file under the new id until the watcher re-indexed.
   *
   * The `jsonl_path` it writes is the new session's own file beside the old one when that file is
   * already on disk, else the old transcript until the indexer repoints it (see
   * `transcriptPathAfterSwap`): a row naming a file that is not there yet is pruned, with its
   * chat, by the next full sync. In that gap the history reads the old file under the new id.
   *
   * The seed's blocks are stored in the same upsert, as a JSON array, so the record that a
   * compaction happened and the text the new session was given can never be seen apart; a start-over
   * of the chat appends that text again (`latestCompaction`).
   *
   * Refuses, writing nothing, input the columns would store as something else (an empty or
   * relative old path, an id that is not a bare file-name stem, the new id equal to the old,
   * facts that are not counts, a seed that is not one or more non-empty strings) and a chat that is
   * not a Claude chat. Also refuses, rolling
   * everything back, when the chat's row is gone — a record written for a chat that was deleted
   * mid-compaction would outlive it and keep the indexer refusing the old transcript, which then
   * nothing can delete through the app — and when the chat does not stand on `oldProviderSessionId`
   * (or already on `newProviderSessionId`, a duplicate announcement, which repeats the swap).
   */
  swapToCompactedSession(input: {
    sessionId: string;
    oldProviderSessionId: string;
    oldJsonlPath: string;
    newProviderSessionId: string;
    facts: CompactionFacts;
    seed: string[];
  }): void {
    assertTranscriptMove(input);
    assertCompactionFacts(input.facts);
    if (!isSeedBlocks(input.seed)) {
      throw new Error(`seed must be an array of one or more non-empty strings, got ${JSON.stringify(input.seed)}.`);
    }
    const db = getConnection();
    const { facts } = input;

    db.transaction(() => {
      const chat = sessionsDb.getSessionById(input.sessionId);
      if (!chat) {
        throw new Error(`Cannot swap session ${input.sessionId} to a compacted session: it no longer exists.`);
      }
      if (chat.provider !== 'claude') {
        throw new Error(`Cannot swap session ${input.sessionId} to a compacted session: it is a ${chat.provider} chat.`);
      }
      // The transcript recorded as left behind must be the one the chat is really on; handed another
      // id, the swap would strand the chat's real session with no record and the indexer would offer
      // it back as a stray chat. Already standing on the new id is a duplicate announcement: a repeat.
      if (
        chat.provider_session_id !== input.oldProviderSessionId
        && chat.provider_session_id !== input.newProviderSessionId
      ) {
        throw new Error(
          `Cannot swap session ${input.sessionId} to a compacted session: it stands on `
          + `${chat.provider_session_id ?? 'no provider session'}, not on ${input.oldProviderSessionId}.`,
        );
      }

      db.prepare(
        `INSERT INTO superseded_provider_sessions (
           provider_session_id, provider, session_id, jsonl_path, reason,
           compaction_trigger, summarizer_model, summarizer_served, summarizer_effort,
           pre_tokens, post_tokens, summarizer_tokens_in, summarizer_tokens_out, summarizer_chunks, seed
         ) VALUES (?, 'claude', ?, ?, '${REASON_COMPACTION}', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
         ON CONFLICT(provider_session_id, provider) DO UPDATE SET
           session_id = excluded.session_id,
           jsonl_path = excluded.jsonl_path,
           reason = excluded.reason,
           compaction_trigger = excluded.compaction_trigger,
           summarizer_model = excluded.summarizer_model,
           summarizer_served = excluded.summarizer_served,
           summarizer_effort = excluded.summarizer_effort,
           pre_tokens = excluded.pre_tokens,
           post_tokens = excluded.post_tokens,
           summarizer_tokens_in = excluded.summarizer_tokens_in,
           summarizer_tokens_out = excluded.summarizer_tokens_out,
           summarizer_chunks = excluded.summarizer_chunks,
           seed = excluded.seed,
           created_at = CURRENT_TIMESTAMP`
      ).run(
        input.oldProviderSessionId,
        input.sessionId,
        input.oldJsonlPath,
        facts.trigger,
        facts.summarizerModel,
        facts.summarizerServed,
        facts.summarizerEffort,
        facts.preTokens,
        facts.summarizerTokensIn,
        facts.summarizerTokensOut,
        facts.chunks,
        JSON.stringify(input.seed),
      );

      sessionsDb.repointSessionToProviderSession(input.sessionId, {
        providerSessionId: input.newProviderSessionId,
        jsonlPath: transcriptPathAfterSwap(input.oldJsonlPath, input.newProviderSessionId),
      });
    })();
  },

  /**
   * Takes a swap back: the chat returns to its old session and the seed that never took is parked.
   *
   * ONE transaction. The old transcript's compaction row is deleted (only a `compaction` one — an
   * edit's rewind row of the same id is not this function's to remove). The seed's own transcript
   * is recorded as `compaction-abandoned` (at the path the chat holds when the indexer has repointed
   * it to the seed's file, else beside the old transcript), so the indexer never offers an abandoned
   * seed back as a chat and the chat's delete removes the file with the rest. Then the chat is repointed at its
   * old session, `provider_session_id` and `jsonl_path` together.
   *
   * `newProviderSessionId` is the id the seed append announced, the one the swap moved the chat to.
   * It acts only while the chat stands on that id, so a repeat is a no-op and a stale take-back
   * cannot undo a later swap — a retry onto another seed, say. Also does nothing when the chat's
   * row is gone: it was deleted mid-compaction, its delete already cleared every superseded row,
   * and writing the abandoned one now would leave a record with no chat to belong to. Refuses
   * input the swap would have refused.
   */
  unswapCompactedSession(input: {
    sessionId: string;
    oldProviderSessionId: string;
    oldJsonlPath: string;
    newProviderSessionId: string;
  }): void {
    assertTranscriptMove(input);
    const db = getConnection();

    db.transaction(() => {
      const chat = sessionsDb.getSessionById(input.sessionId);
      if (!chat || chat.provider_session_id !== input.newProviderSessionId) {
        return;
      }

      db.prepare(
        `DELETE FROM superseded_provider_sessions
         WHERE provider_session_id = ? AND provider = 'claude' AND session_id = ?
           AND reason = '${REASON_COMPACTION}'`
      ).run(input.oldProviderSessionId, input.sessionId);

      db.prepare(
        `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path, reason)
         VALUES (?, 'claude', ?, ?, '${REASON_COMPACTION_ABANDONED}')
         ON CONFLICT(provider_session_id, provider) DO UPDATE SET
           session_id = excluded.session_id,
           jsonl_path = excluded.jsonl_path,
           reason = excluded.reason`
      ).run(
        input.newProviderSessionId,
        input.sessionId,
        // Where the seed's file really is: the path the indexer repointed the chat to once the file
        // appeared, which can sit outside the old transcript's folder. While the chat still holds
        // the old path the file has not been seen, and the CLI's own place for it is the guess.
        chat.jsonl_path && chat.jsonl_path !== input.oldJsonlPath
          ? chat.jsonl_path
          : siblingTranscriptPath(input.oldJsonlPath, input.newProviderSessionId),
      );

      sessionsDb.repointSessionToProviderSession(input.sessionId, {
        providerSessionId: input.oldProviderSessionId,
        jsonlPath: input.oldJsonlPath,
      });
    })();
  },

  /**
   * Records the chat's context after the seed append, the "after" of the marker's
   * "412K → 14K". Known only once the append's context count has reported, which is after the swap, so
   * it is its own write. Touches a `compaction` row only, and nothing when the row is gone (a swap taken back).
   */
  setCompactionPostTokens(oldProviderSessionId: string, postTokens: number): void {
    if (!Number.isFinite(postTokens) || postTokens < 0) {
      throw new RangeError(`postTokens must be a non-negative number, got ${postTokens}.`);
    }

    const db = getConnection();
    db.prepare(
      `UPDATE superseded_provider_sessions SET post_tokens = ?
       WHERE provider_session_id = ? AND provider = 'claude' AND reason = '${REASON_COMPACTION}'`
    ).run(Math.round(postTokens), oldProviderSessionId);
  },

  /**
   * The chat's newest `compaction` row as the three facts the compaction module reads — where its
   * context stood after the seed append and the seed itself — or null when the chat has none. Newest
   * by `created_at` then `rowid`, the way `COMPACTION_ORDER_SQL` breaks a tie, reversed. The seed is
   * null for a compaction recorded before the column; nothing is backfilled.
   */
  latestCompaction(sessionId: string): LatestCompaction | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT provider_session_id, post_tokens, seed
         FROM superseded_provider_sessions
         WHERE reason = '${REASON_COMPACTION}' AND session_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(sessionId) as { provider_session_id: string; post_tokens: number | null; seed: string | null } | undefined;
    if (!row) return null;

    return {
      oldProviderSessionId: row.provider_session_id,
      postTokens: row.post_tokens,
      seed: parseStoredSeed(sessionId, row.seed),
    };
  },

  /** One chat's compactions, oldest first — the order its stitched history reads them in. */
  listCompactions(sessionId: string): CompactionRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(`${COMPACTION_SELECT_SQL} AND session_id = ? ${COMPACTION_ORDER_SQL}`)
      .all(sessionId) as CompactionRow[];

    return rows.map(toCompactionRecord);
  },

  /** Every chat's compactions, oldest first, for the search that has to name the chat a compacted transcript belongs to. */
  listAllCompactions(): CompactionRecord[] {
    const db = getConnection();
    const rows = db.prepare(`${COMPACTION_SELECT_SQL} ${COMPACTION_ORDER_SQL}`).all() as CompactionRow[];

    return rows.map(toCompactionRecord);
  },
};
