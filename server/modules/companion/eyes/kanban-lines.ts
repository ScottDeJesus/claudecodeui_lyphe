import { KANBAN_STATUSES, type KanbanCardDetail, type KanbanCardSummary, type KanbanLaneCount, type KanbanStatus } from '@/shared/kanban-types.js';

import { whenWords } from './eyes-answer.js';
import { clipLine, counted } from './line-words.js';

/**
 * The Kanban board in words: a card as one line, a lane's count, a card's facts. Pure — strings from the board's own records,
 * no I/O. The board's own reader (`kanban-reads.ts`) fetches; this file only says it.
 *
 * NEVER A CARD'S BUILD TOKENS (ruling 1). A `KanbanCardSummary` carries `buildTokens` and a detail the four counters of it,
 * and no function here reads them: a card is said by its title, lane, priority, tags, checklist, questions and approval.
 * Consumed by `kanban-reads.ts` alone.
 */

/** The lane words he says them by, one per status. The Kanban tab's own lane names (`not ready` is `not_ready`'s). */
const LANE_WORDS: Readonly<Record<KanbanStatus, string>> = {
  not_ready: 'not ready',
  todo: 'todo',
  questions: 'questions',
  active: 'active',
  done: 'done',
};

/** The longest card title a line carries; the card's own read gives it whole. */
const TITLE_MAX = 60;

/** The most tags a line names (a card's read names them all in its facts), and the most open questions a card's read lists. */
const TAGS_SHOWN = 2;
const QUESTIONS_SHOWN = 5;

/**
 * The Kanban tab's own lane titles (`kanban.lanes` in the locale: Backlog, To Do, Open questions, In Progress, Done), lower-cased,
 * for the status each lane shows. He reads these on the tab, so he says them; the other two (`todo`, `done`) are also her five
 * words and need no entry beyond "to do".
 */
const TAB_LANE_NAMES: ReadonlyMap<string, KanbanStatus> = new Map([
  ['backlog', 'not_ready'],
  ['to do', 'todo'],
  ['open questions', 'questions'],
  ['in progress', 'active'],
]);

/** Her five lane words, as the sentence that closes a miss names them. Consumed by `kanban-reads.ts`. */
export const LANE_WORDS_LINE = 'The lanes are not ready, todo, questions, active and done.';

/**
 * The lane a scope names, or `null` when it names none. Matched without regard to case, the underscore or dash of
 * `not_ready` read as a space; her five words (`not ready`, `todo`, `questions`, `active`, `done`) and the tab's own titles for
 * them ("backlog", "to do", "open questions", "in progress") both name a lane. Consumed by `kanban-reads.ts`.
 */
export function laneNamed(scope: string): KanbanStatus | null {
  const word = scope.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return TAB_LANE_NAMES.get(word) ?? KANBAN_STATUSES.find((status) => LANE_WORDS[status] === word) ?? null;
}

/** A lane's name as he says it ("not ready"). Consumed by `kanban-reads.ts`. */
export function laneWord(status: KanbanStatus): string {
  return LANE_WORDS[status];
}

/** A card's tags as a line carries them: the first two and a `+n` for the rest, or "no tags". */
function tagWords(tags: string[]): string {
  if (tags.length === 0) return 'no tags';
  const shown = tags.slice(0, TAGS_SHOWN).join(', ');
  return tags.length > TAGS_SHOWN ? `${shown} +${tags.length - TAGS_SHOWN}` : shown;
}

/** One card as one line: `<title> · <lane> · <priority> · <tags> · card <id>`. Consumed by `kanban-reads.ts`. */
export function cardLine(card: KanbanCardSummary): string {
  return `${clipLine(card.title, TITLE_MAX)} · ${LANE_WORDS[card.status]} · ${card.priority} · ${tagWords(card.tags)} · card ${card.id}`;
}

/** The board's lanes and their counts, in the schema's order: `not ready 37 · todo 46 · questions 0 · active 0 · done 333`. Consumed by `kanban-reads.ts`. */
export function laneCountsLine(counts: KanbanLaneCount[]): string {
  return counts.map((count) => `${LANE_WORDS[count.status]} ${count.total}`).join(' · ');
}

/** The cards on a board that are not done: what "the board with the most to do" counts. Consumed by `kanban-reads.ts`. */
export function openCardCount(counts: KanbanLaneCount[]): number {
  return counts.reduce((sum, count) => (count.status === 'done' ? sum : sum + count.total), 0);
}

/** One open question as a line of its card's facts: the text, and the options when it offers any. */
function questionLine(index: number, question: KanbanCardDetail['questions'][number]): string {
  const options = question.options.length > 0 ? ` (options: ${question.options.slice(0, 6).map((option) => clipLine(option, 40)).join(' / ')})` : '';
  return `${index}. ${clipLine(question.text, 160)}${options}`;
}

/**
 * Everything of a card but its description, as lines: the title, then its lane, priority and tags, its checklist, its open
 * questions and whether he approved it. Consumed by `kanban-reads.ts`, which puts the description after it.
 */
export function cardFacts(card: KanbanCardDetail): string {
  const open = card.questions.filter((question) => !question.answered);
  const questions =
    open.length === 0
      ? 'No open questions.'
      : [
          `${counted(open.length, 'open question')}:`,
          ...open.slice(0, QUESTIONS_SHOWN).map((question, index) => questionLine(index + 1, question)),
          ...(open.length > QUESTIONS_SHOWN ? [`And ${open.length - QUESTIONS_SHOWN} more.`] : []),
        ].join('\n');
  const approved = card.approved ? `Approved${card.approvedAt === null ? '' : ` ${whenWords(card.approvedAt)}`}.` : 'Not approved.';
  const checklist = card.checklistTotal === 0 ? 'No checklist.' : `Checklist: ${card.checklistDone} of ${card.checklistTotal} done.`;
  return [
    clipLine(card.title, 200),
    `${LANE_WORDS[card.status]} · ${card.priority} priority · ${tagWords(card.tags)} · card ${card.id}`,
    checklist,
    questions,
    approved,
  ].join('\n');
}
