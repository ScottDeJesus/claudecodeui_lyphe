import { KANBAN_LEASE_STALE_SECONDS } from '@/shared/kanban-types.js';

/**
 * The liveness dials and the pure predicates that read them: is this Metis safe to retire?
 *
 * Nothing here touches a process, a file or a database. The caller gathers the four facts —
 * the session's age, its `child.log`'s mtime, whether the child is still alive, and whether its
 * owner still holds a lease — and hands them in; the decision itself is arithmetic over those four.
 * That is what makes the rule reviewable in one sitting: a reap KILLS a process, so the thing that
 * decides it should be readable without a running server.
 *
 * The clock and the log's mtime arrive as NUMBERS, never as `Date.now()` or an `fs.stat` call made
 * here. A predicate that reached for either would be untestable by construction and would put the
 * only I/O in the module that is supposed to have none.
 *
 * The rule is arithmetic over those four facts, read against three dials: a minimum quiet age
 * before a session may be reaped at all, a quiet window past which it reads as having finished its
 * turn, and a longer silence past which it is wedged. The dials are what make a live process
 * readable, so they are named here rather than inlined at the comparison.
 */

/**
 * Minimum age before a session is reap-eligible at all.
 *
 * A just-launched Metis is mid-orient — reading the
 * brief, calling `list_actionable`, claiming her first card — and a reaper that could reach her
 * during that window would retire healthy sessions in a loop. Five minutes is past any plausible
 * orient and is the window in which she must have stamped a lease.
 */
export const QUIESCE_MIN_AGE_MS = 300_000;

/**
 * How long `child.log` must have been still before the session reads as having finished its turn.
 *
 * The child writes its `--output-format stream-json` stream to that file continuously while a
 * turn is running, so silence there means the turn ended —
 * and three minutes is long enough that a Metis thinking between tool calls is not mistaken for one
 * who has stopped.
 */
export const QUIESCE_QUIET_MS = 180_000;

/**
 * How long a session may be BOTH silent and unleased before it is judged wedged.
 *
 * This is the longer, stronger window: a session quiet for this long is not pausing, it is
 * stuck — and the branch exists so a Metis whose turn has wedged cannot hold a concurrency slot
 * for the life of the server.
 */
export const STALL_MS = 2_700_000;

/**
 * How old a lease may be before it stops counting as evidence of work.
 *
 * The board's one home for this number is `KANBAN_LEASE_STALE_SECONDS` (`shared/kanban-types.ts:94`)
 * — the same dial the card summaries and the lease verbs read — and it is re-exported here because
 * the caller judges a PLAN lease with it: the card summary computes a build lease's freshness
 * server-side, but nothing computes a plan lease's, so the reap decision above does the same
 * arithmetic against the same number rather than inventing a second staleness rule.
 */
export { KANBAN_LEASE_STALE_SECONDS as LEASE_STALE_SECONDS };

/**
 * The four facts the predicates read about one session, gathered by the caller.
 *
 * A session's record alone cannot answer the question: `pid` says whether a child was recorded, not
 * whether it is still running, and no field on a board row says whether its owner holds a lease.
 * So the caller probes those, and the two facts it cannot prove are `null` rather than a guess.
 */
export type MetisLivenessView = {
  /** The session's own start, epoch ms — the age gate's input. */
  startedAt: number;
  /**
   * `child.log`'s mtime in epoch ms, or `null` when the log is absent or unreadable.
   *
   * `null` is NOT "quiet forever". A log nobody can read is a log that cannot prove anything, and
   * doubt exempts a session rather than condemning it — which is why the registry's own
   * `lastActivityAt` (which falls back to `startedAt`) is not used here.
   */
  logMtime: number | null;
  /** Is the child process alive? `null` when the caller cannot prove it either way. */
  childAlive: boolean | null;
  /**
   * Does this session's owner hold a FRESH build or plan lease on its board right now?
   *
   * The one fact that makes the difference between a finished turn and a build in progress: a Metis
   * whose plan-runner is doing the work writes nothing to her own log for as long as the build
   * takes, and is quiet BY DESIGN.
   */
  holdsFreshLease: boolean;
};

/** Which proof retired a session. Returned rather than a bare boolean so the tick can log it. */
export type MetisReapProof = 'child-gone' | 'quiescent' | 'stalled';

/**
 * The name of the proof that this session may be retired, or `null` when none fires. Never throws.
 *
 * Three gates, then the branches — and every "cannot prove it" answers `null`, which leaves the
 * session alone. That is the only safe direction for a verdict whose consequence is a SIGTERM:
 *
 * 1. TOO YOUNG. Under {@link QUIESCE_MIN_AGE_MS} nothing else is even looked at. This also covers
 *    the few milliseconds in which a spawn has recorded its session but not yet its pid.
 * 2. THE CHILD IS GONE — the one branch that needs no lease read and no quiet window. A recorded
 *    child that no longer exists is not building anything, and the registry has no exit handler
 *    that can notice it for a session the running server did not fork.
 * 3. THE OWNER HOLDS A FRESH LEASE — exempt, on BOTH of the remaining branches. This is the
 *    load-bearing gate: a Metis waiting on a long build is silent for as long as the build runs
 *    while her MCP heartbeat keeps her lease fresh, so a quiet-only rule would kill live work.
 * 4. THE LOG IS SILENT for {@link QUIESCE_QUIET_MS} (an ended turn) or {@link STALL_MS} (a wedged
 *    one). An unreadable log proves neither.
 */
export function reapProof(session: MetisLivenessView, now: number): MetisReapProof | null {
  if (now - session.startedAt < QUIESCE_MIN_AGE_MS) return null;

  // A dead child is retired whatever its lease says: nothing that has exited can be mid-build, and
  // a lease still standing against it is a row waiting for its staleness window rather than work.
  if (session.childAlive === false) return 'child-gone';

  if (session.holdsFreshLease) return null;
  if (session.logMtime === null) return null;

  const quietMs = now - session.logMtime;
  // The longer window is reported first: a session silent for 45 minutes has wedged, not paused, and
  // the log line the operator reads should say the stronger thing.
  if (quietMs >= STALL_MS) return 'stalled';
  if (quietMs >= QUIESCE_QUIET_MS) return 'quiescent';
  return null;
}

/** Has this session finished its turn and gone quiet, with nothing outstanding? */
export function quiescent(session: MetisLivenessView, now: number): boolean {
  const proof = reapProof(session, now);
  return proof === 'child-gone' || proof === 'quiescent';
}

/** Has this session gone silent for the stall window while its turn never returned? */
export function stalled(session: MetisLivenessView, now: number): boolean {
  return reapProof(session, now) === 'stalled';
}
