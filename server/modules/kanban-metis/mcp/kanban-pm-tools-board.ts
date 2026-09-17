import { KANBAN_LEASE_STALE_SECONDS, type KanbanBoard } from '@/shared/kanban-types.js';

import { listBoards, scanLaneCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';
import { recordPlanLease } from './kanban-pm-heartbeat.js';
import { buildActionableQueue, leaseFacts } from './kanban-pm-projections.js';
import {
  SEARCH_KINDS,
  SEARCHABLE_KINDS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX,
  searchHistory,
  type SearchKind,
} from './kanban-pm-recall.js';
import {
  CARD_ID_ARGUMENT,
  errorResult,
  textResult,
  toolSchema,
  type ToolResult,
  type ToolTable,
} from './mcp-protocol.js';

/**
 * The board-level tools: the orient queue, the resume read, the plan claim, history search, and the
 * three lesson tools this board answers honestly by refusing.
 *
 * Names are `descent-pm`'s, for the reason `kanban-pm-tools-cards.ts` states. The rows these reads
 * answer with are projected in `kanban-pm-projections.ts`.
 *
 * Consumers: `kanban-pm-mcp.ts`, which assembles this table with the other two and starts the
 * transport over it.
 */

const LESSON_TRIGGERS = ['complex_task', 'error_resolved', 'operator_correction', 'workflow_discovered'];
const LESSON_KINDS = ['note', 'skill_draft'];

/**
 * The one sentence the three lesson tools answer with, in one home.
 *
 * These are STUBS, not empty reads. Answering "no lessons yet" would tell the model a fact about the
 * corpus — that there is nothing to learn from — when the truth is that this board has no corpus at
 * all. The difference matters: the first answer ends the search, the second sends the session to
 * the closing remarks, which is where the work actually gets recorded.
 */
const LESSONS_NOT_HERE =
  'lessons are not on this board yet — the lesson corpus is Descent-only until sunset. Record ' +
  "what you learned in the card's closing remarks instead (set_closing_remarks).";

export function createBoardTools(client: KanbanPmClient): ToolTable {
  /** The boards a read covers: this board, one named board, or every non-archived board. */
  const resolveBoards = async (board: unknown): Promise<KanbanBoard[]> => {
    const boards = await listBoards(client);
    if (board === undefined) return boards.filter((entry) => entry.id === client.boardId);
    if (board === 'all') return boards.filter((entry) => !entry.archived);
    return boards.filter((entry) => entry.id === board);
  };

  const lessonStub = (): ToolResult => errorResult(LESSONS_NOT_HERE);

  const tools = [
    {
      name: 'list_actionable',
      description:
        'The COMPACT orient queue — what needs doing, bucketed, with no plan bodies. Returns ' +
        "'to_plan' (todo, not build-ready yet: claim_plan FIRST, then author and post questions), " +
        "'buildable' (todo, approved, no open questions), 'awaiting_you' (the questions lane, plus " +
        "any todo card tagged operator-scheduled) and 'active'. Every row carries its lease facts. " +
        "The 'lessons' key is always empty on this board.",
      inputSchema: toolSchema(
        {
          board: {
            type: 'string',
            description: "Omit for THIS board; 'all' for every board; or a specific board id.",
          },
        },
        []
      ),
    },
    {
      name: 'list_active_builds',
      description:
        'List every ACTIVE feature card on this board with its raw BUILD-LEASE facts: ' +
        'build_owner, lease_age_secs, is_stale and is_mine. This is the RESUME read — after a ' +
        'disconnect a new session calls it and classifies each card off is_mine plus is_stale.',
      inputSchema: toolSchema(
        {
          stale_secs: {
            type: 'integer',
            description:
              'A lease un-refreshed for longer than this many seconds reads as stale. Defaults ' +
              "to the board's own window (four missed 10s heartbeats).",
          },
        },
        []
      ),
    },
    {
      name: 'claim_plan',
      description:
        'ATOMICALLY claim the PLAN lease on a To-do card BEFORE authoring its plan — the planning ' +
        "twin of set_status(active)'s build claim. Call it first when you pick a to_plan card. " +
        'Returns the verdict and the card as it stands.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT }, ['id']),
    },
    {
      name: 'search_history',
      description:
        "Ask 'have we hit this before?' BEFORE planning a card or deep-debugging an error. " +
        "Searches this board's card titles, descriptions, bodies and closing remarks, its design " +
        "decisions and its issues, plus the audit log — the only place an archived card's history " +
        'is still readable. Ranked, snippeted. Answers {hits, scanned_cards, events_read, ' +
        'more_events} — read those counts: a small scanned_cards or a true more_events means the ' +
        "board was not fully read. 'lesson' is NOT searchable here and asking for it is refused.",
      inputSchema: toolSchema(
        {
          query: {
            type: 'string',
            description: 'The search text (up to 500 chars). Plain words, never query syntax.',
          },
          kinds: {
            type: 'array',
            items: { type: 'string', enum: [...SEARCH_KINDS] },
            description:
              'Optional: restrict to a subset of feature | decision | issue. The declared ' +
              "'lesson' is refused: this board has no lesson corpus.",
          },
          limit: {
            type: 'integer',
            description: 'Max hits, 1..100 (default 20). An out-of-range value is refused.',
          },
        },
        ['query']
      ),
    },
    {
      name: 'stage_lesson',
      description:
        'NOT AVAILABLE ON THIS BOARD. Staging asks for a lesson corpus this board does not have; ' +
        'the call is refused, with the reason and the alternative in the answer.',
      inputSchema: toolSchema(
        {
          name: { type: 'string', description: 'Short lesson name (<= 80 chars).' },
          summary: { type: 'string', description: 'One-line index summary (<= 60 chars).' },
          body: { type: 'string', description: 'The full lesson body (markdown OK).' },
          trigger: { type: 'string', enum: LESSON_TRIGGERS, description: 'What prompted this lesson.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'A list of tag strings.' },
          feature_id: { type: 'string', description: 'The card this lesson came from, for provenance.' },
          kind: { type: 'string', enum: LESSON_KINDS, description: 'note (default) | skill_draft.' },
        },
        ['name', 'summary', 'trigger']
      ),
    },
    {
      name: 'list_lessons',
      description:
        'NOT AVAILABLE ON THIS BOARD. There is no lesson corpus here; the call is refused, with ' +
        'the reason and the alternative in the answer.',
      inputSchema: toolSchema(
        {
          status: { type: 'string', description: 'staged | approved | rejected (omit for all).' },
          limit: { type: 'integer', description: 'Max rows, 1..500 (default 100).' },
        },
        []
      ),
    },
    {
      name: 'get_lesson',
      description:
        'NOT AVAILABLE ON THIS BOARD. There is no lesson corpus here; the call is refused, with ' +
        'the reason and the alternative in the answer.',
      inputSchema: toolSchema(
        { id: { type: 'string', description: "The lesson id (e.g. 'ls-3')." } },
        ['id']
      ),
    },
  ];

  return {
    tools,
    handlers: {
      list_actionable: async (args) => {
        const boards = await resolveBoards(args.board);
        const queue = await buildActionableQueue(client, boards, Date.now());

        // The lane counts come along because this is the orient read: a session that can see how
        // much work the board still holds does not have to page every lane to find out.
        const counts: Array<{ boardId: string; board: string; lanes: unknown }> = [];
        for (const board of boards) {
          const lanes = await client.get<{ lanes: unknown }>(`/boards/${board.id}/lanes`);
          counts.push({ boardId: board.id, board: board.name, lanes: lanes.lanes });
        }

        return textResult({ ...queue, counts, lessons: [] });
      },

      list_active_builds: async (args) => {
        const staleSecs =
          typeof args.stale_secs === 'number' ? args.stale_secs : KANBAN_LEASE_STALE_SECONDS;
        const now = Date.now();
        const cards = await scanLaneCards(client, client.boardId, ['active']);

        return textResult(
          cards.map((card) => ({
            id: card.id,
            title: card.title,
            board: client.boardId,
            priority: card.priority,
            ...leaseFacts(card, client.owner, now, staleSecs),
          }))
        );
      },

      claim_plan: async (args) => {
        const cardId = args.id as string;
        const lease = await client.post<{ granted: boolean; card: unknown }>(
          `/cards/${cardId}/plan-lease/claim`,
          { owner: client.owner }
        );
        if (lease.granted) recordPlanLease(cardId);

        return textResult({ granted: lease.granted, card: lease.card });
      },

      search_history: async (args) => {
        const query = (args.query as string).trim();
        if (query === '') return errorResult('query must be a non-empty string');
        if (query.length > SEARCH_QUERY_MAX) {
          return errorResult(`query must be at most ${SEARCH_QUERY_MAX} characters`);
        }

        const limit = args.limit === undefined ? SEARCH_LIMIT_DEFAULT : args.limit;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT_MAX) {
          return errorResult(`limit must be a whole number between 1 and ${SEARCH_LIMIT_MAX}`);
        }

        // The DEFAULT is the searchable three, never the declared four: defaulting to the full
        // enum would make the ordinary "search everything" call the one call that refuses.
        const requestedKinds = (args.kinds as string[] | undefined) ?? [...SEARCHABLE_KINDS];
        const unknownKind = requestedKinds.find(
          (kind) => !(SEARCH_KINDS as readonly string[]).includes(kind)
        );
        if (unknownKind !== undefined) return errorResult(`unknown search kind: ${unknownKind}`);

        // The fourth lesson surface answers like the other three. There is no corpus to search,
        // and an empty result set would say "nothing to learn from" instead of "not on this board".
        if (requestedKinds.includes('lesson')) return lessonStub();

        return textResult(
          await searchHistory(client, query.toLowerCase(), new Set(requestedKinds as SearchKind[]), limit)
        );
      },

      stage_lesson: () => lessonStub(),
      list_lessons: () => lessonStub(),
      get_lesson: () => lessonStub(),
    },
  };
}
