import {
  KANBAN_LANE_LIMIT_MAX,
  KANBAN_STATUSES,
  type KanbanBoard,
  type KanbanCardDetail,
  type KanbanCardSummary,
  type KanbanQuestion,
  type KanbanStatus,
} from '@/shared/kanban-types.js';

import type { KanbanPmClient } from './kanban-pm-client.js';

/**
 * The board reads the tool modules share, and the bounds they are all read under.
 *
 * A tool that paged a lane without a limit would pull a whole board into one tool result and into
 * the model's context with it, so every read here asks for an explicit page size — the board's own
 * lane ceiling (`KANBAN_LANE_LIMIT_MAX`).
 *
 * Page size is NOT the same thing as depth, and the difference is the whole point of
 * `scanLaneCards`. A lane read that takes one page and drops the board's `nextCursor` answers a
 * question about the board from part of it: `b-90` holds 435 live cards against a 200-card page, so
 * a search over one page would report 200 cards as if they were the board and never say otherwise.
 * The scans here therefore FOLLOW the cursor to the end of the lane. The floor that remains is a
 * runaway guard, not a policy bound, and a scan that trips it REFUSES rather than answer from part
 * of a board — a partial answer shaped like a complete one is the one outcome worth losing a
 * request to.
 *
 * Consumers: `kanban-pm-tools-board.ts`, `kanban-pm-tools-cards.ts`, `kanban-pm-tools-detail.ts`
 * and `kanban-pm-projections.ts` — every read any of them makes goes through this file.
 */

/** The lane page size the board is asked for. Depth is `scanLaneCards`' business, not this one's. */
export const BOARD_READ_LIMIT = KANBAN_LANE_LIMIT_MAX;

/**
 * How many pages one scan follows before it gives up.
 *
 * Twenty-five pages of two hundred is five thousand cards, an order of magnitude past the largest
 * board on this box. It is a runaway guard — a repository that kept handing back a cursor without
 * advancing would otherwise spin forever — and reaching it is a refusal, never a quiet cut.
 */
export const BOARD_SCAN_MAX_PAGES = 25;

/** Every status, in the order the board declares them — the "no filter" read. */
export const ALL_STATUSES: readonly KanbanStatus[] = KANBAN_STATUSES;

type CardPage = { cards: KanbanCardSummary[]; nextCursor: string | null };
type BoardList = { boards: KanbanBoard[]; currentBoardId: string | null };

/**
 * A lane that outran the scan guard.
 *
 * Thrown, not returned, because every caller's answer would be quietly wrong: the transport turns
 * a throw into `isError: true` with this message, which is the only shape in which "I read part of
 * the board and stopped" reaches the model as something other than a fact about the board.
 */
export class BoardScanTooLargeError extends Error {
  constructor(boardId: string, statuses: readonly KanbanStatus[], pages: number, pageLimit: number) {
    super(
      `this read followed ${pages} pages of up to ${pageLimit} cards on board ${boardId} ` +
        `(statuses: ${statuses.join(', ')}) and the lane was still not exhausted. It refuses to ` +
        'answer from part of a board: narrow the read with a status or a tag.'
    );
    this.name = 'BoardScanTooLargeError';
  }
}

/** The query string for one lane page. The board rejects a status-less lane read, so one is always named. */
export function laneQuery(statuses: readonly KanbanStatus[], limit: number = BOARD_READ_LIMIT): string {
  return `status=${statuses.join(',')}&limit=${limit}`;
}

/**
 * Every card of one board's lane, from the first page to the board's own last cursor.
 *
 * The cursor is opaque and is passed back exactly as it arrived — the repository owns its format.
 * Cards are appended page by page, so a scan that trips the guard throws and no caller ever sees
 * the partial list it was holding.
 */
export async function scanLaneCards(
  client: KanbanPmClient,
  boardId: string,
  statuses: readonly KanbanStatus[],
  pageLimit: number = BOARD_READ_LIMIT
): Promise<KanbanCardSummary[]> {
  const cards: KanbanCardSummary[] = [];
  let cursor: string | null = null;

  for (let pageNumber = 1; ; pageNumber += 1) {
    const pageQuery: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const page: CardPage = await client.get<CardPage>(
      `/boards/${boardId}/cards?${laneQuery(statuses, pageLimit)}${pageQuery}`
    );
    cards.push(...page.cards);

    cursor = page.nextCursor;
    if (cursor === null || cursor === '') return cards;

    if (pageNumber >= BOARD_SCAN_MAX_PAGES) {
      throw new BoardScanTooLargeError(boardId, statuses, pageNumber, pageLimit);
    }
  }
}

/**
 * Every live card on one board across all five statuses.
 *
 * This is the enumeration the scan-shaped reads start from: nothing shorter gets to a card's body
 * or its answered decisions, and both of those live only on the card detail.
 */
export function scanAllCards(
  client: KanbanPmClient,
  boardId: string,
  pageLimit: number = BOARD_READ_LIMIT
): Promise<KanbanCardSummary[]> {
  return scanLaneCards(client, boardId, ALL_STATUSES, pageLimit);
}

/** The non-archived boards, for the cross-board reads and for naming a card's board. */
export async function listBoards(client: KanbanPmClient): Promise<KanbanBoard[]> {
  const listed = await client.get<BoardList>('/boards');
  return listed.boards;
}

/**
 * Opens each card, in order, one request at a time.
 *
 * Sequential rather than parallel on purpose: these reads exist to page a board, and firing two
 * hundred simultaneous requests at the same SQLite file is how a read becomes a `SQLITE_BUSY` for
 * whatever else is writing — the server this child belongs to included.
 */
export async function openCards(
  client: KanbanPmClient,
  cardIds: readonly string[]
): Promise<KanbanCardDetail[]> {
  const details: KanbanCardDetail[] = [];
  for (const cardId of cardIds) {
    const detail = await client.get<{ card: KanbanCardDetail }>(`/cards/${cardId}`);
    details.push(detail.card);
  }
  return details;
}

/** Opens every card of one board — the full-text and decision reads' starting point. */
export async function openAllCards(
  client: KanbanPmClient,
  boardId: string
): Promise<KanbanCardDetail[]> {
  const cards = await scanAllCards(client, boardId);
  return openCards(client, cards.map((card) => card.id));
}

/**
 * The card a question belongs to, and the question itself — or null when no live card has it.
 *
 * There is no route that serves a question by id: the board's detail routes POST answers and never
 * return a question, and the id→card index the panel navigates by lives in the client. So a caller
 * that must know a question's OPTIONS before it can answer finds it the way the panel does, by
 * looking at cards. The `questions` lane is searched FIRST because an unanswered question is there
 * by construction — `addQuestion` moves its card there — so the ordinary find reads one page of a
 * small lane; the other four statuses are only reached for a question whose card has moved on.
 *
 * Null rather than a throw: a question that is nowhere on this board is the caller's own refusal
 * ("no such question"), not a fault of the transport. The board's lanes exclude archived cards, so
 * a question on an archived card reads as missing — the same wall every read in this file meets.
 */
export async function findQuestion(
  client: KanbanPmClient,
  boardId: string,
  questionId: string
): Promise<{ card: KanbanCardDetail; question: KanbanQuestion } | null> {
  const lanes: Array<readonly KanbanStatus[]> = [
    ['questions'],
    ['not_ready', 'todo', 'active', 'done'],
  ];

  for (const statuses of lanes) {
    for (const summary of await scanLaneCards(client, boardId, statuses)) {
      const card = (await client.get<{ card: KanbanCardDetail }>(`/cards/${summary.id}`)).card;
      const question = card.questions.find((candidate) => candidate.id === questionId);
      if (question !== undefined) return { card, question };
    }
  }

  return null;
}
