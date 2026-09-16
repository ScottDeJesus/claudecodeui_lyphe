import { kanbanLeasesDb } from '@/modules/database/index.js';
import type { KanbanEventKind, KanbanLeaseResult } from '@/shared/kanban-types.js';

import { requireCardRow, requireSummary } from './kanban-cards.guards.js';
import { writeKanban } from './kanban-write.service.js';

/**
 * The private signal a REFUSED lease raises, so the write seam rolls its transaction back.
 *
 * A refused claim is the ordinary answer, not an error: the caller is told `{ granted: false }`
 * with the card as somebody else left it, and a 200. But the seam commits whatever its `mutate`
 * returns and appends the audit row on the way — so a refusal that simply returned `false` would
 * have recorded `lease.build_claimed` for a claim that was never granted, and told every open
 * panel a card had changed hands when nothing had. Throwing out of `mutate` is the one way to get
 * the compare-and-set AND record nothing: SQLite rolls the transaction back, no row is appended,
 * and no frame is sent.
 *
 * It never escapes this module: `attempt` catches exactly this class and rethrows everything else,
 * so a caller still sees an `AppError` for a card that is not there.
 */
class LeaseRefused extends Error {}

function isLeaseRefused(error: unknown): error is LeaseRefused {
  return error instanceof LeaseRefused;
}

/**
 * One lease operation, end to end: the compare-and-set inside the write, the audit row and the
 * frame only when it succeeded, and the current card either way.
 *
 * The order inside `mutate` matters. The card is checked FIRST, so a lease on a card that does not
 * exist is a 404 rather than a refusal — there is nothing to be granted. Only then does the
 * statement run, and it is the statement's `changes` that decides: the compare and the set are one
 * UPDATE, so two builders reaching for the same free card cannot both be told they have it.
 */
function attempt(
  kind: KanbanEventKind,
  cardId: string,
  owner: string,
  take: () => boolean
): KanbanLeaseResult {
  try {
    const card = writeKanban(
      {
        kind,
        cardId,
        boardId: (summary) => summary.boardId,
        // The event's ACTOR stays the default `'operator'`: a lease owner is a build process, not
        // an identity, and the two are different questions. The owner rides in the payload.
        payload: { owner },
      },
      () => {
        requireCardRow(cardId);
        if (!take()) throw new LeaseRefused();
        return requireSummary(cardId);
      }
    );

    return { granted: true, card };
  } catch (error) {
    if (!isLeaseRefused(error)) throw error;

    // Already rolled back: the card here is the one somebody ELSE holds, which is exactly what the
    // caller needs to repaint from — so a refusal costs one read and never a second write.
    return { granted: false, card: requireSummary(cardId) };
  }
}

/**
 * The two card leases: the build lease a runner takes while it works a card, and the plan lease it
 * takes while it writes one.
 *
 * A lease is the board's lock and its heartbeat at once — a card under a live lease is being built
 * somewhere, and the panel draws it from the summary's `leaseState`, which the server computes from
 * the same window a claim is granted by. Nothing here re-derives staleness: the window lives once
 * in `server/shared/kanban-types.ts` and the compare-and-set reads it there.
 *
 * Every granted operation goes through `writeKanban`; a refused one writes nothing, records
 * nothing and sends nothing. These verbs take an explicit OWNER and no write context — a lease
 * owner is a different concept from an event actor, and a caller that wanted an actor would be
 * naming the wrong thing.
 *
 * Consumers: `routes/detail.routes.ts` and the barrel, which is how a future in-process MCP
 * adapter (and the builder it drives) calls the same verbs.
 */
export const kanbanLeasesService = {
  /** Takes the build lease for `owner` — free, stale, or already theirs. */
  claimBuildLease(cardId: string, owner: string): KanbanLeaseResult {
    return attempt('lease.build_claimed', cardId, owner, () =>
      kanbanLeasesDb.claimBuildLease(cardId, owner)
    );
  },

  /** Re-stamps a build lease this owner already holds, and refuses one it does not. */
  refreshBuildLease(cardId: string, owner: string): KanbanLeaseResult {
    return attempt('lease.build_refreshed', cardId, owner, () =>
      kanbanLeasesDb.refreshBuildLease(cardId, owner)
    );
  },

  /** Gives the build lease up. A caller may release its own lease and nobody else's. */
  releaseBuildLease(cardId: string, owner: string): KanbanLeaseResult {
    return attempt('lease.build_released', cardId, owner, () =>
      kanbanLeasesDb.releaseBuildLease(cardId, owner)
    );
  },

  /** Takes the plan lease for `owner`, on the same terms as the build lease. */
  claimPlanLease(cardId: string, owner: string): KanbanLeaseResult {
    return attempt('lease.plan_claimed', cardId, owner, () =>
      kanbanLeasesDb.claimPlanLease(cardId, owner)
    );
  },

  /** Gives the plan lease up. */
  releasePlanLease(cardId: string, owner: string): KanbanLeaseResult {
    return attempt('lease.plan_released', cardId, owner, () =>
      kanbanLeasesDb.releasePlanLease(cardId, owner)
    );
  },
};

/** What `routes/detail.routes.ts` and `kanban.module.ts` take hold of. */
export type KanbanLeasesService = typeof kanbanLeasesService;
