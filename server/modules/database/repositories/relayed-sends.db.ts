import { getConnection } from '@/modules/database/connection.js';

/**
 * `relayed_sends`, as row-level statements — every brief Kaylee has sent into a chat.
 *
 * A row is a fact about the CHAT'S history ("this message came to the chat through Kaylee"), so it
 * is keyed on the chat's app session id and survives Kaylee's Clear; only the chat's deletion takes
 * it away (the foreign key's cascade, `companion-schema.ts`). Nothing here updates or deletes a row.
 * `sent_at` is ISO-8601 UTC with milliseconds, written in JS.
 *
 * NO MERGE PATH MOVES THESE ROWS, ON PURPOSE. The three paths in `sessions.db.ts` that delete a
 * watcher's duplicate row (`assignProviderSessionId`, `repointSessionToProviderSession`,
 * `createForkedSession`) move the followups first because the cascade would take them; they do
 * not move these, and none needs to. The row each deletes is a watcher row — its `session_id` IS
 * its provider session id — and the companion records a send only for a chat of her list, a row
 * whose `session_id` differs from its `provider_session_id`. A send therefore never sits on a row a
 * merge removes. A writer that records sends for any other kind of row must extend those paths
 * (MAN-9003 lists them) before it does.
 *
 * The text is stored TRIMMED, so the history mark (`session-relayed-sends.ts`), which compares a
 * user message's trimmed content with it, matches a brief that was sent with surrounding whitespace.
 * `message_uuid` is the transcript uuid of the user row the send became, when the send knew it (a turn: the
 * uuid it stamped on its message); the mark matches such a send by that row, never by its words. NULL for a
 * steer and for every send recorded before the column.
 *
 * Consumers: `server/modules/companion/` writes a row when `send_to_session` or `create_session`
 * hands a brief to a chat, and `server/modules/providers/services/session-relayed-sends.ts` reads a
 * chat's rows to mark the matching user messages "Through Kaylee" when history is fetched. Reach it
 * through `@/modules/database/index.js`.
 */

/** One `relayed_sends` row, exactly as the table stores it. */
export type RelayedSendRow = {
  id: number;
  session_id: string;
  /** How the brief travelled — the companion's own word for it (its send mode, such as `turn` or `steer`); the table does not judge it. */
  via: string;
  text: string;
  sent_at: string;
  message_uuid: string | null;
};

const RELAYED_SEND_COLUMNS = 'id, session_id, via, text, sent_at, message_uuid';

export const relayedSendsDb = {
  /**
   * Records one relayed brief for the chat — its text trimmed — stamped now, and answers the row as stored.
   * `messageUuid` is the uuid the send stamped on its user message, for a send that did (a turn).
   */
  record(sessionId: string, via: string, text: string, messageUuid: string | null = null): RelayedSendRow {
    const row = getConnection()
      .prepare(
        `INSERT INTO relayed_sends (session_id, via, text, sent_at, message_uuid)
         VALUES (?, ?, ?, ?, ?)
         RETURNING ${RELAYED_SEND_COLUMNS}`
      )
      .get(sessionId, via, text.trim(), new Date().toISOString(), messageUuid) as RelayedSendRow | undefined;

    if (!row) throw new Error(`Could not record a relayed send for session ${sessionId}.`);
    return row;
  },

  /** Every brief relayed into the chat, oldest first. */
  listForSession(sessionId: string): RelayedSendRow[] {
    return getConnection()
      .prepare(`SELECT ${RELAYED_SEND_COLUMNS} FROM relayed_sends WHERE session_id = ? ORDER BY id`)
      .all(sessionId) as RelayedSendRow[];
  },
};
