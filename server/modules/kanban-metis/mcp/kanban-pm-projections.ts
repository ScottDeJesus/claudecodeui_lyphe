import {
  KANBAN_LEASE_STALE_SECONDS,
  type KanbanBoard,
  type KanbanCardDetail,
  type KanbanCardSummary,
  type KanbanStatus,
} from '@/shared/kanban-types.js';

import { scanLaneCards } from './kanban-pm-board-reads.js';
import type { KanbanPmClient } from './kanban-pm-client.js';

/**
 * How a board row becomes the row a tool answers with.
 *
 * The board's own shapes are the panel's: a summary carries camelCase lease stamps and a
 * server-computed `leaseState`. The tools answer a session that resumes after a disconnect and
 * has to decide, from one call, what is still live and what is its own — so the row it reads is
 * the lease arithmetic done once, in one place, rather than in each of the reads that classify
 * cards.
 *
 * This file is the PRESENT TENSE: what needs doing now and who holds it. What the board remembers
 * — the history search and the decision recall — is `kanban-pm-recall.ts`, and the two were split
 * because they change for different reasons.
 *
 * Consumers: `kanban-pm-tools-board.ts`, which builds the orient queue and the resume read from
 * these projections.
 */

/** The tag the operator uses to keep a card in their own court; such a card is never ours to claim. */
export const OPERATOR_SCHEDULED_TAG = 'operator-scheduled';

/** The lease facts a resume read classifies off: who holds it, how old the stamp is, whose it is. */
export type LeaseFacts = {
  build_owner: string | null;
  lease_age_secs: number | null;
  is_stale: boolean;
  is_mine: boolean;
  plan_owner: string | null;
  plan_lease_age_secs: number | null;
  plan_is_stale: boolean;
  plan_is_mine: boolean;
};

/** One lean orient row: enough to choose a card, never the card's body. */
export type ActionableRow = {
  id: string;
  title: string;
  status: KanbanStatus;
  board: { id: string; name: string };
  priority: string;
  sort_order: number;
  approved: boolean;
  open_questions: number;
  has_plan: boolean;
} & LeaseFacts;

export type ActionableQueue = {
  to_plan: ActionableRow[];
  buildable: ActionableRow[];
  awaiting_you: ActionableRow[];
  active: ActionableRow[];
};

function ageInSeconds(stamp: string | null, now: number): number | null {
  if (stamp === null || stamp === '') return null;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? null : Math.max(0, Math.round((now - parsed) / 1000));
}

/**
 * The lease arithmetic, against an explicit window.
 *
 * `staleSecs` defaults to the board's own window, so a read that named no window agrees with the
 * pill the panel paints. A caller that named one is answered against that one instead — a read
 * that took a `stale_secs` and ignored it would be a dial wired to nothing.
 */
export function leaseFacts(
  card: KanbanCardSummary,
  owner: string,
  now: number,
  staleSecs: number = KANBAN_LEASE_STALE_SECONDS
): LeaseFacts {
  const buildAge = ageInSeconds(card.buildLeaseAt, now);
  const planAge = ageInSeconds(card.planLeaseAt, now);

  return {
    build_owner: card.buildOwner,
    lease_age_secs: buildAge,
    is_stale: buildAge !== null && buildAge > staleSecs,
    is_mine: card.buildOwner === owner,
    plan_owner: card.planOwner,
    plan_lease_age_secs: planAge,
    plan_is_stale: planAge !== null && planAge > staleSecs,
    plan_is_mine: card.planOwner === owner,
  };
}

/**
 * The compact orient queue: `to_plan` + `buildable` + `awaiting_you` PARTITION the todo lane, and
 * `active` is the resume set.
 *
 * Every todo card lands in exactly one bucket and none is silently dropped. The
 * `operator-scheduled` tag outranks build-readiness: the operator put the card in their own court,
 * and a card they are holding is never the queue's to claim. `has_plan` is the one row field a
 * lane page does not carry, so the cards that need a bucket are the cards opened — never the
 * board's history.
 */
export async function buildActionableQueue(
  client: KanbanPmClient,
  boards: readonly KanbanBoard[],
  now: number
): Promise<ActionableQueue> {
  const queue: ActionableQueue = { to_plan: [], buildable: [], awaiting_you: [], active: [] };

  for (const board of boards) {
    const todo = await scanLaneCards(client, board.id, ['todo']);
    const questions = await scanLaneCards(client, board.id, ['questions']);
    const active = await scanLaneCards(client, board.id, ['active']);

    for (const card of [...todo, ...questions, ...active]) {
      const detail = await client.get<{ card: KanbanCardDetail }>(`/cards/${card.id}`);
      const row: ActionableRow = {
        id: card.id,
        title: card.title,
        status: card.status,
        board: { id: board.id, name: board.name },
        priority: card.priority,
        sort_order: card.sortOrder,
        approved: card.approved,
        open_questions: card.openQuestions,
        has_plan: typeof detail.card.plan === 'string' && detail.card.plan.trim() !== '',
        ...leaseFacts(card, client.owner, now),
      };

      if (card.status === 'active') {
        queue.active.push(row);
      } else if (card.status === 'questions') {
        queue.awaiting_you.push(row);
      } else if (card.tags.some((tag) => tag.trim().toLowerCase() === OPERATOR_SCHEDULED_TAG)) {
        queue.awaiting_you.push(row);
      } else if (card.approved && card.openQuestions === 0) {
        queue.buildable.push(row);
      } else {
        queue.to_plan.push(row);
      }
    }
  }

  // Current-board cards first, then the board's own order, then id — so the top of a bucket is
  // the card the operator would point at, and two sessions reading it pick the same one.
  for (const rows of Object.values(queue)) {
    rows.sort(
      (left, right) =>
        Number(left.board.id !== client.boardId) - Number(right.board.id !== client.boardId) ||
        left.sort_order - right.sort_order ||
        left.id.localeCompare(right.id)
    );
  }

  return queue;
}
