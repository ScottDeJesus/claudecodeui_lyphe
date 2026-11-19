import { userDb } from '@/modules/database/index.js';
import { kanbanBoardsService, kanbanCardsService } from '@/modules/kanban/index.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';

/**
 * THE WORD BACK TO A PERSON: the line every active user is handed when the note applier's `status done` note has moved a card to Done.
 *
 * It mirrors `announceDispatcherEnding` (`dispatcher.module.ts`): one `system` event per user, code `bug.fixed`, meta
 * `{ boardName, title, changelog }`, and the orchestrator's switches and channels decide what reaches each of them. The kind follows
 * who filed the card. A card a person filed (`operator`, `restorly`) is a `stop`: a look, pushed by his own preferences. A card a chat,
 * a soul, the night, Cerberus's ticket or the dispatcher filed is a `record`: kept in the history and heard by the station's strip,
 * never pushed. The copy is `notification-copy.service.ts` (`Fixed: <title>`).
 *
 * What a person reads carries names only, never ids (INV-76): the board's name, the card's title, its changelog. The card's id appears
 * only in the dedupe key and in the journal, and neither is read by a person.
 *
 * This never throws. The Done move has already landed, so a failed word costs the word and nothing more: a card that cannot be read is
 * logged and dropped, and one user's failure is logged and the loop goes on.
 */

/**
 * The filers whose cards the operator asked for by name. A card one of them filed is a look he is owed. The house's own cards (chats,
 * souls, the night, Cerberus, the dispatcher) are kept as records, since nobody asked for them by name and they are not pushed.
 */
const PERSON_FILERS: ReadonlySet<string> = new Set(['operator', 'restorly']);

/** The orchestrator's code for a card that has been fixed. */
const FIXED_CODE = 'bug.fixed';

type FixedMeta = { boardName: string; title: string; changelog: string };

/**
 * The orchestrator is JavaScript, so TypeScript does not read its parameter contract from anywhere but its body. This alias states the
 * contract it actually implements. The only code is `bug.fixed`, the kind is a look (`stop`) or a record, and no chat is named, since a
 * fixed card's word opens nothing.
 */
const buildFixedEvent = createNotificationEvent as (input: {
  provider: 'system';
  kind: 'stop' | 'record';
  sessionId: null;
  code: typeof FIXED_CODE;
  meta: FixedMeta;
  severity: 'info';
  dedupeKey: string | null;
}) => object;

/** The message of whatever was thrown, for a journal line. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hands the Done word of one card to every active user. Called once the note applier has moved the card to Done.
 *
 * The card, its board, its filer and the active users are read first, all inside one try: a card that cannot be read is logged and its
 * word dropped. Then one event per user, each in its own try, so one user's failure costs only that user's word.
 *
 * The dedupe key carries the user because the orchestrator's dedupe is process-wide: without the user, the second user's word reads as a
 * repeat. It carries the card's Done stamp too, so a card reopened and fixed again is news again rather than a repeat of its first Done.
 */
export function announceFixed(cardId: string, logError: (line: string) => void): void {
  let fixed: { title: string; doneAt: string | null; meta: FixedMeta; kind: 'stop' | 'record' };
  let userIds: number[];
  try {
    const card = kanbanCardsService.getCard(cardId);
    const board = kanbanBoardsService.getBoard(card.boardId);
    const filer = kanbanCardsService.createdBy(cardId);
    userIds = userDb.getActiveUserIds();
    fixed = {
      title: card.title,
      doneAt: card.doneAt,
      meta: { boardName: board?.name ?? '', title: card.title, changelog: card.changelog },
      kind: PERSON_FILERS.has(filer) ? 'stop' : 'record',
    };
  } catch (error) {
    logError(`[kanban-dispatch] could not announce card ${cardId} fixed: ${messageOf(error)}`);
    return;
  }
  for (const userId of userIds) {
    try {
      notifyUserIfEnabled({
        userId,
        event: buildFixedEvent({
          provider: 'system',
          kind: fixed.kind,
          sessionId: null,
          code: FIXED_CODE,
          meta: fixed.meta,
          severity: 'info',
          dedupeKey: `bug.fixed:${userId}:${cardId}:${fixed.doneAt ?? ''}`,
        }),
      });
    } catch (error) {
      logError(`[kanban-dispatch] could not announce "${fixed.title}" fixed to user ${userId}: ${messageOf(error)}`);
    }
  }
}
