import { getConnection } from '@/modules/database/connection.js';
import type { KanbanAttachment, KanbanChecklistItem, KanbanIssue } from '@/shared/kanban-types.js';

/**
 * The three child tables a card's drawer shows beside its text: its checklist, its attachments and
 * the issues filed against it.
 *
 * They share a repository because they share a reader and a shape — each is a small list of rows
 * owned by one card, listed in one page, and written once per verb. Splitting them would be three
 * files whose statements are the same statement with different columns.
 *
 * Consumers: `kanban-checklist.service.ts` (every checklist, attachment and issue verb), and
 * `kanban-cards.service.ts`'s `getCard`. Reach it through `@/modules/database/index.js`. Every
 * statement runs on the caller's connection, so one issued inside the write seam's transaction
 * joins that transaction rather than opening a second one.
 */

/** One `kanban_checklist_items` row. */
type KanbanChecklistRow = {
  id: string;
  card_id: string;
  text: string;
  state: 'pending' | 'active' | 'done';
  sort_order: number;
  note: string;
  created_at: string;
  done_at: string | null;
};

/** One `kanban_attachments` row — the metadata, never the bytes. */
type KanbanAttachmentRow = {
  id: string;
  card_id: string;
  filename: string;
  mime: string;
  size: number;
  created_at: string;
};

/** One `kanban_issues` row. */
type KanbanIssueRow = {
  id: string;
  card_id: string;
  text: string;
  resolved: number;
  filed_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

/** Every column of each table, in one spelling, so no read is the odd one out. */
const CHECKLIST_COLUMNS = `id, card_id, text, state, sort_order, note, created_at, done_at`;
const ATTACHMENT_COLUMNS = `id, card_id, filename, mime, size, created_at`;
const ISSUE_COLUMNS = `id, card_id, text, resolved, filed_at, resolved_at, resolved_by`;

function toChecklistItem(row: KanbanChecklistRow): KanbanChecklistItem {
  return {
    id: row.id,
    cardId: row.card_id,
    text: row.text,
    state: row.state,
    sortOrder: row.sort_order,
    note: row.note,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

function toAttachment(row: KanbanAttachmentRow): KanbanAttachment {
  return {
    id: row.id,
    cardId: row.card_id,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    createdAt: row.created_at,
  };
}

function toIssue(row: KanbanIssueRow): KanbanIssue {
  return {
    id: row.id,
    cardId: row.card_id,
    text: row.text,
    resolved: row.resolved === 1,
    filedAt: row.filed_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

/**
 * One checklist item, one attachment and one issue, as stored.
 *
 * Nothing here writes outside a caller's transaction, and every id is the caller's — already
 * minted inside the write's own transaction, never here.
 */
export const kanbanChecklistDb = {
  /**
   * Inserts one checklist item at the bottom of its card's ladder and returns it as stored.
   *
   * `sort_order` is one rung past the card's last item, assigned in the same statement, so the
   * list keeps the order its steps were written in.
   */
  insertChecklistItem(input: {
    id: string;
    cardId: string;
    text: string;
    note: string;
  }): KanbanChecklistItem {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_checklist_items (id, card_id, text, state, sort_order, note, created_at)
         VALUES (
           ?, ?, ?, 'pending',
           (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM kanban_checklist_items WHERE card_id = ?),
           ?, ?
         )
         RETURNING ${CHECKLIST_COLUMNS}`
      )
      .get(input.id, input.cardId, input.text, input.cardId, input.note, new Date().toISOString()) as
      | KanbanChecklistRow
      | undefined;

    if (!row) throw new Error(`Could not insert kanban checklist item "${input.id}".`);
    return toChecklistItem(row);
  },

  /** One card's checklist, in the order its steps were written. */
  listChecklistItems(cardId: string): KanbanChecklistItem[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${CHECKLIST_COLUMNS} FROM kanban_checklist_items
         WHERE card_id = ? ORDER BY sort_order ASC, id ASC`
      )
      .all(cardId) as KanbanChecklistRow[];

    return rows.map(toChecklistItem);
  },

  /** One checklist item, or null when no such item exists. */
  getChecklistItem(itemId: string): KanbanChecklistItem | null {
    const row = getConnection()
      .prepare(`SELECT ${CHECKLIST_COLUMNS} FROM kanban_checklist_items WHERE id = ?`)
      .get(itemId) as KanbanChecklistRow | undefined;

    return row ? toChecklistItem(row) : null;
  },

  /**
   * Applies a patch to one checklist item and reports whether an item was there to change.
   *
   * `done_at` is decided with `state` in the same statement, never by the caller: an item marked
   * done is stamped, and one moved back to `pending` or `active` has its stamp cleared — a `done`
   * time left on an item that is not done is a drawer showing a step finished that is not.
   */
  updateChecklistItem(patch: {
    id: string;
    state?: 'pending' | 'active' | 'done';
    text?: string;
    note?: string;
  }): boolean {
    const assignments: string[] = [];
    const values: (string | null)[] = [];

    if (patch.text !== undefined) {
      assignments.push('text = ?');
      values.push(patch.text);
    }
    if (patch.note !== undefined) {
      assignments.push('note = ?');
      values.push(patch.note);
    }
    if (patch.state !== undefined) {
      assignments.push('state = ?', 'done_at = ?');
      values.push(patch.state, patch.state === 'done' ? new Date().toISOString() : null);
    }

    values.push(patch.id);
    const result = getConnection()
      .prepare(`UPDATE kanban_checklist_items SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values);

    return result.changes > 0;
  },

  /** Removes one checklist item, reporting whether an item was there to remove. */
  deleteChecklistItem(itemId: string): boolean {
    const result = getConnection()
      .prepare('DELETE FROM kanban_checklist_items WHERE id = ?')
      .run(itemId);

    return result.changes > 0;
  },

  /** Records one attachment's metadata and returns it as stored. The bytes are not this table's. */
  insertAttachment(input: {
    id: string;
    cardId: string;
    filename: string;
    mime: string;
    size: number;
  }): KanbanAttachment {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_attachments (id, card_id, filename, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING ${ATTACHMENT_COLUMNS}`
      )
      .get(
        input.id,
        input.cardId,
        input.filename,
        input.mime,
        input.size,
        new Date().toISOString()
      ) as KanbanAttachmentRow | undefined;

    if (!row) throw new Error(`Could not insert kanban attachment "${input.id}".`);
    return toAttachment(row);
  },

  /** One card's attachments, oldest first. */
  listAttachments(cardId: string): KanbanAttachment[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${ATTACHMENT_COLUMNS} FROM kanban_attachments
         WHERE card_id = ? ORDER BY created_at ASC, id ASC`
      )
      .all(cardId) as KanbanAttachmentRow[];

    return rows.map(toAttachment);
  },

  /** Files one issue against a card and returns it as stored. */
  insertIssue(input: { id: string; cardId: string; text: string }): KanbanIssue {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_issues (id, card_id, text, resolved, filed_at)
         VALUES (?, ?, ?, 0, ?)
         RETURNING ${ISSUE_COLUMNS}`
      )
      .get(input.id, input.cardId, input.text, new Date().toISOString()) as
      | KanbanIssueRow
      | undefined;

    if (!row) throw new Error(`Could not insert kanban issue "${input.id}".`);
    return toIssue(row);
  },

  /** One card's issues, oldest first — the order they were filed in. */
  listIssues(cardId: string): KanbanIssue[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${ISSUE_COLUMNS} FROM kanban_issues WHERE card_id = ? ORDER BY filed_at ASC, id ASC`
      )
      .all(cardId) as KanbanIssueRow[];

    return rows.map(toIssue);
  },

  /** One issue, or null when no such issue exists. */
  getIssue(issueId: string): KanbanIssue | null {
    const row = getConnection()
      .prepare(`SELECT ${ISSUE_COLUMNS} FROM kanban_issues WHERE id = ?`)
      .get(issueId) as KanbanIssueRow | undefined;

    return row ? toIssue(row) : null;
  },

  /**
   * Marks one issue resolved and names who resolved it.
   *
   * The boolean is the same refusal channel the other verbs use: false means there was no such
   * issue, which the caller turns into a 404. Resolving an already-resolved issue is not an error —
   * it re-stamps the resolution, which is the honest reading of asking twice.
   */
  resolveIssue(input: { id: string; resolvedBy: string | null }): boolean {
    const result = getConnection()
      .prepare(
        'UPDATE kanban_issues SET resolved = 1, resolved_at = ?, resolved_by = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), input.resolvedBy, input.id);

    return result.changes > 0;
  },
};
