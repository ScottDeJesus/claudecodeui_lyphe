import { getConnection } from '@/modules/database/connection.js';
import type {
  KanbanImportAttachment,
  KanbanImportChecklistItem,
  KanbanImportDecision,
  KanbanImportEvent,
  KanbanImportIssue,
  KanbanImportQuestion,
} from '@/modules/database/repositories/kanban-import-rows.db.js';

/**
 * The Descent importer's child-table writes: the six tables that hang off a card, spread into
 * `kanbanImportDb` beside the board and card statements.
 *
 * They are apart from those two for one reason, and it is a rule rather than a size: NONE of
 * these six carries a timestamp guard. Descent overwrites them every run, in full. A guarded
 * child would be worse than either rule applied whole — a card whose questions came from here and
 * whose issues came from there is a card nobody can reason about — and none of the six has a
 * local editing surface to protect anyway. Keeping the guarded pair and the unguarded six in
 * separate files is what makes that rule visible rather than remembered.
 *
 * Every statement keys on `descent_id` (except the tags, whose pair is its own key) and returns
 * its `changes` count, so the caller can tell an insert from a refresh without a second read.
 */

export const kanbanImportChildrenDb = {
  /** Inserts or refreshes one question. */
  upsertQuestion(question: KanbanImportQuestion): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_questions (id, card_id, text, multi, options, selected, other_on, other,
                                       answered, sort_order, created_at, answered_at, descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           card_id = excluded.card_id, text = excluded.text, multi = excluded.multi,
           options = excluded.options, selected = excluded.selected,
           other_on = excluded.other_on, other = excluded.other, answered = excluded.answered,
           sort_order = excluded.sort_order, created_at = excluded.created_at,
           answered_at = excluded.answered_at`
      )
      .run(
        question.id,
        question.cardId,
        question.text,
        question.multi ? 1 : 0,
        question.options,
        question.selected,
        question.otherOn ? 1 : 0,
        question.other,
        question.answered ? 1 : 0,
        question.sortOrder,
        question.createdAt,
        question.answeredAt,
        question.descentId
      ).changes;
  },

  /** Inserts or refreshes one issue. */
  upsertIssue(issue: KanbanImportIssue): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_issues (id, card_id, text, resolved, filed_at, resolved_at, resolved_by,
                                    descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           card_id = excluded.card_id, text = excluded.text, resolved = excluded.resolved,
           filed_at = excluded.filed_at, resolved_at = excluded.resolved_at,
           resolved_by = excluded.resolved_by`
      )
      .run(
        issue.id,
        issue.cardId,
        issue.text,
        issue.resolved ? 1 : 0,
        issue.filedAt,
        issue.resolvedAt,
        issue.resolvedBy,
        issue.descentId
      ).changes;
  },

  /**
   * Inserts or refreshes one decision.
   *
   * `question_id` is a translated LypheCLI id and NOT Descent's own: the column is a local
   * pointer, and an id from another database in it would name a question that is not here.
   */
  upsertDecision(decision: KanbanImportDecision): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_decisions (id, card_id, question_id, question, choice, tags, created_at,
                                       descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           card_id = excluded.card_id, question_id = excluded.question_id,
           question = excluded.question, choice = excluded.choice, tags = excluded.tags,
           created_at = excluded.created_at`
      )
      .run(
        decision.id,
        decision.cardId,
        decision.questionId,
        decision.question,
        decision.choice,
        decision.tags,
        decision.createdAt,
        decision.descentId
      ).changes;
  },

  /** Inserts or refreshes one checklist item. */
  upsertChecklistItem(item: KanbanImportChecklistItem): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_checklist_items (id, card_id, text, state, sort_order, note, created_at,
                                             done_at, descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           card_id = excluded.card_id, text = excluded.text, state = excluded.state,
           sort_order = excluded.sort_order, note = excluded.note,
           created_at = excluded.created_at, done_at = excluded.done_at`
      )
      .run(
        item.id,
        item.cardId,
        item.text,
        item.state,
        item.sortOrder,
        item.note,
        item.createdAt,
        item.doneAt,
        item.descentId
      ).changes;
  },

  /** Inserts or refreshes one attachment's metadata row. */
  upsertAttachment(attachment: KanbanImportAttachment): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_attachments (id, card_id, filename, mime, size, created_at, descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           card_id = excluded.card_id, filename = excluded.filename, mime = excluded.mime,
           size = excluded.size, created_at = excluded.created_at`
      )
      .run(
        attachment.id,
        attachment.cardId,
        attachment.filename,
        attachment.mime,
        attachment.size,
        attachment.createdAt,
        attachment.descentId
      ).changes;
  },

  /**
   * Inserts or refreshes one imported audit row, keyed on the Descent event's own id.
   *
   * The `import.descent` row this run's own write records is NOT one of these: it has no
   * `descent_id`, so the write seam appends it like every other event and it never collides with
   * the history being imported.
   */
  upsertEvent(event: KanbanImportEvent): number {
    const db = getConnection();
    return db
      .prepare(
        `INSERT INTO kanban_events (ts, kind, board_id, card_id, actor, payload, descent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(descent_id) DO UPDATE SET
           ts = excluded.ts, kind = excluded.kind, board_id = excluded.board_id,
           card_id = excluded.card_id, actor = excluded.actor, payload = excluded.payload`
      )
      .run(
        event.ts,
        event.kind,
        event.boardId,
        event.cardId,
        event.actor,
        event.payload,
        event.descentId
      ).changes;
  },
};
