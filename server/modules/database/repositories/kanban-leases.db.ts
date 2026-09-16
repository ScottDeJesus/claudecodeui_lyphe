import { getConnection } from '@/modules/database/connection.js';
import { KANBAN_LEASE_STALE_SECONDS } from '@/shared/kanban-types.js';

/**
 * The two leases a card carries — the build lease and the plan lease — as compare-and-set
 * statements on `kanban_cards`.
 *
 * A lease is not a row of its own: it is four columns on the card, so every lease operation is one
 * UPDATE whose WHERE clause decides whether the caller is allowed to have it. That single statement
 * is what makes the decision atomic — a read of the lease followed by a write would let two
 * builders read the same free card and both write themselves onto it.
 *
 * A CLAIM IS GRANTED IN EXACTLY FOUR CASES, and they are the whole predicate:
 *
 *   - `IS NULL`         nobody has ever claimed it;
 *   - `owner = ?`       the caller already holds it, so a re-claim is idempotent rather than a
 *                       refusal — a build retrying its own claim must not be told it lost;
 *   - unreadable stamp  `julianday(…) IS NULL`: a stamp that will not parse belongs to a writer
 *                       that is gone, and treating it as live would hold the card forever;
 *   - stale             older than `KANBAN_LEASE_STALE_SECONDS`, the ONE home for that number
 *                       (§`server/shared/kanban-types.ts`) — never a literal here. `readLeaseState`
 *                       in `kanban-cards-paging.db.ts` draws the same line from the same constant,
 *                       so the `leaseState` on a summary and a claim's verdict cannot disagree.
 *
 * Consumers: `kanban-leases.service.ts` (all five verbs).
 */
export const kanbanLeasesDb = {
  /** Takes the build lease when it is free, stale, or already this owner's. */
  claimBuildLease(cardId: string, owner: string): boolean {
    return claimLease('build_lease_at', 'build_owner', cardId, owner);
  },

  /** Takes the plan lease on the same terms. A card holds both leases at once, independently. */
  claimPlanLease(cardId: string, owner: string): boolean {
    return claimLease('plan_lease_at', 'plan_owner', cardId, owner);
  },

  /**
   * Re-stamps the build lease for the owner that already holds it.
   *
   * OWNERSHIP IS THE WHOLE TEST, deliberately: a refresh is the holder saying "still working", and
   * refusing one for a stamp that happened to go quiet would kill a build that is merely slow —
   * the stale window is how a CARD is taken back from a writer that vanished, not a clock a live
   * writer has to beat.
   */
  refreshBuildLease(cardId: string, owner: string): boolean {
    const now = new Date().toISOString();
    const result = getConnection()
      .prepare(
        'UPDATE kanban_cards SET build_lease_at = ?, updated_at = ? WHERE id = ? AND build_owner = ?'
      )
      .run(now, now, cardId, owner);

    return result.changes > 0;
  },

  /** Clears the build lease, but only for the owner releasing it. */
  releaseBuildLease(cardId: string, owner: string): boolean {
    return releaseLease('build_lease_at', 'build_owner', cardId, owner);
  },

  /** Clears the plan lease, but only for the owner releasing it. */
  releasePlanLease(cardId: string, owner: string): boolean {
    return releaseLease('plan_lease_at', 'plan_owner', cardId, owner);
  },
};

/** The four columns a lease lives on. Named here so a claim and its release cannot drift apart. */
type LeaseStampColumn = 'build_lease_at' | 'plan_lease_at';
type LeaseOwnerColumn = 'build_owner' | 'plan_owner';

/**
 * The instant a lease stops being held: now, less the shared staleness window.
 *
 * Computed here from `KANBAN_LEASE_STALE_SECONDS` and compared in SQL against the stored stamp, so
 * the number is written once in the module and the comparison happens inside the same statement as
 * the write.
 */
function staleBefore(now: number): string {
  return new Date(now - KANBAN_LEASE_STALE_SECONDS * 1000).toISOString();
}

/**
 * The claim predicate, over whichever lease's two columns it is asked about.
 *
 * The column names are the module's own literals and are never caller input — the only two values
 * this module ever builds into SQL are a claim's timestamp and owner, and both are bound.
 */
function claimableClause(stamp: LeaseStampColumn, owner: LeaseOwnerColumn): string {
  return `(${stamp} IS NULL OR ${owner} = ? OR julianday(${stamp}) IS NULL OR julianday(${stamp}) < julianday(?))`;
}

/** The compare-and-set both claims run: one statement, and `changes` is the verdict. */
function claimLease(
  stamp: LeaseStampColumn,
  ownerColumn: LeaseOwnerColumn,
  cardId: string,
  owner: string
): boolean {
  const now = Date.now();
  const stampNow = new Date(now).toISOString();

  const result = getConnection()
    .prepare(
      `UPDATE kanban_cards SET ${stamp} = ?, ${ownerColumn} = ?, updated_at = ?
       WHERE id = ? AND ${claimableClause(stamp, ownerColumn)}`
    )
    .run(stampNow, owner, stampNow, cardId, owner, staleBefore(now));

  return result.changes > 0;
}

/**
 * The release both leases share: a caller may clear its OWN lease and nothing else.
 *
 * A stale stamp still naming the caller is released too, which is what lets an abandoned build be
 * tidied up by the process that abandoned it. An unheld lease has nothing to release, and a lease
 * held by another writer is not this caller's to clear — both report false and write nothing.
 */
function releaseLease(
  stamp: LeaseStampColumn,
  ownerColumn: LeaseOwnerColumn,
  cardId: string,
  owner: string
): boolean {
  const result = getConnection()
    .prepare(
      `UPDATE kanban_cards SET ${stamp} = NULL, ${ownerColumn} = NULL, updated_at = ?
       WHERE id = ? AND ${ownerColumn} = ?`
    )
    .run(new Date().toISOString(), cardId, owner);

  return result.changes > 0;
}
