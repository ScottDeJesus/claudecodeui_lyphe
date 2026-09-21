import type { KanbanPmClient } from './kanban-pm-client.js';

/**
 * The lease heartbeat: the re-stamp that keeps this session's leases from going stale under it.
 *
 * A lease IS the heartbeat — the board calls a lease stale after forty seconds without one — so a
 * session that claimed a card and then thought for a minute would find its own card reaped and
 * handed to somebody else. The re-stamp belongs HERE, in the process holding the lease, and not in
 * whatever spawned it: the lease verbs are compare-and-set on the OWNER, and a refresh sent by a
 * process that is not acting as that owner would defeat the compare — the owner is what the claim
 * checks, so only the owner can renew it.
 *
 * What is re-stamped is a claim this process STILL HOLDS, and the set is kept honest from both
 * ends. A refused re-stamp drops the card, because a refusal is the board saying the lease is
 * somebody else's now and a tick that kept asking would be a session taking a stale lease back
 * every ten seconds. And the doors that END a lease's purpose — the plan claim's three planning
 * doors in `kanban-pm-tools-cards.ts` and `kanban-pm-tools-detail.ts` — release it and forget it
 * there, so a planned-but-unbuilt card is not pinned to a live owner for as long as the process
 * lives.
 *
 * The interval is `unref`d. A referenced timer is a process that cannot die: the spawned child
 * would keep living after its stdin closed, one orphan node process per Metis session.
 *
 * Consumers: `kanban-pm-mcp.ts` starts it; the tools that CLAIM or END a lease call the record /
 * forget / release helpers here.
 */

/**
 * Ten seconds — the cadence the board's own forty-second staleness window is measured in misses of.
 * Spelled without a separator because the number IS the dial a reader greps for.
 */
export const HEARTBEAT_INTERVAL_MS = 10000;

/** The verdict every lease verb answers with. */
type LeaseVerdict = { granted: boolean };

const buildLeaseCards = new Set<string>();
const planLeaseCards = new Set<string>();

/** The card whose BUILD lease this process now holds — the tool that claimed it calls this. */
export function recordBuildLease(cardId: string): void {
  buildLeaseCards.add(cardId);
}

/** Stop re-stamping a build lease this process no longer holds. */
export function forgetBuildLease(cardId: string): void {
  buildLeaseCards.delete(cardId);
}

/**
 * The card whose PLAN lease this process now holds.
 *
 * The in-memory set is an OPTIMISATION and nothing more: the owner is derivable, so a process that
 * lost this list can still re-read `list_active_builds` and re-stamp what is its own.
 */
export function recordPlanLease(cardId: string): void {
  planLeaseCards.add(cardId);
}

/** Stop re-stamping a plan lease this process no longer holds. */
export function forgetPlanLease(cardId: string): void {
  planLeaseCards.delete(cardId);
}

/**
 * Give the plan lease up at one of its lifecycle doors, then stop re-stamping it.
 *
 * The three doors are attaching the plan, posting the questions and filing an issue — those three
 * are where planning ENDS, and a claim that outlived its planning is a card pinned to an owner who
 * has walked away. A failed release is announced on stderr and never retried: the set is forgotten
 * either way, so the lease ages out by the board's own staleness window instead of being renewed
 * forever.
 */
export async function releasePlanLease(client: KanbanPmClient, cardId: string): Promise<void> {
  try {
    await client.post(`/cards/${cardId}/plan-lease/release`, { owner: client.owner });
  } catch (error) {
    // A line on stderr, never a throw: the caller is about to answer with the card the write
    // produced, and a lease that outlives its planning is the board's staleness window's business
    // rather than the tool's. It is still worth saying, because the lease stays held for up to
    // forty seconds after this call and nothing else in the process will mention it.
    process.stderr.write(
      `[kanban-pm] plan lease release failed for ${cardId}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`
    );
  }
  forgetPlanLease(cardId);
}

/** Starts the heartbeat and answers with the function that stops it. */
export function startKanbanPmHeartbeat(client: KanbanPmClient): () => void {
  let refreshing = false;
  let reportedFailure = false;

  const tick = async (): Promise<void> => {
    // A refresh slower than the interval must not stack: one in flight at a time, same as the
    // board's own compare-and-set assumes.
    if (refreshing) return;
    refreshing = true;

    try {
      // Copied first: a refused verdict forgets the card mid-iteration, and a Set being mutated
      // under its own iterator skips the card behind it.
      for (const cardId of [...buildLeaseCards]) {
        const verdict = await stamp(client, `/cards/${cardId}/build-lease/refresh`);
        if (!verdict.granted) forgetBuildLease(cardId);
      }
      for (const cardId of [...planLeaseCards]) {
        const verdict = await stamp(client, `/cards/${cardId}/plan-lease/claim`);
        if (!verdict.granted) forgetPlanLease(cardId);
      }
      if (reportedFailure) {
        reportedFailure = false;
        process.stderr.write('[kanban-pm] lease heartbeat recovered.\n');
      }
    } catch (error) {
      // Every error is swallowed: a heartbeat that threw would take the tools down with it, and
      // the board's own staleness window is the authority on whether the lease survived. One line
      // per transition, never one per tick, so a board that is down cannot flood `child.log`.
      if (!reportedFailure) {
        reportedFailure = true;
        process.stderr.write(
          `[kanban-pm] lease heartbeat failing: ${error instanceof Error ? error.message : String(error)}\n`
        );
      }
    } finally {
      refreshing = false;
    }
  };

  const timer = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}

/**
 * One re-stamp, answering the board's verdict.
 *
 * There is no plan-lease REFRESH verb on this board — the plan lease has claim and release, and
 * `claim` IS its re-stamp, exactly as the build lease's claim is: `kanbanLeasesService.claimPlanLease`
 * takes the lease "free, stale, or already theirs", so an owner re-claiming its own lease re-stamps
 * it and a foreign one is refused rather than stolen. The refusal is the signal, not an error.
 */
async function stamp(client: KanbanPmClient, path: string): Promise<LeaseVerdict> {
  return client.post<LeaseVerdict>(path, { owner: client.owner });
}
