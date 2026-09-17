import { KANBAN_PRIORITIES, KANBAN_STATUSES, type KanbanCardDetail, type KanbanCardSummary, type KanbanPriority, type KanbanStatus } from '@/shared/kanban-types.js';

import { ALL_STATUSES, listBoards, scanLaneCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';
import { forgetBuildLease, recordBuildLease, releasePlanLease } from './kanban-pm-heartbeat.js';
import {
  CARD_ID_ARGUMENT,
  TAG_ARGUMENT,
  TAGS_ARGUMENT,
  textResult,
  toolSchema,
  type ToolTable,
} from './mcp-protocol.js';

/**
 * The nine card tools: the feature's own lifecycle, over the board's card routes.
 *
 * The names are `descent-pm`'s to the letter, because the brief a Metis child is handed and the
 * hook matchers around her were written against them — a ported brief asking for `create_feature`
 * must not find a tool called `create_feature_card`. What changes is only the server word
 * (`mcp__kanban-pm__create_feature`).
 *
 * Consumers: `kanban-pm-mcp.ts`, which assembles this table with the other two and starts the
 * transport over it.
 */

type CardEnvelope = { card: KanbanCardDetail };

const STATUS_ARGUMENT = {
  type: 'string',
  enum: [...KANBAN_STATUSES],
  description: 'not_ready | todo | questions | active | done.',
};

/** The cards of one board carrying a tag, or all of them when no tag was named. */
function withTag(cards: readonly KanbanCardSummary[], tag: string | undefined): KanbanCardSummary[] {
  if (tag === undefined) return [...cards];
  const wanted = tag.trim().toLowerCase();
  return cards.filter((card) => card.tags.some((value) => value.toLowerCase() === wanted));
}

function statusesFor(status: unknown): readonly KanbanStatus[] {
  return typeof status === 'string' ? [status as KanbanStatus] : ALL_STATUSES;
}

export function createCardTools(client: KanbanPmClient): ToolTable {
  const openCard = async (cardId: string): Promise<KanbanCardDetail> =>
    (await client.get<CardEnvelope>(`/cards/${cardId}`)).card;

  const tools = [
    {
      name: 'list_features',
      description:
        'List feature cards on THIS board, optionally filtered by status (not_ready | todo | ' +
        "questions | active | done) and/or a single tag. 'not_ready' is the operator's pre-To-do " +
        "staging lane — ignore it; your queue is status='todo'. Lean rows: title, status, " +
        'priority, tags and the counts. Read-only.',
      inputSchema: toolSchema({ status: STATUS_ARGUMENT, tag: TAG_ARGUMENT }, []),
    },
    {
      name: 'list_features_all',
      description:
        'List feature cards across EVERY non-archived board, optionally filtered by status ' +
        'and/or a single tag. Each row carries its owning board {id, name}. Read-only — it does ' +
        'not change which board is current.',
      inputSchema: toolSchema({ status: STATUS_ARGUMENT, tag: TAG_ARGUMENT }, []),
    },
    {
      name: 'get_feature_plan',
      description:
        "Fetch one feature's full spec: title, plan, cached plan body, description, tags, design " +
        'questions, issues, the approval gate and the derived counts. Read-only.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT }, ['id']),
    },
    {
      name: 'create_feature',
      description:
        "Create a feature card in the Not Ready staging lane (the operator's pre-To-do stage). " +
        "Put the operator's PRIMARY INTENT in 'description' — it is the durable why/what and " +
        "attach_plan never overwrites it. Returns the minted card (id like 'c-N').",
      inputSchema: toolSchema(
        {
          title: { type: 'string', description: 'The feature title.' },
          priority: {
            type: 'string',
            enum: [...KANBAN_PRIORITIES],
            description: 'low | medium | high (defaults to medium).',
          },
          tags: TAGS_ARGUMENT,
          description: { type: 'string', description: "The operator's primary intent." },
          body: {
            type: 'string',
            description: 'Optional secondary plan-body context; attach_plan overwrites it.',
          },
        },
        ['title']
      ),
    },
    {
      name: 'attach_plan',
      description:
        "Attach a plan to a feature: set its plan file path and cache the plan's markdown body " +
        'on the card. Overwrites any body already there.',
      inputSchema: toolSchema(
        {
          id: CARD_ID_ARGUMENT,
          path: { type: 'string', description: "The plan file path (e.g. 'plans/<name>.md')." },
          body: { type: 'string', description: "The plan's markdown body, cached on the card." },
        },
        ['id', 'path', 'body']
      ),
    },
    {
      name: 'set_status',
      description:
        'Move a feature to a lane (not_ready | todo | questions | active | done). Moving to ' +
        "'active' ALSO claims the build lease for this session, so no other session can take the " +
        'card while you build it. The lease verdict is returned beside the card.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT, status: STATUS_ARGUMENT }, ['id', 'status']),
    },
    {
      name: 'set_tags',
      description:
        "Replace a feature's tag set WHOLESALE with the given list — a tag you leave out is " +
        'removed. Returns the card as the board normalized it.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT, tags: TAGS_ARGUMENT }, ['id', 'tags']),
    },
    {
      name: 'archive_feature',
      description:
        "Archive a feature (hide it from the board's active lanes). Extinguishes the building " +
        'pill if it was building.',
      inputSchema: toolSchema({ id: CARD_ID_ARGUMENT }, ['id']),
    },
    {
      name: 'set_closing_remarks',
      description:
        'Record CLOSING REMARKS on a feature card after a build completes — a short, HONEST ' +
        'summary of what shipped and any follow-ups. Call it as the FINAL build step, only on a ' +
        'real ship. Open with one plain-prose TL;DR line, then any needs-the-operator lines.',
      inputSchema: toolSchema(
        {
          id: CARD_ID_ARGUMENT,
          remarks: { type: 'string', description: 'The closing summary (markdown OK).' },
        },
        ['id', 'remarks']
      ),
    },
  ];

  return {
    tools,
    handlers: {
      list_features: async (args) => {
        const cards = await scanLaneCards(client, client.boardId, statusesFor(args.status));
        return textResult(withTag(cards, args.tag as string | undefined));
      },

      list_features_all: async (args) => {
        const boards = await listBoards(client);
        const tag = args.tag as string | undefined;
        const rows: Array<KanbanCardSummary & { board: { id: string; name: string } }> = [];

        for (const board of boards) {
          if (board.archived) continue;
          const cards = await scanLaneCards(client, board.id, statusesFor(args.status));
          for (const card of withTag(cards, tag)) {
            rows.push({ ...card, board: { id: board.id, name: board.name } });
          }
        }

        return textResult(rows);
      },

      get_feature_plan: async (args) => textResult(await openCard(args.id as string)),

      create_feature: async (args) => {
        const created = await client.post<CardEnvelope>(`/boards/${client.boardId}/cards`, {
          title: args.title,
          priority: args.priority as KanbanPriority | undefined,
          description: args.description,
        });

        const cardId = created.card.id;
        for (const tag of (args.tags as string[] | undefined) ?? []) {
          await client.post<CardEnvelope>(`/cards/${cardId}/tags`, { tag });
        }
        if (typeof args.body === 'string') {
          await client.patch<CardEnvelope>(`/cards/${cardId}`, { body: args.body });
        }

        // Re-read rather than echo the create's answer: the tags and the body were two more
        // writes, and a caller handed the pre-tag card would show the model a card nobody sees.
        return textResult(await openCard(cardId));
      },

      attach_plan: async (args) => {
        const cardId = args.id as string;
        const card = await client.patch<CardEnvelope>(`/cards/${cardId}`, {
          plan: args.path,
          body: args.body,
        });

        // Attaching the plan is the planner's own "planning done" signal, so the plan claim taken
        // before authoring ends here. It happens AFTER the write: a released lease on a plan that
        // failed to attach would reopen the double-plan race this lease exists to close.
        await releasePlanLease(client, cardId);

        return textResult(card.card);
      },

      set_status: async (args) => {
        const cardId = args.id as string;
        const status = args.status as KanbanStatus;
        const moved = await client.post<CardEnvelope>(`/cards/${cardId}/move`, { status });

        if (status !== 'active') {
          // Leaving `active` clears the build lease on the board (the move verb does it), so this
          // session must stop re-stamping a lease it no longer holds.
          forgetBuildLease(cardId);
          return textResult(moved.card);
        }

        // The claim is what makes 'active' mean "a session is building this": the move alone
        // lights the pill for every session watching, and two sessions could both hold the card.
        const lease = await client.post<{ granted: boolean; card: KanbanCardSummary }>(
          `/cards/${cardId}/build-lease/claim`,
          { owner: client.owner }
        );
        if (lease.granted) {
          recordBuildLease(cardId);
        }

        return textResult({ card: lease.card, buildLease: lease.granted });
      },

      set_tags: async (args) => {
        const cardId = args.id as string;
        const wanted = ((args.tags as string[] | undefined) ?? []).map((tag) => tag.trim()).filter(Boolean);

        let card = await openCard(cardId);
        const wantedKeys = new Set(wanted.map((tag) => tag.toLowerCase()));
        const currentKeys = new Set(card.tags.map((tag) => tag.toLowerCase()));

        for (const tag of card.tags) {
          if (wantedKeys.has(tag.toLowerCase())) continue;
          card = (await client.del<CardEnvelope>(`/cards/${cardId}/tags/${encodeURIComponent(tag)}`)).card;
        }
        for (const tag of wanted) {
          if (currentKeys.has(tag.toLowerCase())) continue;
          card = (await client.post<CardEnvelope>(`/cards/${cardId}/tags`, { tag })).card;
        }

        return textResult(card);
      },

      archive_feature: async (args) =>
        textResult((await client.post<CardEnvelope>(`/cards/${args.id as string}/archive`)).card),

      set_closing_remarks: async (args) =>
        textResult(
          (
            await client.patch<CardEnvelope>(`/cards/${args.id as string}`, {
              closingRemarks: args.remarks,
            })
          ).card
        ),
    },
  };
}
