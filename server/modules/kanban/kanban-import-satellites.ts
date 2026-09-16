import { kanbanImportDb } from '@/modules/database/index.js';

import {
  importTable,
  isoOrNull,
  lookup,
  maybe,
  stamp,
  type ImportTableResult,
} from './kanban-import-pass.js';
import type { DescentSourceRows } from './kanban-import.transport.js';

/**
 * The card's satellites: the six source tables that hang off a feature and carry no timestamp
 * guard of their own — questions, issues, decisions, checklist items, attachments, and the
 * imported audit rows.
 *
 * They are apart from the board and card passes for one reason, and it is a rule rather than a
 * size: NONE of the six is guarded, so Descent overwrites them in full on every run. A guarded
 * child would be worse than either rule applied whole — a card whose questions came from here and
 * whose issues came from there is a card nobody can reason about — and none of the six has a
 * local editing surface to protect. Keeping them in one file is what makes that rule visible
 * rather than remembered.
 *
 * Every one of them translates its parent card through the map the card pass built, so this runs
 * strictly after that pass and strictly after the board this run is about is known.
 */

/** The six passes, in the order they must run. */
export type SatellitePasses = {
  questions: ImportTableResult;
  issues: ImportTableResult;
  decisions: ImportTableResult;
  checklist: ImportTableResult;
  attachments: ImportTableResult;
  events: ImportTableResult;
};

export function mapCardSatellites(input: {
  source: DescentSourceRows;
  /** Descent feature id to the local card id it landed under. */
  cards: Map<string, string>;
  /** Descent feature id to the local board its card landed on, for the audit rows. */
  boardOfCard: Map<string, string>;
  /** The board this run is about: where an audit row with no card is filed. */
  importBoardId: string;
}): SatellitePasses {
  const { source, cards, boardOfCard, importBoardId } = input;

  const questions = importTable({
    table: 'kanban_questions',
    prefix: 'q',
    rows: source.questions,
    descentId: (row) => row.id,
    canLand: (row) => lookup(cards, row.feature_id) !== '',
    write: (row, id) =>
      kanbanImportDb.upsertQuestion({
        id,
        cardId: lookup(cards, row.feature_id),
        text: row.text ?? '',
        multi: row.multi === 1,
        options: row.options,
        selected: row.selected,
        otherOn: row.other_on === 1,
        other: row.other,
        answered: row.answered === 1,
        sortOrder: row.sort_order ?? 0,
        createdAt: stamp(row.created_at),
        answeredAt: isoOrNull(row.answered_at),
        descentId: row.id,
      }),
  });

  const issues = importTable({
    table: 'kanban_issues',
    prefix: 'i',
    rows: source.issues,
    descentId: (row) => row.id,
    canLand: (row) => lookup(cards, row.feature_id) !== '',
    write: (row, id) =>
      kanbanImportDb.upsertIssue({
        id,
        cardId: lookup(cards, row.feature_id),
        text: row.text ?? '',
        resolved: row.resolved === 1,
        filedAt: stamp(row.filed_at),
        resolvedAt: isoOrNull(row.resolved_at),
        resolvedBy: row.resolved_by,
        descentId: row.id,
      }),
  });

  const decisions = importTable({
    table: 'kanban_decisions',
    prefix: 'd',
    rows: source.decisions,
    descentId: (row) => row.id,
    // A decision survives its card here (`kanban_decisions.card_id` is nullable and SET NULL), so
    // there is nothing to skip: a parent that never landed becomes a null, not a lost row. Its
    // `question_id` translates through the questions just above and is null when the decision
    // named a question Descent no longer has — the decision's own text is kept either way.
    write: (row, id) =>
      kanbanImportDb.upsertDecision({
        id,
        cardId: maybe(cards, row.feature_id),
        questionId: maybe(questions.ids, row.question_id),
        question: row.question ?? '',
        choice: row.choice ?? '[]',
        tags: row.tags,
        createdAt: stamp(row.created_at),
        descentId: row.id,
      }),
  });

  const checklist = importTable({
    table: 'kanban_checklist_items',
    prefix: 'k',
    rows: source.checklist,
    descentId: (row) => row.id,
    canLand: (row) => lookup(cards, row.feature_id) !== '',
    write: (row, id) =>
      kanbanImportDb.upsertChecklistItem({
        id,
        cardId: lookup(cards, row.feature_id),
        text: row.text,
        state: row.state,
        sortOrder: row.sort_order,
        note: row.note,
        createdAt: stamp(row.created_at),
        doneAt: isoOrNull(row.done_at),
        descentId: row.id,
      }),
  });

  const attachments = importTable({
    table: 'kanban_attachments',
    prefix: 'a',
    rows: source.attachments,
    descentId: (row) => row.id,
    canLand: (row) => lookup(cards, row.feature_id) !== '',
    write: (row, id) =>
      kanbanImportDb.upsertAttachment({
        id,
        cardId: lookup(cards, row.feature_id),
        filename: row.filename ?? '',
        mime: row.mime ?? '',
        size: row.size ?? 0,
        createdAt: stamp(row.created_at),
        descentId: row.id,
      }),
  });

  const events = importTable({
    table: 'kanban_events',
    rows: source.events,
    descentId: (row) => String(row.id),
    // Descent's `ov_events` has no board column at all, and its log is the install's — so an
    // event whose card is gone lands on the board being imported rather than nowhere, which is
    // what keeps half the operator's history reachable instead of half of it stranded.
    write: (row) =>
      kanbanImportDb.upsertEvent({
        ts: stamp(row.ts),
        kind: row.kind ?? 'descent.event',
        // `||` and not `??`, because the fallback has two ways to be needed: the feature may be
        // absent from the map (a card Descent has since deleted) or present with the empty string
        // (a card whose board did not resolve). Both mean "this row belongs to the board being
        // imported" — an empty `board_id` would strand the row off every board's audit view.
        boardId: boardOfCard.get(row.feature_id ?? '') || importBoardId,
        cardId: maybe(cards, row.feature_id),
        actor: row.actor,
        payload: row.payload ?? '{}',
        descentId: String(row.id),
      }),
  });

  return { questions, issues, decisions, checklist, attachments, events };
}
