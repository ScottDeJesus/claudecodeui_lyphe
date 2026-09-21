import {
  getConnection,
  kanbanCardsDb,
  kanbanCardTagsDb,
  kanbanChecklistDb,
  kanbanIdsDb,
  kanbanQuestionsDb,
  laneBounds,
  renormaliseLane,
} from '@/modules/database/index.js';
import {
  KANBAN_LANE_LIMIT_DEFAULT,
  KANBAN_LEASE_STALE_SECONDS,
  KANBAN_SORT_ORDER_GAP,
  KANBAN_SORT_ORDER_MIN_GAP,
  KANBAN_STATUSES,
  type KanbanCardDetail,
  type KanbanCardSummary,
  type KanbanPriority,
  type KanbanStatus,
  type KanbanWriteContext,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import {
  cardNotFound,
  requireBoard,
  requireCardRow,
  requireLaneNeighbour,
  requireSummary,
  requireTag,
  requireTitle,
} from './kanban-cards.guards.js';
import { writeKanban } from './kanban-write.service.js';

/**
 * The sort_order a moved card lands on, from the two neighbours the caller named.
 *
 * `null` on both ends is an empty target lane, so the card takes the first rung. One end named puts
 * it at the top or the bottom of the lane it joins, read from the BOARD's bounds and never from a
 * named neighbour's value: the server never learns which statuses compose the caller's lane, and
 * the board's envelope is past every card of every lane that could hold this one — where bounds off
 * a single status land inside the lane as soon as a sibling status reaches past its edge.
 *
 * Both ends named is the only case that can run out of room — two neighbours closer than
 * `KANBAN_SORT_ORDER_MIN_GAP` — so the order is restacked FIRST, the whole board's, and the midpoint
 * recomputed from the neighbours re-read at their new values, all inside the transaction.
 */
function resolveMoveOrder(
  boardId: string,
  afterId: string | null,
  beforeId: string | null
): number {
  if (afterId === null && beforeId === null) return KANBAN_SORT_ORDER_GAP;

  if (afterId === null || beforeId === null) {
    const bounds = laneBounds(boardId, KANBAN_STATUSES);
    if (bounds.min === null || bounds.max === null) return KANBAN_SORT_ORDER_GAP;
    return afterId === null ? bounds.min - KANBAN_SORT_ORDER_GAP : bounds.max + KANBAN_SORT_ORDER_GAP;
  }

  const above = requireLaneNeighbour(afterId, boardId);
  const below = requireLaneNeighbour(beforeId, boardId);

  if (Math.abs(below.sort_order - above.sort_order) >= KANBAN_SORT_ORDER_MIN_GAP) {
    return (above.sort_order + below.sort_order) / 2;
  }

  renormaliseLane(boardId, KANBAN_STATUSES);

  const restacked = requireLaneNeighbour(afterId, boardId);
  const beneath = requireLaneNeighbour(beforeId, boardId);
  return (restacked.sort_order + beneath.sort_order) / 2;
}

/** Archives or restores one card. Both verbs are the same write with a different event kind. */
function setCardArchived(
  kind: 'card.archived' | 'card.restored',
  cardId: string,
  archived: boolean,
  context?: KanbanWriteContext
): KanbanCardSummary {
  return writeKanban({ kind, cardId, actor: context?.actor, boardId: (card) => card.boardId }, () => {
    // Inside the transaction: "was the card there" and "archive it" are one statement's question.
    if (!kanbanCardsDb.setArchived(cardId, archived)) throw cardNotFound(cardId);
    return requireSummary(cardId);
  });
}

/**
 * One tick's four token deltas, as the telemetry watcher counted them out of a transcript.
 *
 * A DELTA, never a total: the card's four `build_tokens_*` columns are the sum of every session
 * that ever worked the card, so a caller handing over a session's cumulative would erase the
 * spend of the session before it. `metis-telemetry.service.ts` is the only caller.
 */
export type KanbanTokenDelta = {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreate: number;
};

/**
 * ONE accumulating statement: `col = col + ?`, never a read-modify-write.
 *
 * The read-then-write shape loses an increment whenever a tick races a claim, a move or another
 * session's tick on the same row — SQLite serialises the write lock, so the additive UPDATE is the
 * only shape that cannot drop a delta. Zero on a card the row no longer holds (a card deleted
 * between the attribution read and this statement), which the verb turns into the caller's 404.
 *
 * `updated_at` is deliberately NOT stamped. It is what orders the Done lane (`kanban-cards.db.ts`'s
 * `listLane` reads `updated_at DESC` for the statuses that live there), and a token count is not a
 * card moving: stamping it would shuffle a lane every thirty seconds.
 */
function addBuildTokenCounters(cardId: string, delta: KanbanTokenDelta): boolean {
  const changed = getConnection()
    .prepare(
      `UPDATE kanban_cards SET
         build_tokens_in = build_tokens_in + ?,
         build_tokens_out = build_tokens_out + ?,
         build_tokens_cache_read = build_tokens_cache_read + ?,
         build_tokens_cache_create = build_tokens_cache_create + ?
       WHERE id = ?`
    )
    .run(delta.tokensIn, delta.tokensOut, delta.cacheRead, delta.cacheCreate, cardId).changes;

  return changed > 0;
}

/** Adds or removes one tag. Its own write, because a tag change is its own audit line. */
function setCardTag(
  kind: 'tag.added' | 'tag.removed',
  cardId: string,
  tag: string,
  context?: KanbanWriteContext
): KanbanCardSummary {
  const cleanTag = requireTag(tag);
  const spec = {
    kind,
    cardId,
    actor: context?.actor,
    payload: { tag: cleanTag },
    boardId: (card: KanbanCardSummary) => card.boardId,
  };

  return writeKanban(spec, () => {
    // The join table's foreign key would refuse this in SQLite's words. Same refusal, caller's words.
    requireSummary(cardId);
    if (kind === 'tag.added') kanbanCardTagsDb.addTag(cardId, cleanTag);
    else kanbanCardTagsDb.removeTag(cardId, cleanTag);

    return requireSummary(cardId);
  });
}

/**
 * The card verbs. EVERY write goes through `writeKanban` — no verb here opens a transaction, inserts
 * an event or broadcasts — and each threads `context?.actor` into the seam, so an audit row's actor
 * is `'operator'` today and an adapter's own tomorrow without a signature moving.
 */
export const kanbanCardsService = {
  /**
   * ONE ordered page across a whole status set, and the cursor that resumes after it. A lane is a
   * SET of statuses — with autonomy off, To Do is `todo` plus `questions` — so the page is ONE
   * ordering across that set, never one page per status stitched. The route clamps the limit.
   */
  listLaneCards(
    boardId: string,
    statuses: KanbanStatus[],
    options: { limit?: number; cursor?: string | null }
  ): { cards: KanbanCardSummary[]; nextCursor: string | null } {
    requireBoard(boardId);

    // An empty set would build `status IN ()`, a syntax error rather than an empty page.
    if (statuses.length === 0) {
      throw new AppError('A lane page needs at least one status.', {
        code: 'KANBAN_STATUS_REQUIRED',
        statusCode: 400,
      });
    }

    return kanbanCardsDb.listLane(
      boardId,
      statuses,
      options.limit ?? KANBAN_LANE_LIMIT_DEFAULT,
      options.cursor ?? null
    );
  },

  /**
   * Creates one card at the bottom of its board's ladder. The board is checked BEFORE the id is
   * minted, so a refused create does not burn a counter, and again inside the transaction so the
   * write asserts its own precondition. The mint cannot move inside it this phase: the seam takes a
   * card id as a plain field, and only `boardId` has the function-of-the-result form.
   */
  createCard(
    boardId: string,
    input: { title: string; priority?: KanbanPriority; status?: KanbanStatus; description?: string },
    context?: KanbanWriteContext
  ): KanbanCardSummary {
    const title = requireTitle(input.title);
    requireBoard(boardId);
    const cardId = kanbanIdsDb.mintId('c');

    return writeKanban({ kind: 'card.created', boardId, cardId, actor: context?.actor }, () => {
      requireBoard(boardId);
      kanbanCardsDb.insertCard({
        id: cardId,
        boardId,
        title,
        status: input.status ?? 'not_ready',
        priority: input.priority ?? 'medium',
        description: input.description ?? '',
      });
      return requireSummary(cardId);
    });
  },

  /**
   * One card with everything only an open drawer shows.
   *
   * The five child collections come from the two detail repositories, so a drawer cannot show a
   * checklist whose count disagrees with the card's face — both are read from the same rows, and
   * the summary's rolled-up counts are the same `answered = 0` and `state = 'done'` predicates the
   * lists are built from.
   */
  getCard(cardId: string): KanbanCardDetail {
    const row = requireCardRow(cardId);

    return {
      ...requireSummary(cardId),
      description: row.description,
      body: row.body,
      plan: row.plan,
      closingRemarks: row.closing_remarks,
      approvedAt: row.approved_at,
      buildTokensIn: row.build_tokens_in,
      buildTokensOut: row.build_tokens_out,
      buildTokensCacheRead: row.build_tokens_cache_read,
      buildTokensCacheCreate: row.build_tokens_cache_create,
      questions: kanbanQuestionsDb.listQuestions(cardId),
      issues: kanbanChecklistDb.listIssues(cardId),
      decisions: kanbanQuestionsDb.listDecisions(cardId),
      checklist: kanbanChecklistDb.listChecklistItems(cardId),
      attachments: kanbanChecklistDb.listAttachments(cardId),
    };
  },

  /**
   * Applies a text patch and returns the card as it stands; a missing card is a 404. The write
   * decides whether the card was there, so check and update are one statement inside one transaction.
   */
  updateCard(
    cardId: string,
    patch: {
      title?: string;
      priority?: KanbanPriority;
      description?: string;
      body?: string;
      plan?: string | null;
      closingRemarks?: string;
    },
    context?: KanbanWriteContext
  ): KanbanCardSummary {
    const title = patch.title === undefined ? undefined : requireTitle(patch.title);

    return writeKanban(
      { kind: 'card.updated', cardId, actor: context?.actor, boardId: (card) => card.boardId },
      () => {
        const changed = kanbanCardsDb.updateCard({
          id: cardId,
          title,
          priority: patch.priority,
          description: patch.description,
          body: patch.body,
          plan: patch.plan,
          closingRemarks: patch.closingRemarks,
        });

        if (!changed) throw cardNotFound(cardId);
        return requireSummary(cardId);
      }
    );
  },

  /**
   * Adds one tick's token spend to a card's four build counters.
   *
   * The card face's token figure and the drawer's four-counter ledger render these columns. An
   * import seeds them once; this is the only LIVE writer, and the telemetry watcher
   * is its one caller, handing over a DELTA (the session's transcript against the row it stored last
   * tick). Two Metis sessions can work one card over its life, so the accumulate is the whole point:
   * a verb that SET the columns to its own totals would erase the earlier session's spend.
   *
   * A card that has gone away between the attribution read and this write is the same 404 every
   * other card verb answers, and the seam rolls the audit row back with it.
   */
  addCardTokens(
    cardId: string,
    delta: KanbanTokenDelta,
    context?: KanbanWriteContext
  ): KanbanCardSummary {
    return writeKanban(
      {
        kind: 'card.updated',
        cardId,
        actor: context?.actor,
        // Named in the audit row: the counters are the payload's only subject, and a `card.updated`
        // line with an empty payload would say a tick happened without saying what it wrote.
        payload: { tokens: delta },
        boardId: (card) => card.boardId,
      },
      () => {
        if (!addBuildTokenCounters(cardId, delta)) throw cardNotFound(cardId);
        return requireSummary(cardId);
      }
    );
  },

  /**
   * Moves one card into a status, at the position its two neighbours describe. The move, its
   * renormalisation when the midpoint runs out of room, and the clearing of the build lease are ONE
   * `mutate` callback: one transaction, one event, one frame. A card leaving `active` loses its lease.
   */
  moveCard(
    cardId: string,
    input: { status: KanbanStatus; afterId?: string | null; beforeId?: string | null },
    context?: KanbanWriteContext
  ): KanbanCardSummary {
    // Read before the write: the seam fixes a payload before `mutate` runs, and "this card left
    // that status" is the one fact a move log exists to record.
    const before = requireCardRow(cardId);

    return writeKanban(
      {
        kind: 'card.moved',
        cardId,
        actor: context?.actor,
        payload: { from: before.status, to: input.status },
        boardId: (card) => card.boardId,
      },
      () => {
        // Re-read inside the transaction: this row decides which lane the card is LEAVING.
        const current = requireCardRow(cardId);

        kanbanCardsDb.setStatusAndOrder({
          id: cardId,
          status: input.status,
          sortOrder: resolveMoveOrder(
            current.board_id,
            input.afterId ?? null,
            input.beforeId ?? null
          ),
          clearBuildLease: current.status === 'active' && input.status !== 'active',
        });

        return requireSummary(cardId);
      }
    );
  },

  /** Archives one card: it stops appearing in any lane, and its audit rows stay. */
  archiveCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary {
    return setCardArchived('card.archived', cardId, true, context);
  },

  /** Restores one card to the status it was archived from, at the order it still carries. */
  restoreCard(cardId: string, context?: KanbanWriteContext): KanbanCardSummary {
    return setCardArchived('card.restored', cardId, false, context);
  },

  /** Adds one tag. Already there is not an error — the same tag twice is one tag. */
  addTag(cardId: string, tag: string, context?: KanbanWriteContext): KanbanCardSummary {
    return setCardTag('tag.added', cardId, tag, context);
  },

  /** Removes one tag. A tag that is not there is already the desired state. */
  removeTag(cardId: string, tag: string, context?: KanbanWriteContext): KanbanCardSummary {
    return setCardTag('tag.removed', cardId, tag, context);
  },
};

/**
 * Every plan path a live card's lease is holding, right now.
 *
 * The plan-archive sweep moves a finished plan out of the corpus, and the ONE thing that must stop
 * it is a build or a plan still running against that file: a card's lease can be fresh on a plan
 * nobody has touched for a week, so age alone does not cover it. This is the board answering what
 * its own leases hold, so that no other module has to read these rows sideways to find out.
 *
 * A lease is fresh by the SAME window a claim is granted by — `KANBAN_LEASE_STALE_SECONDS`, the one
 * home for the number, compared here the way `kanban-leases.db.ts` compares it for a claim — so a
 * card whose builder died does not hold a plan forever, and one whose builder is working does.
 * A stamp that will not parse is not fresh, which is the reading `readLeaseState` already gives it.
 *
 * The paths are returned as the card's `plan` column spells them (`~` and all): the caller is what
 * joins these to the corpus's own paths, and normalising here would put a second rule for "two
 * spellings of one path" in the board's hands.
 *
 * READ-ONLY, and it names no card: an empty list means no live lease holds any plan, which is the
 * ordinary answer on a quiet board rather than an error.
 */
export function plansHeldByLease(): string[] {
  const staleBefore = new Date(Date.now() - KANBAN_LEASE_STALE_SECONDS * 1000).toISOString();

  const rows = getConnection()
    .prepare(
      `SELECT DISTINCT plan FROM kanban_cards
       WHERE archived = 0
         AND TRIM(COALESCE(plan, '')) != ''
         AND (
           (plan_lease_at IS NOT NULL AND julianday(plan_lease_at) >= julianday(?))
           OR (build_lease_at IS NOT NULL AND julianday(build_lease_at) >= julianday(?))
         )
       ORDER BY plan ASC`
    )
    .all(staleBefore, staleBefore) as { plan: string }[];

  return rows.map((row) => row.plan);
}

/** What `routes/card.routes.ts` takes hold of. */
export type KanbanCardsService = typeof kanbanCardsService;
