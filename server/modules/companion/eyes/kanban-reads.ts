import { kanbanBoardsService, kanbanCardsService } from '@/modules/kanban/index.js';
import { KANBAN_LANE_LIMIT_MAX, KANBAN_STATUSES, type KanbanBoard, type KanbanCardDetail, type KanbanCardSummary, type KanbanLaneCount, type KanbanStatus } from '@/shared/kanban-types.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import { AppError } from '@/shared/utils.js';

import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { LIST_ABOUT_NOTHING } from './card-shapes.js';
import { answerRead, INLINE_MAX_CHARACTERS, LIST_MAX, moreLine } from './eyes-answer.js';
import { cardFacts, cardLine, LANE_WORDS_LINE, laneCountsLine, laneNamed, laneWord, openCardCount } from './kanban-lines.js';
import { counted, fitLines, linesThatFit, maskCredentials } from './line-words.js';

/**
 * `read_kanban`: the Kanban board, read through the readers its panel uses (`kanbanBoardsService` and `kanbanCardsService`,
 * the board's own services), one scope at a time. Nothing here writes a card, and nothing moves her focus or her activity: a read
 * runs as `thinking`.
 *
 * The board is NAMED (`board`, by its name or id, or part of its name); without a name it is the board with the most cards
 * not done. `scope` is then:
 *   - `board`: every lane and its count, then up to 5 cards each of questions, active and todo;
 *   - a lane (not ready, todo, questions, active, done, or the tab's own titles for them: Backlog, To Do, Open questions, In
 *     Progress): its cards, up to 20, one line each, and how many more there are;
 *   - a card's id (`c-588`) or its title, or a phrase over titles and tags: one card is answered whole (title, lane, priority,
 *     tags, checklist, open questions, approval, then its description, whole when short and a dactyl's digest when long), several
 *     as lines.
 * A card's build tokens are never said (ruling 1). With `panel: true` the whole answer goes on his panel.
 *
 * Consumed by `panel-reads.ts`, which builds the tool.
 */

/** How many cards of each of questions, active and todo the `board` scope shows. */
const BOARD_PREVIEW = 5;

/** The lanes the `board` scope opens up, in the order he reads them: what needs him, what is moving, what is next. */
const PREVIEW_LANES: readonly KanbanStatus[] = ['questions', 'active', 'todo'];

/** The most pages of cards a title or phrase search reads (200 cards a page): a board past 2,000 cards is searched in its first 2,000. */
const SEARCH_PAGES_MAX = 10;

/** What a dactyl is asked of a long card description (`NO_SPEND` is added by `wholeOrDigest`). */
const CARD_BRIEF = 'What does this card ask for, what is already done, and what is still open? At most 12 lines; cite L<n>.';

/** What a dactyl is asked of a list that came out past 2,000 characters. */
const LIST_BRIEF = 'List the cards here, one line each, keeping each title, lane and card id. At most 15 lines; cite L<n>.';

/** A board found, or the sentence that says why none was. */
type BoardPick = { ok: true; board: KanbanBoard; counts: KanbanLaneCount[]; unnamed: boolean } | { ok: false; sentence: string };

/** The board `wanted` names (its id, its whole name, or one board whose name holds it), or the one with the most cards not done. */
function pickBoard(wanted: string): BoardPick {
  const { boards } = kanbanBoardsService.listBoards();
  if (boards.length === 0) return { ok: false, sentence: 'He has no Kanban board yet.' };
  const countsOf = (board: KanbanBoard): KanbanLaneCount[] => kanbanBoardsService.laneCounts(board.id);

  if (wanted === '') {
    const open = boards.map((board) => ({ board, counts: countsOf(board) }));
    const busiest = open.reduce((best, next) => (openCardCount(next.counts) > openCardCount(best.counts) ? next : best));
    return { ok: true, board: busiest.board, counts: busiest.counts, unnamed: boards.length > 1 };
  }
  const lower = wanted.toLowerCase();
  const exact = boards.filter((board) => board.id.toLowerCase() === lower || board.name.toLowerCase() === lower);
  const fits = exact.length > 0 ? exact : boards.filter((board) => board.name.toLowerCase().includes(lower));
  if (fits.length === 1) return { ok: true, board: fits[0], counts: countsOf(fits[0]), unnamed: false };
  const names = (fits.length > 0 ? fits : boards).map((board) => board.name).join(', ');
  return { ok: false, sentence: fits.length > 1 ? `"${wanted}" fits ${fits.length} boards: ${names}; name one.` : `No board is named "${wanted}". The boards are: ${names}.` };
}

/** What a lane's section adds around its card lines: its heading and the closing "And k more" line, with their breaks, rounded up. */
const LANE_FRAME_CHARACTERS = 100;

/** A line's weight in the answer: its characters (as a person counts them) and its line break. */
const weigh = (line: string): number => Array.from(line).length + 1;

/**
 * The `board` scope: the lanes and their counts, then a few cards of each lane that wants him or is moving. The three lanes are
 * ONE answer and share ONE budget (the inline limit, so it is handed over whole and never digested, which would drop the counts):
 * every lane is promised its first card, and what the header, the lanes' frames and those first cards leave is shared out lane by
 * lane in reading order, so a lane with long cards takes fewer than five and the answer stays inside the limit.
 */
function boardOverview(board: KanbanBoard, counts: KanbanLaneCount[], unnamed: boolean): string {
  const header = `Board ${board.name}${unnamed ? ' (the board with the most cards still open)' : ''}: ${laneCountsLine(counts)}.`;
  const lanes = PREVIEW_LANES.flatMap((status) => {
    const total = counts.find((count) => count.status === status)?.total ?? 0;
    if (total === 0) return [];
    const { cards } = kanbanCardsService.listLaneCards(board.id, [status], { limit: BOARD_PREVIEW });
    return cards.length === 0 ? [] : [{ status, total, lines: cards.map(cardLine) }];
  });
  let spare = INLINE_MAX_CHARACTERS - weigh(header) - lanes.reduce((sum, lane) => sum + LANE_FRAME_CHARACTERS + weigh(lane.lines[0]), 0);
  const sections = lanes.map((lane) => {
    const shown = lane.lines.slice(0, linesThatFit(lane.lines, BOARD_PREVIEW, weigh(lane.lines[0]) + Math.max(spare, 0)));
    spare -= shown.slice(1).reduce((sum, line) => sum + weigh(line), 0);
    const left = lane.total - shown.length;
    return [`${laneWord(lane.status)} (${lane.total}):`, ...shown, ...(left > 0 ? [moreLine(left)] : [])].join('\n');
  });
  return [header, ...sections].join('\n');
}

/** The lane scope: the first 20 cards of one lane, in the order the board holds them (done: newest first). */
function laneCards(board: KanbanBoard, counts: KanbanLaneCount[], status: KanbanStatus): string {
  const total = counts.find((count) => count.status === status)?.total ?? 0;
  if (total === 0) return `No cards are in ${laneWord(status)} on ${board.name}.`;
  const { cards } = kanbanCardsService.listLaneCards(board.id, [status], { limit: LIST_MAX });
  return `${laneWord(status)} on ${board.name}, ${counted(total, 'card')}:\n${fitLines(cards.map(cardLine), { total, max: LIST_MAX })}`;
}

/** Every live card of a board, read a page at a time, for a title or a phrase to be found among. */
function allCards(boardId: string): KanbanCardSummary[] {
  const cards: KanbanCardSummary[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < SEARCH_PAGES_MAX; page += 1) {
    const answer: ReturnType<typeof kanbanCardsService.listLaneCards> = kanbanCardsService.listLaneCards(boardId, [...KANBAN_STATUSES], { limit: KANBAN_LANE_LIMIT_MAX, cursor });
    cards.push(...answer.cards);
    if (answer.nextCursor === null) break;
    cursor = answer.nextCursor;
  }
  return cards;
}

/** One card, whole: its facts, then its description (whole when short, a digest when long), or the whole of both on his panel. */
function cardAnswer(deps: CompanionToolDeps, card: KanbanCardDetail, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const description = maskCredentials(card.description).trim();
  return answerRead(
    deps,
    { panel, title: card.title, text: description === '' ? '(no description)' : description, label: 'kanban-card', brief: CARD_BRIEF, intro: `${cardFacts(card)}\nDescription:`, shape: LIST_ABOUT_NOTHING },
    signal
  );
}

/** A card by its id, or the sentence that none has it (a missing card is the board's own 404). */
function cardById(deps: CompanionToolDeps, id: string, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  let card: KanbanCardDetail;
  try {
    card = kanbanCardsService.getCard(id.toLowerCase());
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) return deps.refuse(`No card has the id ${id}. read_kanban with a lane or a phrase lists cards with their ids.`);
    throw error;
  }
  return cardAnswer(deps, card, panel, signal);
}

/** A title (whole) or a phrase over titles and tags: the one card it names whole, or the cards it fits as lines. */
function cardByWords(deps: CompanionToolDeps, board: KanbanBoard, phrase: string, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const lower = phrase.toLowerCase();
  const cards = allCards(board.id);
  const exact = cards.filter((card) => card.title.toLowerCase() === lower);
  const holding = (card: KanbanCardSummary): boolean => card.title.toLowerCase().includes(lower) || card.tags.some((tag) => tag.toLowerCase().includes(lower));
  const fits = exact.length > 0 ? exact : cards.filter(holding).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (fits.length === 0) return textResult(`No card on ${board.name} has "${phrase}" in its title or tags. ${LANE_WORDS_LINE}`);
  if (fits.length === 1) return cardAnswer(deps, kanbanCardsService.getCard(fits[0].id), panel, signal);
  const text = `${counted(fits.length, 'card')} on ${board.name} fit "${phrase}":\n${fitLines(fits.map(cardLine))}`;
  return answerRead(deps, { panel, title: `Kanban: ${phrase}`, text, label: 'kanban-list', brief: LIST_BRIEF, intro: '', shape: LIST_ABOUT_NOTHING }, signal);
}

/** `read_kanban`: see the file's head. */
export async function readKanban(
  deps: CompanionToolDeps,
  args: { scope: string; board?: string; panel?: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> {
  const panel = args.panel === true;
  const picked = pickBoard(args.board?.trim() ?? '');
  if (!picked.ok) return deps.refuse(picked.sentence);
  const { board, counts, unnamed } = picked;
  const scope = args.scope.trim();

  if (scope.toLowerCase() === 'board') {
    return answerRead(deps, { panel, title: `Kanban: ${board.name}`, text: boardOverview(board, counts, unnamed), label: 'kanban-board', brief: LIST_BRIEF, intro: '', shape: LIST_ABOUT_NOTHING }, signal);
  }
  const lane = laneNamed(scope);
  if (lane !== null) {
    return answerRead(deps, { panel, title: `Kanban: ${laneWord(lane)}`, text: laneCards(board, counts, lane), label: 'kanban-lane', brief: LIST_BRIEF, intro: '', shape: LIST_ABOUT_NOTHING }, signal);
  }
  if (/^c-\d+$/i.test(scope)) return cardById(deps, scope, panel, signal);
  return cardByWords(deps, board, scope, panel, signal);
}
