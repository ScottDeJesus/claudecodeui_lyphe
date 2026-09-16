import { kanbanChecklistDb, kanbanIdsDb } from '@/modules/database/index.js';
import type {
  KanbanAttachment,
  KanbanChecklistItem,
  KanbanIssue,
  KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { requireCardRow, requireSummary } from './kanban-cards.guards.js';
import { writeKanban } from './kanban-write.service.js';

/** An issue that is not there is a 404, and this is the one place that sentence is written. */
function issueNotFound(issueId: string): AppError {
  return new AppError(`No kanban issue with id "${issueId}".`, {
    code: 'KANBAN_ISSUE_NOT_FOUND',
    statusCode: 404,
  });
}

/** A checklist item that is not there is a 404, in the same one place. */
function checklistItemNotFound(itemId: string): AppError {
  return new AppError(`No kanban checklist item with id "${itemId}".`, {
    code: 'KANBAN_CHECKLIST_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

/** A defect with no words is not a defect: the caller gets a 400, not an empty row in the drawer. */
function requireIssueText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AppError('An issue needs its text.', {
      code: 'KANBAN_ISSUE_TEXT_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/** A checklist step with no words is not a step, for the same reason. */
function requireChecklistText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AppError('A checklist item needs its text.', {
      code: 'KANBAN_CHECKLIST_TEXT_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/** An attachment with no filename is not a file. The bytes are never read here — only the name is. */
function requireFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) {
    throw new AppError('An attachment needs a filename.', {
      code: 'KANBAN_ATTACHMENT_FILENAME_REQUIRED',
      statusCode: 400,
    });
  }
  return trimmed;
}

/** One checklist item, when the id is known to name one. */
function requireChecklistItem(itemId: string): KanbanChecklistItem {
  const item = kanbanChecklistDb.getChecklistItem(itemId);
  if (!item) throw checklistItemNotFound(itemId);
  return item;
}

/**
 * The checklist, the attachments and the issues a card's drawer carries.
 *
 * The three sit in one service because they are one subject — what a card has beside its text —
 * and because each verb is small: they would be three files of one verb each. The two heavier
 * surfaces are their own files, and the write seam is shared by all of them.
 *
 * EVERY write here goes through `writeKanban` — no verb in this file opens a transaction, appends
 * an audit row or sends a frame — and every one threads `context?.actor` into the seam.
 *
 * Consumers: `routes/detail.routes.ts` and the barrel, which is how a future in-process MCP
 * adapter calls the same verbs.
 */
export const kanbanChecklistService = {
  /** Files one issue against a card. */
  fileIssue(
    cardId: string,
    input: { text: string },
    context?: KanbanWriteContext
  ): KanbanIssue {
    const text = requireIssueText(input.text);
    const card = requireCardRow(cardId);

    return writeKanban(
      { kind: 'issue.filed', cardId, boardId: card.board_id, actor: context?.actor, payload: { text } },
      () => kanbanChecklistDb.insertIssue({ id: kanbanIdsDb.mintId('i'), cardId, text })
    );
  },

  /**
   * Marks one issue resolved, naming who resolved it when the caller did.
   *
   * A resolution is a verdict about a defect, never a person: `resolvedBy` is free text and an
   * absent one stays null rather than defaulting to the event actor, because the two answer
   * different questions — who wrote the audit row and who fixed the thing.
   */
  resolveIssue(
    issueId: string,
    input?: { resolvedBy?: string },
    context?: KanbanWriteContext
  ): KanbanIssue {
    const issue = kanbanChecklistDb.getIssue(issueId);
    if (!issue) throw issueNotFound(issueId);
    const card = requireCardRow(issue.cardId);
    const resolvedBy = input?.resolvedBy ?? null;

    return writeKanban(
      {
        kind: 'issue.resolved',
        cardId: issue.cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: { issueId, resolvedBy },
      },
      () => {
        if (!kanbanChecklistDb.resolveIssue({ id: issueId, resolvedBy })) throw issueNotFound(issueId);
        const resolved = kanbanChecklistDb.getIssue(issueId);
        if (!resolved) throw issueNotFound(issueId);
        return resolved;
      }
    );
  },

  /** Adds one step to a card's checklist. */
  addChecklistItem(
    cardId: string,
    input: { text: string; note?: string },
    context?: KanbanWriteContext
  ): KanbanChecklistItem {
    const text = requireChecklistText(input.text);
    const note = input.note ?? '';
    const card = requireCardRow(cardId);

    return writeKanban(
      { kind: 'checklist.added', cardId, boardId: card.board_id, actor: context?.actor, payload: { text } },
      () =>
        kanbanChecklistDb.insertChecklistItem({
          id: kanbanIdsDb.mintId('k'),
          cardId,
          text,
          note,
        })
    );
  },

  /**
   * Moves one step, edits it, or both.
   *
   * An empty patch is refused rather than treated as a no-op: a request that names no field is a
   * caller that meant to change something and did not, and answering `200` with the item unchanged
   * would hide the mistake until somebody noticed the step never moved. Whether `done_at` is
   * stamped or cleared is the repository's decision, made with the state in one statement.
   */
  updateChecklistItem(
    itemId: string,
    patch: { state?: 'pending' | 'active' | 'done'; text?: string; note?: string },
    context?: KanbanWriteContext
  ): KanbanChecklistItem {
    if (patch.state === undefined && patch.text === undefined && patch.note === undefined) {
      throw new AppError('A checklist patch must change at least one field.', {
        code: 'KANBAN_CHECKLIST_PATCH_EMPTY',
        statusCode: 400,
      });
    }

    const item = requireChecklistItem(itemId);
    const card = requireCardRow(item.cardId);
    const text = patch.text === undefined ? undefined : requireChecklistText(patch.text);

    return writeKanban(
      {
        kind: 'checklist.updated',
        cardId: item.cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: patch.state === undefined ? {} : { state: patch.state },
      },
      () => {
        if (!kanbanChecklistDb.updateChecklistItem({ id: itemId, state: patch.state, text, note: patch.note })) {
          throw checklistItemNotFound(itemId);
        }
        return requireChecklistItem(itemId);
      }
    );
  },

  /**
   * Removes one step from a card's checklist.
   *
   * It answers with nothing: the item is gone, and the caller has the card's fresh summary in the
   * frame the write sends. The card id is threaded into the seam so that frame still carries the
   * card the step was taken off — a detail write with no card would leave every open drawer
   * showing a step that no longer exists.
   */
  removeChecklistItem(itemId: string, context?: KanbanWriteContext): void {
    const item = requireChecklistItem(itemId);
    const card = requireCardRow(item.cardId);

    writeKanban(
      {
        kind: 'checklist.removed',
        cardId: item.cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: { itemId },
      },
      () => {
        if (!kanbanChecklistDb.deleteChecklistItem(itemId)) throw checklistItemNotFound(itemId);
        requireSummary(item.cardId);
      }
    );
  },

  /**
   * Records one attachment's metadata.
   *
   * The bytes are not this verb's: the drawer lists what a card carries, and where those bytes
   * live is not a question this board answers yet. A row whose file is not there is still the
   * honest record of what was attached.
   */
  addAttachment(
    cardId: string,
    input: { filename: string; mime: string; size: number },
    context?: KanbanWriteContext
  ): KanbanAttachment {
    const filename = requireFilename(input.filename);
    const card = requireCardRow(cardId);

    return writeKanban(
      {
        kind: 'attachment.added',
        cardId,
        boardId: card.board_id,
        actor: context?.actor,
        payload: { filename },
      },
      () =>
        kanbanChecklistDb.insertAttachment({
          id: kanbanIdsDb.mintId('a'),
          cardId,
          filename,
          mime: input.mime,
          size: input.size,
        })
    );
  },
};

/** What `routes/detail.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanChecklistService = typeof kanbanChecklistService;
