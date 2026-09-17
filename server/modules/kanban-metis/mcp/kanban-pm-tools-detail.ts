import type { KanbanChecklistItem, KanbanDecision, KanbanIssue, KanbanQuestion } from '@/shared/kanban-types.js';

import { findQuestion } from './kanban-pm-board-reads.js';
import { answerBody, resolveChoice } from './kanban-pm-choice.js';
import type { KanbanPmClient } from './kanban-pm-client.js';
import { releasePlanLease } from './kanban-pm-heartbeat.js';
import { getLearnedSelections } from './kanban-pm-recall.js';
import {
  CARD_ID_ARGUMENT,
  TAGS_ARGUMENT,
  errorResult,
  textResult,
  toolSchema,
  type ToolTable,
} from './mcp-protocol.js';

/**
 * The nine detail tools: a card's questions and their answers, its issues, its checklist and its
 * approval — over the board's question, checklist and card routes.
 *
 * Names are `descent-pm`'s, for the reason `kanban-pm-tools-cards.ts` states.
 *
 * Consumers: `kanban-pm-mcp.ts`, which assembles this table with the other two and starts the
 * transport over it.
 */

type CardEnvelope = { card: { id: string; questions: KanbanQuestion[]; decisions: KanbanDecision[]; issues: KanbanIssue[]; checklist: KanbanChecklistItem[] } };
type QuestionEnvelope = { question: KanbanQuestion };
type IssueEnvelope = { issue: KanbanIssue };
type ItemEnvelope = { item: KanbanChecklistItem };

const CHECKLIST_STATES = ['pending', 'active', 'done'] as const;

export function createDetailTools(client: KanbanPmClient): ToolTable {
  const openCard = async (cardId: string): Promise<CardEnvelope['card']> =>
    (await client.get<CardEnvelope>(`/cards/${cardId}`)).card;

  const tools = [
    {
      name: 'open_design_questions',
      description:
        "List a feature's UNANSWERED design questions — the open decisions still awaiting the " +
        'operator. Read-only.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT }, ['id']),
    },
    {
      name: 'post_design_questions',
      description:
        'Post design questions on a feature and move it to the Questions lane. Each question is ' +
        "{text, multi(bool), options(string[])}. Returns the minted questions (ids 'q-N').",
      inputSchema: toolSchema(
        {
          id: CARD_ID_ARGUMENT,
          questions: {
            type: 'array',
            description: 'The questions to post.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                multi: { type: 'boolean' },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['text'],
            },
          },
        },
        ['id', 'questions']
      ),
    },
    {
      name: 'answer_design_question',
      description:
        "Record the operator's answer to ONE design question. 'id' is the QUESTION id ('q-2'), " +
        'not the card id. \'choice\' is an option text — or several as an array — and is matched ' +
        "against the question's own options: a matching value is recorded as a SELECTION, and any " +
        "other value is recorded as the answer's free text rather than as a selection. A " +
        'single-choice question handed several options keeps the FIRST and demotes the rest to ' +
        'free text — never a silent multi-select. A blank choice is refused. Returns the answered ' +
        'question.',
      inputSchema: toolSchema(
        {
          id: { type: 'string', description: "The question id (e.g. 'q-2')." },
          choice: {
            description: 'A single answer string, or an array of answer strings.',
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          },
        },
        ['id', 'choice']
      ),
    },
    {
      name: 'get_learned_selections',
      description:
        "Recall this board's past design-question answers (the 'learn my taste' substrate), " +
        'optionally filtered by tag overlap and/or a question-text substring. Read-only. Reads ' +
        "every live card, so it is bounded by the board and not by a page. A tag filter matches a " +
        "decision's own snapshot tags OR its card's tags as they stand — the answers this server " +
        'writes carry no snapshot, so the card is the signal for them.',
      inputSchema: toolSchema({ tags: TAGS_ARGUMENT, q: { type: 'string', description: 'Substring match on question text.' } }, []),
    },
    {
      name: 'file_issue',
      description:
        'File an issue against a feature. Reopens it to To Do, clears its plan and extinguishes ' +
        'the building pill.',
      inputSchema: toolSchema(
        { id: CARD_ID_ARGUMENT, text: { type: 'string', description: 'The issue text.' } },
        ['id', 'text']
      ),
    },
    {
      name: 'resolve_issue',
      description:
        "Mark ONE handled issue resolved (closed). 'itemId' is the ISSUE id ('i-2'). Call this " +
        'for the specific issue you have handled; there is no auto-close.',
      inputSchema: toolSchema({ itemId: { type: 'string', description: "The issue id (e.g. 'i-2')." } }, ['itemId']),
    },
    {
      name: 'set_checklist',
      description:
        "Replace a feature's BUILD CHECKLIST with these items — one per plan phase, in order. " +
        'Every item starts pending. This is the build-progress mirror the panel draws; only ' +
        'Metis writes it. Returns the minted items.',
      inputSchema: toolSchema(
        {
          id: CARD_ID_ARGUMENT,
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'One checklist line per plan phase, in plan order.',
          },
        },
        ['id', 'items']
      ),
    },
    {
      name: 'set_checklist_item',
      description:
        "Advance ONE build-checklist item to a state: 'active' (the phase being built right now), " +
        "'done' (the phase really shipped — never mark done a phase that did not), or 'pending'. " +
        "'note' is an optional resume breadcrumb; omit it to leave the note untouched.",
      inputSchema: toolSchema(
        {
          itemId: { type: 'string', description: "The checklist item id (e.g. 'k-3')." },
          state: {
            type: 'string',
            enum: [...CHECKLIST_STATES],
            description: 'pending | active | done.',
          },
          note: { type: 'string', description: 'Optional resume breadcrumb for this item.' },
        },
        ['itemId', 'state']
      ),
    },
    {
      name: 'approve_feature',
      description:
        "Set the operator-delegated approval gate on a feature card. This is the operator's " +
        'tool: a Metis session calls it only when the operator explicitly instructs her to. The ' +
        'board refuses unless the card is past not_ready, has zero open questions, and carries a ' +
        'plan, body or description.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT }, ['id']),
    },
  ];

  return {
    tools,
    handlers: {
      open_design_questions: async (args) => {
        const card = await openCard(args.id as string);
        return textResult(card.questions.filter((question) => !question.answered));
      },

      post_design_questions: async (args) => {
        const cardId = args.id as string;
        const questions = args.questions as Array<{ text: string; multi?: boolean; options?: string[] }>;
        const minted: KanbanQuestion[] = [];

        for (const question of questions) {
          const created = await client.post<QuestionEnvelope>(`/cards/${cardId}/questions`, {
            text: question.text,
            multi: question.multi,
            options: question.options,
          });
          minted.push(created.question);
        }

        // The lane move is the second half of the tool: questions the operator is never shown are
        // questions nobody answers.
        await client.post(`/cards/${cardId}/move`, { status: 'questions' });

        // Posting the questions IS planning done — the planner has finished asking, and the claim
        // it took to author them has nothing left to guard.
        await releasePlanLease(client, cardId);
        return textResult(minted);
      },

      answer_design_question: async (args) => {
        const questionId = args.id as string;
        const found = await findQuestion(client, client.boardId, questionId);
        if (found === null) return errorResult(`no such question: ${questionId}`);

        // The question's OWN options decide the split, which is why the question is looked up
        // before the answer is written rather than trusting the choice to be self-describing.
        const resolution = resolveChoice(args.choice, found.question.options, found.question.multi);
        if (!resolution.ok) return errorResult(resolution.reason);

        const answered = await client.post<QuestionEnvelope>(
          `/questions/${questionId}/answer`,
          answerBody(resolution)
        );
        return textResult(answered.question);
      },

      get_learned_selections: async (args) => {
        const wantedTags = new Set(
          ((args.tags as string[] | undefined) ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)
        );
        const query = (args.q as string | undefined)?.trim().toLowerCase();

        return textResult(await getLearnedSelections(client, wantedTags, query));
      },

      file_issue: async (args) => {
        const cardId = args.id as string;
        const filed = await client.post<IssueEnvelope>(`/cards/${cardId}/issues`, { text: args.text });

        // The card is handed back to the To Do lane with its plan cleared: an issue is the board's
        // way of saying this work is not planned any more, and a card that kept its plan would
        // read as build-ready to the next session that scanned the lane.
        await client.patch(`/cards/${cardId}`, { plan: '' });
        await client.post(`/cards/${cardId}/move`, { status: 'todo' });

        // The plan is cleared above, so any plan claim this session holds is a claim on a plan
        // that no longer exists.
        await releasePlanLease(client, cardId);

        return textResult(filed.issue);
      },

      resolve_issue: async (args) =>
        textResult(
          (
            await client.post<IssueEnvelope>(`/issues/${args.itemId as string}/resolve`, {})
          ).issue
        ),

      set_checklist: async (args) => {
        const cardId = args.id as string;
        const items = (args.items as string[] | undefined) ?? [];

        for (const existing of (await openCard(cardId)).checklist) {
          await client.del(`/checklist/${existing.id}`);
        }

        const minted: KanbanChecklistItem[] = [];
        for (const text of items) {
          const created = await client.post<ItemEnvelope>(`/cards/${cardId}/checklist`, { text });
          minted.push(created.item);
        }

        return textResult(minted);
      },

      set_checklist_item: async (args) =>
        textResult(
          (
            await client.patch<ItemEnvelope>(`/checklist/${args.itemId as string}`, {
              state: args.state,
              note: args.note,
            })
          ).item
        ),

      approve_feature: async (args) =>
        textResult(
          (await client.post<{ card: unknown }>(`/cards/${args.id as string}/approve`, {})).card
        ),
    },
  };
}
