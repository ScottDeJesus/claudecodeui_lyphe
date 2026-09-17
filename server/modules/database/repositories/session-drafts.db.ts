import { getConnection } from '@/modules/database/connection.js';

/**
 * One chat scope's unsent state: the text still in the composer, plus the
 * message queued behind an in-flight turn. Both are optional — a scope can
 * hold only a draft, only a queued message, or both.
 */
export type SessionDraftRecord = {
  scope: string;
  text: string;
  queuedMessage: unknown | null;
  updatedAt: string;
};

type DraftRow = {
  draft_scope: string;
  draft_text: string;
  queued_message: string | null;
  updated_at: string;
};

/** A server-owned queued turn together with the exact stored value used to claim it once. */
export type QueuedSessionMessageRecord = {
  userId: number;
  sessionId: string;
  queuedMessage: unknown;
  claimToken: string;
};

type QueuedMessageRow = {
  user_id: number;
  draft_scope: string;
  queued_message: string;
};

/** The client-minted id a queued message carries, when it carries one. */
function queuedMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

/** A queued message that no longer parses is treated as absent, not fatal. */
function parseQueuedMessage(raw: string | null): unknown | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function toRecord(row: DraftRow): SessionDraftRecord {
  return {
    scope: row.draft_scope,
    text: row.draft_text,
    queuedMessage: parseQueuedMessage(row.queued_message),
    updatedAt: row.updated_at,
  };
}

export const sessionDraftsDb = {
  /**
   * Returns every draft the user has, newest first.
   *
   * The client pulls the whole set once per load: drafts are short strings, and
   * having them all up front means switching sessions restores a draft written
   * on another device without a round trip.
   */
  getDrafts(userId: number): SessionDraftRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT draft_scope, draft_text, queued_message, updated_at
         FROM session_drafts
         WHERE user_id = ? AND (draft_text != '' OR queued_message IS NOT NULL)
         ORDER BY datetime(updated_at) DESC`
      )
      .all(userId) as DraftRow[];

    return rows.map(toRecord);
  },

  /** Lists persisted queued turns whose scopes are real chat sessions. */
  listQueuedMessages(): QueuedSessionMessageRecord[] {
    const rows = getConnection()
      .prepare(
        `SELECT drafts.user_id, drafts.draft_scope, drafts.queued_message
         FROM session_drafts AS drafts
         INNER JOIN sessions ON sessions.session_id = drafts.draft_scope
         WHERE drafts.queued_message IS NOT NULL`
      )
      .all() as QueuedMessageRow[];

    return rows.map((row) => ({
      userId: row.user_id,
      sessionId: row.draft_scope,
      queuedMessage: parseQueuedMessage(row.queued_message),
      claimToken: row.queued_message,
    }));
  },

  /** Atomically removes a queued turn only if it has not been edited since listing. */
  claimQueuedMessage(candidate: QueuedSessionMessageRecord): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE session_drafts
         SET queued_message = NULL,
             last_claimed_queue_id = COALESCE(?, last_claimed_queue_id),
             updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ? AND queued_message = ?`
      )
      .run(queuedMessageId(candidate.queuedMessage), candidate.userId, candidate.sessionId, candidate.claimToken);
    return result.changes > 0;
  },

  /**
   * Puts back a claimed turn that did not start. The claim's memory is cleared with it: that claim
   * sent nothing, so the id must not read as already sent.
   */
  restoreQueuedMessage(candidate: QueuedSessionMessageRecord): void {
    getConnection()
      .prepare(
        `UPDATE session_drafts
         SET queued_message = ?, last_claimed_queue_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ? AND queued_message IS NULL`
      )
      .run(candidate.claimToken, candidate.userId, candidate.sessionId);
  },

  /** Removes an empty placeholder row, unless it holds the id of a queued message it already sent. */
  deleteEmptyDraft(userId: number, scope: string): void {
    getConnection()
      .prepare(
        `DELETE FROM session_drafts
         WHERE user_id = ? AND draft_scope = ? AND draft_text = '' AND queued_message IS NULL
           AND last_claimed_queue_id IS NULL`
      )
      .run(userId, scope);
  },

  /**
   * Writes the parts of one scope's draft the caller sent, then deletes the row when nothing is
   * left to keep.
   *
   * The two parts are written independently: a composer saving its text must never touch the
   * queued message, because the dispatcher may already have claimed (and sent) the queued copy
   * that client still holds — writing it back is a second send. An absent part keeps its column.
   *
   * Deleting on empty is what stops the table growing a permanent row for every session the user
   * ever opened and typed a character into.
   */
  saveDraft(
    userId: number,
    scope: string,
    draft: { text?: string; queuedMessage?: unknown | null }
  ): void {
    const db = getConnection();
    const hasText = draft.text !== undefined;
    let hasQueued = draft.queuedMessage !== undefined;

    // A queued message this scope has already sent comes back only from a stale copy — a retry
    // whose first response was lost, an old tab. Writing it would send it again.
    const incomingId = queuedMessageId(draft.queuedMessage);
    if (hasQueued && incomingId) {
      const row = db
        .prepare('SELECT last_claimed_queue_id FROM session_drafts WHERE user_id = ? AND draft_scope = ?')
        .get(userId, scope) as { last_claimed_queue_id: string | null } | undefined;
      if (row?.last_claimed_queue_id === incomingId) {
        hasQueued = false;
      }
    }
    if (!hasText && !hasQueued) {
      return;
    }
    const queuedJson = draft.queuedMessage == null ? null : JSON.stringify(draft.queuedMessage);

    db.transaction(() => {
      db.prepare(
        `INSERT INTO session_drafts (user_id, draft_scope, draft_text, queued_message, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, draft_scope) DO UPDATE SET
           draft_text = CASE WHEN ? THEN excluded.draft_text ELSE draft_text END,
           queued_message = CASE WHEN ? THEN excluded.queued_message ELSE queued_message END,
           updated_at = CURRENT_TIMESTAMP`
      ).run(userId, scope, draft.text ?? '', queuedJson, hasText ? 1 : 0, hasQueued ? 1 : 0);

      // A row that remembers the last queued message it sent is kept even when empty: dropping it
      // would forget the id and let a late retry send that message again. One small row per session
      // that ever queued; `getDrafts` does not return the empty ones.
      db.prepare(
        `DELETE FROM session_drafts
         WHERE user_id = ? AND draft_scope = ? AND draft_text = '' AND queued_message IS NULL
           AND last_claimed_queue_id IS NULL`
      ).run(userId, scope);
    })();
  },

  /**
   * The legacy clear, still called by browsers loaded before the per-part saves. Empties the row
   * rather than deleting it outright, so the memory of the last sent queued message survives.
   */
  deleteDraft(userId: number, scope: string): void {
    const db = getConnection();
    db.transaction(() => {
      db.prepare(
        `UPDATE session_drafts SET draft_text = '', queued_message = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND draft_scope = ?`
      ).run(userId, scope);
      db.prepare(
        `DELETE FROM session_drafts
         WHERE user_id = ? AND draft_scope = ? AND last_claimed_queue_id IS NULL`
      ).run(userId, scope);
    })();
  },
};
