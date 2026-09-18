import fs from 'node:fs';
import path from 'node:path';

import { kanbanChecklistDb, kanbanImportDb } from '@/modules/database/index.js';
import { importDescentCandidates } from '@/modules/memory-intake/index.js';
import type { KanbanAttachmentCopy } from '@/shared/kanban-types.js';
import { resolveUnderRoot } from '@/shared/utils.js';

import { ATTACHMENT_MIME_TO_EXT, attachmentsRoot } from './kanban-attachments.service.js';
import {
  importTable,
  isoOrNull,
  lookup,
  maybe,
  stamp,
  type ImportTableResult,
} from './kanban-import-pass.js';
import type { DescentAttachmentRow, DescentSourceRows } from './kanban-import.transport.js';

/**
 * The card's satellites: the source tables that hang off a feature and carry no timestamp guard of
 * their own — questions, issues, decisions, checklist items, attachments, the imported audit rows,
 * and the install's lessons.
 *
 * They are apart from the board and card passes for one reason, and it is a rule rather than a
 * size: NONE of them is guarded, so Descent overwrites them in full on every run. A guarded child
 * would be worse than either rule applied whole — a card whose questions came from here and whose
 * issues came from there is a card nobody can reason about — and none of them has a local editing
 * surface a guard would protect. Keeping them in one file is what makes that rule visible rather
 * than remembered.
 *
 * TWO THINGS RIDE ALONG THAT ARE NOT SATELLITES, and both are here because an import is one act
 * with one button. The memory candidates belong to the memory lane (`modules/memory-intake/`): this
 * file hands their rows over and keeps only the count it reads back. The attachment BYTES belong to
 * the card: this file plans the copy and `placeAttachmentBytes` below runs it once the transaction
 * has committed, at the caller that answers the operator.
 *
 * Every one of the passes translates its parent card through the map the card pass built, so this
 * runs strictly after that pass and strictly after the board this run is about is known.
 */

/** The passes, in the order they must run, and the two things that travel beside them. */
export type SatellitePasses = {
  questions: ImportTableResult;
  issues: ImportTableResult;
  decisions: ImportTableResult;
  checklist: ImportTableResult;
  attachments: ImportTableResult;
  events: ImportTableResult;
  lessons: ImportTableResult;
  /** Rows the memory lane wrote. Its own count, not an `ImportPass` — the board keeps no tally. */
  memory: number;
  /** The bytes to copy once the seam's transaction has committed. See `KanbanAttachmentCopy`. */
  attachmentCopies: KanbanAttachmentCopy[];
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

  // The lessons: the one pass whose parent is the ESTATE rather than a card. `feature_id` is
  // resolved to the imported card when there is one and to NULL when there is not — a lesson
  // outlives the card it was learned on, so a card this board never imported costs the lesson its
  // provenance and never the row. The `ls` ids are minted here like every other table's; Descent's
  // own `ls-<n>` ids live in `descent_id`, which is what keeps them out of this table's key space.
  const lessons = importTable({
    table: 'kanban_lessons',
    prefix: 'ls',
    rows: source.lessons,
    descentId: (row) => row.id,
    write: (row, id) =>
      kanbanImportDb.upsertLesson({
        id,
        cardId: maybe(cards, row.feature_id),
        name: row.name ?? '',
        summary: row.summary ?? '',
        body: row.body ?? '',
        trigger: row.trigger ?? '',
        kind: row.kind ?? 'note',
        tags: row.tags ?? '[]',
        status: row.status ?? 'staged',
        source: row.source ?? 'metis',
        draftPath: row.draft_path,
        createdAt: stamp(row.created_at),
        reviewedAt: isoOrNull(row.reviewed_at),
        descentId: row.id,
      }),
  });

  // The memory candidates are NOT a board satellite: no board, no card, no lane, no frame. Their
  // rows go to the one lane that owns that table and this file keeps only the count it reads back —
  // one button for the operator, one owner per lane. Nothing is skipped: a candidate whose `target`
  // is a word this lane's own door would refuse is still a row the operator lived with, and
  // refusing it would fail a whole board import over it.
  const memory = importDescentCandidates(source.memoryCandidates);

  return {
    questions,
    issues,
    decisions,
    checklist,
    attachments,
    events,
    lessons,
    memory,
    attachmentCopies: planAttachmentCopies({
      rows: source.attachments,
      cards,
      landed: attachments.ids,
      sourceRoot: source.descentAttachmentsRoot,
    }),
  };
}

/**
 * The bytes to copy for the attachments this pass landed.
 *
 * A row whose card never landed was skipped by the pass above and has no card to be filed under;
 * a mime that is not on the closed allowlist names no extension on EITHER side — Descent derived
 * its own filename from the same list — so such a row has no bytes to fetch and none are invented
 * for it. Everything else gets a source path in Descent's own layout and a target path under this
 * board's root, both derived from ids rather than from anything a client sent.
 *
 * `sourceRoot` is the IMPORTED INSTALL's own root, carried here on the source rows because the
 * read resolved the database's path (`source.descentAttachmentsRoot`): Descent keeps its bytes
 * beside its database (both are `Path(__file__).resolve().parent`), so a `dbPath` naming another
 * install must fetch THAT install's bytes rather than the operator's default one. It is taken from
 * the source at call time and never captured at module load.
 */
function planAttachmentCopies(input: {
  rows: DescentAttachmentRow[];
  cards: Map<string, string>;
  landed: Map<string, string>;
  sourceRoot: string;
}): KanbanAttachmentCopy[] {
  const copies: KanbanAttachmentCopy[] = [];

  for (const row of input.rows) {
    const cardId = lookup(input.cards, row.feature_id);
    const attachmentId = lookup(input.landed, row.id);
    const ext = ATTACHMENT_MIME_TO_EXT[row.mime ?? ''];
    if (cardId === '' || attachmentId === '' || ext === undefined) continue;

    // Both sides go through the one traversal predicate: the target is composed from ids this
    // board minted, and the source from ids the foreign row carries — a Descent file is not a
    // trusted author, so a `feature_id` holding a separator earns the same refusal as a bad card
    // id and the row is skipped rather than read from outside the install's attachment root.
    const sourcePath = resolveUnderRoot(input.sourceRoot, row.feature_id, `${row.id}.${ext}`);
    const targetPath = resolveUnderRoot(attachmentsRoot(), cardId, `${attachmentId}.${ext}`);
    if (sourcePath === null || targetPath === null) continue;

    copies.push({ cardId, attachmentId, sourcePath, targetPath });
  }

  return copies;
}

/**
 * Places the imported attachments' bytes — the one thing an import does AFTER its transaction.
 *
 * WHY THIS IS A SEPARATE ACT FROM THE PASS ABOVE. The mapping runs inside the write seam's
 * transaction, and an install's worth of attachment bytes copied there holds the database's write
 * lock for as long as the disk takes, stalling every other writer on the board. The rows are the
 * import's; the bytes are I/O, and I/O belongs outside the lock. So the mapping records WHERE each
 * file must go and returns; this places them once the transaction has committed.
 *
 * IT IS CALLED BY WHOEVER ANSWERS THE OPERATOR, and that is deliberate rather than incidental: the
 * one caller the import has is the route, which places the bytes and then sends the counts — so
 * "imported" means the corpus is on disk and not merely promised. It is synchronous for the same
 * reason: a deferred copy is a copy that a killed server, a closed socket or a dropped response can
 * lose while the operator already has the answer. `KanbanImportResult.attachmentCopies` carries the
 * obligation out of the module; the doc there is the contract for any other caller.
 *
 * NOTHING HERE THROWS. The rows have committed by the time this runs, and an import that landed two
 * hundred lessons must not report a failure because one blob is not where the old install said it
 * was: a missing source is recorded in the server log and the rest of the corpus lands. It answers
 * how many files it placed, which is a number to log and not a condition any caller branches on.
 */
export function placeAttachmentBytes(copies: readonly KanbanAttachmentCopy[]): number {
  let placed = 0;

  // ONE list read per card, not one per file: the held-attachment sets are memoised for the length
  // of this call, so a card holding twenty files costs one query rather than twenty. Nothing moves
  // the attachment rows again while this synchronous loop runs — the import that wrote them has
  // already committed — so the memo cannot go stale within it.
  const heldByCard = new Map<string, Set<string>>();
  const heldFor = (cardId: string): Set<string> => {
    let held = heldByCard.get(cardId);
    if (held === undefined) {
      held = new Set(kanbanChecklistDb.listAttachments(cardId).map((attachment) => attachment.id));
      heldByCard.set(cardId, held);
    }
    return held;
  };

  for (const copy of copies) {
    if (copyOneAttachment(copy, heldFor)) placed += 1;
  }

  return placed;
}

/**
 * One file: skipped when it is already there, recorded when its source is gone, never fatal.
 *
 * Answers whether the bytes are now where they belong — the difference between "copied" and "there
 * already", both of which are success, and a missing source or a failed copy, which are not.
 */
function copyOneAttachment(
  copy: KanbanAttachmentCopy,
  heldFor: (cardId: string) => Set<string>
): boolean {
  try {
    // Only bytes for a row this database actually holds. The copy runs after the transaction either
    // way, so this is what keeps a ROLLED-BACK import from leaving blobs under card ids that were
    // never written — the same standing rule that makes a file with no row invisible to every read.
    if (!heldFor(copy.cardId).has(copy.attachmentId)) return false;

    // A second import of one install changes nothing, and the bytes are the same bytes.
    if (fs.existsSync(copy.targetPath)) return true;

    if (!fs.existsSync(copy.sourcePath)) {
      console.warn(
        `[Kanban] import: attachment ${copy.attachmentId} landed, but Descent has no file ` +
          `at ${copy.sourcePath}.`
      );
      return false;
    }

    fs.mkdirSync(path.dirname(copy.targetPath), { recursive: true });
    fs.copyFileSync(copy.sourcePath, copy.targetPath);
    return true;
  } catch (error) {
    console.error(
      `[Kanban] import: could not copy ${copy.sourcePath} to ${copy.targetPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
