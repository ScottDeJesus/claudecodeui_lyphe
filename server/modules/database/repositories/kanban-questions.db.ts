import { getConnection } from '@/modules/database/connection.js';
import type { KanbanDecision, KanbanQuestion } from '@/shared/kanban-types.js';

/**
 * A card's questions and the decisions they became.
 *
 * The two tables live in one repository because they are one subject: a question exists to be
 * answered, and the answer IS a decision row — every reader of one reads the other beside it
 * (the card's detail, the approve gate's unanswered count, the question verb that writes both).
 *
 * Consumers: `kanban-questions.service.ts` (every question verb, and every read the approve gate
 * makes), and `kanban-cards.service.ts`'s `getCard`. Reach it through
 * `@/modules/database/index.js`. Every statement runs on the caller's connection, so one issued
 * inside the write seam's transaction joins that transaction rather than opening a second one.
 */

/** One `kanban_questions` row as SQLite holds it: `options` and `selected` are JSON text. */
type KanbanQuestionRow = {
  id: string;
  card_id: string;
  text: string;
  multi: number;
  options: string;
  selected: string;
  other_on: number;
  other: string;
  answered: number;
  sort_order: number;
  created_at: string;
  answered_at: string | null;
};

/** One `kanban_decisions` row as SQLite holds it: `choice` and `tags` are JSON text. */
type KanbanDecisionRow = {
  id: string;
  card_id: string | null;
  question_id: string | null;
  question: string;
  choice: string;
  tags: string;
  created_at: string;
};

/** Every column of a question, in one spelling, so no read is the odd one out. */
const QUESTION_COLUMNS = `id, card_id, text, multi, options, selected, other_on, other, answered,
  sort_order, created_at, answered_at`;

/** Every column of a decision, in the same spirit. */
const DECISION_COLUMNS = `id, card_id, question_id, question, choice, tags, created_at`;

/**
 * The JSON columns are ARRAYS OF STRINGS and they are stored as JSON — never as a comma-joined
 * string, which cannot tell an option containing a comma from two
 * options and turns `[]` into one empty option.
 *
 * A value that will not parse reads as the empty array rather than as an exception: a column this
 * repository always writes through `JSON.stringify` can only be unreadable if something outside
 * this module wrote it, and one bad row must not fail the read that lists it. The same bargain
 * `kanban-events.db.ts` makes for a payload it cannot parse.
 */
function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch (error) {
    console.error(
      `[Kanban] a question or decision column is not the JSON array it should be: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function toQuestion(row: KanbanQuestionRow): KanbanQuestion {
  return {
    id: row.id,
    cardId: row.card_id,
    text: row.text,
    multi: row.multi === 1,
    options: parseStringArray(row.options),
    selected: parseStringArray(row.selected),
    otherOn: row.other_on === 1,
    other: row.other,
    answered: row.answered === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

function toDecision(row: KanbanDecisionRow): KanbanDecision {
  return {
    id: row.id,
    cardId: row.card_id,
    questionId: row.question_id,
    question: row.question,
    choice: parseStringArray(row.choice),
    tags: parseStringArray(row.tags),
    createdAt: row.created_at,
  };
}

/**
 * One question, one answer, and the decision a card's history keeps.
 *
 * Nothing here writes outside a caller's transaction: `insertQuestion` mints nothing (the id is
 * the caller's, already minted inside the write's own transaction) and every verb is a single
 * statement.
 */
export const kanbanQuestionsDb = {
  /**
   * Inserts one question at the bottom of its card's ladder and returns it as stored.
   *
   * `sort_order` is assigned HERE in the same statement, one rung past the card's last question,
   * so a handful of questions added in a row keep the order they were asked in. The read-back is
   * the insert's own `RETURNING`, so the caller gets the stored row — its `created_at`, its
   * default `answered` — rather than an echo of what it passed in.
   */
  insertQuestion(input: {
    id: string;
    cardId: string;
    text: string;
    multi: boolean;
    options: string[];
    otherOn: boolean;
  }): KanbanQuestion {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_questions (id, card_id, text, multi, options, selected, other_on, other,
           answered, sort_order, created_at)
         VALUES (
           ?, ?, ?, ?, ?, '[]', ?, '',
           0,
           (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM kanban_questions WHERE card_id = ?),
           ?
         )
         RETURNING ${QUESTION_COLUMNS}`
      )
      .get(
        input.id,
        input.cardId,
        input.text,
        input.multi ? 1 : 0,
        JSON.stringify(input.options),
        input.otherOn ? 1 : 0,
        input.cardId,
        new Date().toISOString()
      ) as KanbanQuestionRow | undefined;

    if (!row) throw new Error(`Could not insert kanban question "${input.id}".`);
    return toQuestion(row);
  },

  /** One card's questions in the order they were asked, answered or not. */
  listQuestions(cardId: string): KanbanQuestion[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${QUESTION_COLUMNS} FROM kanban_questions
         WHERE card_id = ? ORDER BY sort_order ASC, id ASC`
      )
      .all(cardId) as KanbanQuestionRow[];

    return rows.map(toQuestion);
  },

  /** One question, or null when no such question exists. */
  getQuestion(questionId: string): KanbanQuestion | null {
    const row = getConnection()
      .prepare(`SELECT ${QUESTION_COLUMNS} FROM kanban_questions WHERE id = ?`)
      .get(questionId) as KanbanQuestionRow | undefined;

    return row ? toQuestion(row) : null;
  },

  /**
   * Records one answer: the selection, the free text, and when it arrived.
   *
   * The boolean is what lets a verb turn "no such question" into a 404 INSIDE the write's
   * transaction rather than reading first and hoping nothing moved in between. Answering twice is
   * not an error — the answer is simply replaced, and `answered_at` moves with it.
   */
  answerQuestion(input: { id: string; selected: string[]; other: string }): boolean {
    const result = getConnection()
      .prepare(
        `UPDATE kanban_questions SET answered = 1, selected = ?, other = ?, answered_at = ?
         WHERE id = ?`
      )
      .run(JSON.stringify(input.selected), input.other, new Date().toISOString(), input.id);

    return result.changes > 0;
  },

  /**
   * How many of a card's questions nobody has answered yet.
   *
   * This is the number the approve gate reads, and it counts the same rows the card's face shows
   * as `openQuestions`: one query, `answered = 0`, so the gate and the badge cannot disagree.
   */
  countUnanswered(cardId: string): number {
    const row = getConnection()
      .prepare('SELECT COUNT(*) AS open FROM kanban_questions WHERE card_id = ? AND answered = 0')
      .get(cardId) as { open: number } | undefined;

    return row?.open ?? 0;
  },

  /** Writes the decision an answer became, and returns it as stored. */
  insertDecision(input: {
    id: string;
    cardId: string;
    questionId: string;
    question: string;
    choice: string[];
    tags: string[];
  }): KanbanDecision {
    const row = getConnection()
      .prepare(
        `INSERT INTO kanban_decisions (id, card_id, question_id, question, choice, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING ${DECISION_COLUMNS}`
      )
      .get(
        input.id,
        input.cardId,
        input.questionId,
        input.question,
        JSON.stringify(input.choice),
        JSON.stringify(input.tags),
        new Date().toISOString()
      ) as KanbanDecisionRow | undefined;

    if (!row) throw new Error(`Could not insert kanban decision "${input.id}".`);
    return toDecision(row);
  },

  /** One card's decisions, oldest first — the order the questions were answered in. */
  listDecisions(cardId: string): KanbanDecision[] {
    const rows = getConnection()
      .prepare(
        `SELECT ${DECISION_COLUMNS} FROM kanban_decisions
         WHERE card_id = ? ORDER BY created_at ASC, id ASC`
      )
      .all(cardId) as KanbanDecisionRow[];

    return rows.map(toDecision);
  },
};
