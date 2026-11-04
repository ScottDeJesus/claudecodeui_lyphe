import { randomUUID } from 'node:crypto';

import type { Database } from 'better-sqlite3';

import { getConnection } from '@/modules/database/connection.js';
import type { SaveOrder } from '@/shared/types.js';

/**
 * `notes`, as row-level statements — the notes lane's own table: one account's cards.
 *
 * Every statement here names the account it acts for — the `WHERE` clause of the three that take
 * an id, `create`'s `VALUES` — so an id that belongs to another account reads as no row and no verb
 * can touch a card its caller does not own. A note is written one row at a time; nothing here
 * rewrites a whole list. The stamps are ISO-8601 UTC with milliseconds, written in JS:
 * `created_at` orders the list and never moves, `updated_at` is the last save, and the two are
 * equal on a fresh row.
 *
 * A SAVE MAY CARRY AN ORDER (`SaveOrder`: a writer — one open tab — and its `seq`). The newest `seq` applied per
 * (note, writer) is kept in `note_save_orders`, and a save whose `seq` is not above it is an older text arriving late:
 * nothing is written and the answer is the note as it stands (`applied: false`). The claim and the write are one
 * transaction, so a refused write leaves no mark and a failed one leaves no claim. A save with no order always writes.
 * Orders of two writers are never compared — two devices stay last-arrival-wins, as they always were. The order's own
 * statements take a note id the same transaction has already matched to the account.
 *
 * Consumers: `server/modules/notes/notes.service.ts` — the lane's only reader and writer. Reach it
 * through `@/modules/database/index.js`. Every statement runs on the caller's connection; only `create`
 * and `update` open a transaction, for the claim above.
 */

/** One `notes` row, exactly as the table stores it — `user_id` included, camelCase left to the service. */
export type NoteRow = {
  id: string;
  user_id: number;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
};

/** Every column of a note, in one spelling: what a read returns and a write reads back. */
const NOTE_COLUMNS = 'id, user_id, title, description, created_at, updated_at';

/** How long a writer's newest order is remembered after its last save: no request is in the air for a day. */
const ORDER_MEMORY_MS = 24 * 60 * 60 * 1000;

/** One write's verdict: the note as it stands afterwards, and whether this save wrote it. */
export type NoteWrite = { row: NoteRow; applied: boolean };

/**
 * Claims `order` for one note: true when it is newer than any order its writer has had applied (a first
 * save of the writer included), and remembers it; false when it is not, and nothing changes. One statement,
 * so the compare and the remember cannot be split. Runs inside the caller's transaction.
 */
function claimOrder(db: Database, noteId: string, order: SaveOrder): boolean {
  const now = Date.now();
  const claim = db
    .prepare(
      `INSERT INTO note_save_orders (note_id, writer, seq, applied_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (note_id, writer) DO UPDATE SET seq = excluded.seq, applied_at = excluded.applied_at
       WHERE excluded.seq > note_save_orders.seq`
    )
    .run(noteId, order.writer, order.seq, new Date(now).toISOString());
  // Forgotten here, on the note's own next claim, so nothing polls: a writer that last saved this note a day ago has nothing in the air.
  db.prepare('DELETE FROM note_save_orders WHERE note_id = ? AND applied_at < ?').run(
    noteId,
    new Date(now - ORDER_MEMORY_MS).toISOString()
  );
  return claim.changes > 0;
}

/** Replaces the text of a row the caller has found, stamps `updated_at`, and reads it back. */
function writeText(db: Database, userId: number, id: string, input: { title: string; description: string }): NoteRow | null {
  const result = db
    .prepare('UPDATE notes SET title = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(input.title, input.description, new Date().toISOString(), id, userId);
  if (result.changes === 0) return null;
  return (db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ?`).get(id, userId) as NoteRow | undefined) ?? null;
}

export const notesDb = {
  /**
   * An account's notes, newest first: `created_at DESC`, then `rowid DESC` so two made in one
   * millisecond still come back in a stable order.
   */
  listForUser(userId: number): NoteRow[] {
    return getConnection()
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ?
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(userId) as NoteRow[];
  },

  /** One of the account's notes by id, or `null` when no row of that account carries it. */
  get(userId: number, id: string): NoteRow | null {
    const row = getConnection()
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ?`)
      .get(id, userId) as NoteRow | undefined;

    return row ?? null;
  },

  /**
   * Inserts one note under a `randomUUID()` id, both timestamps `new Date().toISOString()`, and
   * answers the row as stored with whether this call made it (`created`) and whether it wrote the text (`applied`).
   *
   * `clientKey` is the idempotency key of the request that asked, or `null` for a caller that sends
   * none. A key the account has used before inserts nothing (`created: false`) — one statement,
   * `ON CONFLICT … DO NOTHING`, so two requests with one key cannot both insert, judged against the partial
   * unique index (`NOTES_CLIENT_KEY_INDEX_SQL`); a `null` key can never conflict. What the repeat does with its
   * text depends on `order`: with none, nothing — the answer is the row that key made, exactly as it stands; with
   * one newer than its writer's last applied order (the first attempt's own), the repeat REWRITES the row with
   * its text, which is how a retry carries what was typed after the lost first attempt; and with one that is not
   * newer, it is the late first attempt and writes nothing (nor does a repeat whose text is the note's already). A created row remembers its `order`.
   */
  create(input: {
    userId: number;
    clientKey: string | null;
    title: string;
    description: string;
    order?: SaveOrder | null;
  }): NoteWrite & { created: boolean } {
    const db = getConnection();
    const order = input.order ?? null;
    return db.transaction((): NoteWrite & { created: boolean } => {
      const now = new Date().toISOString();
      const inserted = db
        .prepare(
          `INSERT INTO notes (id, user_id, client_key, title, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, client_key) WHERE client_key IS NOT NULL DO NOTHING
           RETURNING ${NOTE_COLUMNS}`
        )
        .get(randomUUID(), input.userId, input.clientKey, input.title, input.description, now, now) as
        | NoteRow
        | undefined;
      if (inserted) {
        if (order !== null) claimOrder(db, inserted.id, order);
        return { row: inserted, created: true, applied: true };
      }

      // No row came back, so the conflict arm ran: the key's own row is there to read.
      const existing = db
        .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = ? AND client_key = ?`)
        .get(input.userId, input.clientKey) as NoteRow | undefined;
      if (!existing) throw new Error(`Could not insert note "${input.title}".`);
      if (order === null || !claimOrder(db, existing.id, order)) return { row: existing, created: false, applied: false };
      // The retry of a lost answer with nothing typed since: the order is remembered, and there is nothing to write.
      if (existing.title === input.title && existing.description === input.description) {
        return { row: existing, created: false, applied: false };
      }

      const rewritten = writeText(db, input.userId, existing.id, input);
      if (!rewritten) throw new Error(`Could not rewrite note "${existing.id}".`);
      return { row: rewritten, created: false, applied: true };
    }).immediate();
  },

  /**
   * Replaces the title and the description of one of the account's notes and stamps `updated_at`,
   * answering the row as read back after the write. `null` when no row of that account carries the
   * id — including an id that belongs to another account. With an `order` not newer than its writer's
   * last applied one nothing is written and the answer is the row as it stands (`applied: false`).
   */
  update(userId: number, id: string, input: { title: string; description: string }, order: SaveOrder | null = null): NoteWrite | null {
    const db = getConnection();
    return db.transaction((): NoteWrite | null => {
      const current = db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ?`).get(id, userId) as
        | NoteRow
        | undefined;
      if (!current) return null;
      if (order !== null && !claimOrder(db, id, order)) return { row: current, applied: false };

      const row = writeText(db, userId, id, input);
      return row ? { row, applied: true } : null;
    }).immediate();
  },

  /**
   * Deletes one of the account's notes, reporting whether a row of that account was there to
   * delete. `false` when no row carries the id — including an id of another account.
   */
  remove(userId: number, id: string): boolean {
    const result = getConnection()
      .prepare('DELETE FROM notes WHERE id = ? AND user_id = ?')
      .run(id, userId);

    return result.changes > 0;
  },
};
