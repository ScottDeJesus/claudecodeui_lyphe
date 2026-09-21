import { KANBAN_LEASE_STALE_SECONDS, type KanbanBoard } from '@/shared/kanban-types.js';

import { listBoards, scanLaneCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';
import { recordPlanLease } from './kanban-pm-heartbeat.js';
import { buildActionableQueue, leaseFacts } from './kanban-pm-projections.js';
import {
  SEARCH_KINDS,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX,
  searchHistory,
  type SearchKind,
} from './kanban-pm-recall.js';
import { approvedLessons, createLessonTools } from './kanban-pm-tools-lessons.js';
import {
  CARD_ID_ARGUMENT,
  errorResult,
  textResult,
  toolSchema,
  type ToolTable,
} from './mcp-protocol.js';

/**
 * The board-level tools: the orient queue, the resume read, the plan claim and history search —
 * plus the three lesson tools, whose descriptors and handlers live in
 * `kanban-pm-tools-lessons.ts` and are spliced in at the bottom of this table.
 *
 * Names are fixed, for the reason `kanban-pm-tools-cards.ts` states. The rows these reads
 * answer with are projected in `kanban-pm-projections.ts`.
 *
 * Consumers: `kanban-pm-mcp.ts`, which assembles this table with the other two and starts the
 * transport over it.
 */

export function createBoardTools(client: KanbanPmClient): ToolTable {
  /** The boards a read covers: this board, one named board, or every non-archived board. */
  const resolveBoards = async (board: unknown): Promise<KanbanBoard[]> => {
    const boards = await listBoards(client);
    if (board === undefined) return boards.filter((entry) => entry.id === client.boardId);
    if (board === 'all') return boards.filter((entry) => !entry.archived);
    return boards.filter((entry) => entry.id === board);
  };

  const lessons = createLessonTools(client);

  const tools = [
    {
      name: 'list_actionable',
      description:
        'The COMPACT orient queue — what needs doing, bucketed, with no plan bodies. Returns ' +
        "'to_plan' (todo, not build-ready yet: claim_plan FIRST, then author and post questions), " +
        "'buildable' (todo, approved, no open questions), 'awaiting_you' (the questions lane, plus " +
        "any todo card tagged operator-scheduled) and 'active'. Every row carries its lease facts. " +
        "The 'lessons' key carries the APPROVED lesson index (newest first, at most 50) — the " +
        'corpus the operator has signed off. It is estate-wide: a lesson belongs to no board.',
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
        "decisions and its issues, the audit log — the only place an archived card's history is " +
        'still readable — and the whole lesson corpus, rejected rows included, because a rejected ' +
        'lesson is history too. Ranked, snippeted. Answers {hits, scanned_cards, events_read, ' +
        'more_events, lessons_read, more_lessons} — read those counts: a small scanned_cards, a ' +
        'true more_events or a true more_lessons means the corpus was not fully read.',
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
              'Optional: restrict to a subset of feature | decision | issue | lesson. The ' +
              'default is all four.',
          },
          limit: {
            type: 'integer',
            description: 'Max hits, 1..100 (default 20). An out-of-range value is refused.',
          },
        },
        ['query']
      ),
    },
  ];

  return {
    tools: [...tools, ...lessons.tools],
    handlers: {
      ...lessons.handlers,

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

        // The approved lesson index rides the orient read: the corpus is where a session learns
        // what the operator already signed off before it plans anything.
        return textResult({ ...queue, counts, lessons: await approvedLessons(client) });
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

        // The default is the whole corpus: every kind a search covers.
        const requestedKinds = (args.kinds as string[] | undefined) ?? [...SEARCH_KINDS];
        const unknownKind = requestedKinds.find(
          (kind) => !(SEARCH_KINDS as readonly string[]).includes(kind)
        );
        if (unknownKind !== undefined) return errorResult(`unknown search kind: ${unknownKind}`);

        return textResult(
          await searchHistory(client, query.toLowerCase(), new Set(requestedKinds as SearchKind[]), limit)
        );
      },
    },
  };
}
