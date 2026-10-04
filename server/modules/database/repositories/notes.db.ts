import { randomUUID } from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

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
 * Consumers: `server/modules/notes/notes.service.ts` — the lane's only reader and writer. Reach it
 * through `@/modules/database/index.js`. Every statement runs on the caller's connection and opens
 * no transaction of its own.
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

  /**
   * Inserts one note under a `randomUUID()` id, both timestamps `new Date().toISOString()`, and
   * answers the row as stored.
   */
  create(input: { userId: number; title: string; description: string }): NoteRow {
    const now = new Date().toISOString();
    const row = getConnection()
      .prepare(
        `INSERT INTO notes (id, user_id, title, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING ${NOTE_COLUMNS}`
      )
      .get(randomUUID(), input.userId, input.title, input.description, now, now) as
      | NoteRow
      | undefined;

    if (!row) throw new Error(`Could not insert note "${input.title}".`);
    return row;
  },

  /**
   * Replaces the title and the description of one of the account's notes and stamps `updated_at`,
   * answering the row as read back after the write. `null` when no row of that account carries the
   * id — including an id that belongs to another account.
   */
  update(userId: number, id: string, input: { title: string; description: string }): NoteRow | null {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE notes SET title = ?, description = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .run(input.title, input.description, new Date().toISOString(), id, userId);

    if (result.changes === 0) return null;

    // The read-back can miss only if another writer deleted the matched row in between; answer
    // `null` then too, so the declared two-state return is never a third (`undefined`) to callers.
    const row = db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ?`)
      .get(id, userId) as NoteRow | undefined;

    return row ?? null;
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
