import fs from 'node:fs';
import path from 'node:path';

import { kanbanBoardsService, kanbanCardsService } from '@/modules/kanban/index.js';
import {
  KANBAN_LANE_LIMIT_MAX,
  KANBAN_STATUSES,
  type KanbanBoard,
} from '@/shared/kanban-types.js';
import type { KanbanMetisSession } from '@/shared/types.js';

import {
  LEASE_STALE_SECONDS,
  QUIESCE_MIN_AGE_MS,
  QUIESCE_QUIET_MS,
  reapProof,
  STALL_MS,
  type MetisLivenessView,
  type MetisReapProof,
} from './metis-liveness.js';
import type { MetisRegistry } from './metis-registry.service.js';
import type { MetisSpawner } from './metis-spawn.service.js';

/**
 * The driver: one interval, and inside each tick exactly one order — reap first, then spawn. Never
 * the other way round, never a third thing.
 *
 * `pm_capacity.py:640-667`'s `tick_once`, ported in-process. The order is the whole of the design:
 * a session that has died or gone quiet is retired BEFORE the spawn decision reads the live count,
 * so the count the spawner acts on is this tick's post-reap snapshot. Reverse the two and a board
 * overshoots its concurrency dial every time a session is dying — the tick would spawn a
 * replacement for a slot the reaper is about to free, and the board would run two Metises for one
 * dial.
 *
 * Every decision this loop makes is READABLE. `reading()` is the same arithmetic the tick uses,
 * asked of one board, so the `GET /api/kanban-metis/boards/:boardId/driver` route can answer why a
 * board is or is not being worked on: a daemon whose reasoning can only be inferred from behaviour
 * is a daemon nobody can debug at 3 a.m.
 *
 * Consumers: `kanban-metis.module.ts`, which builds it beside the spawner it drives and starts it
 * once the registry has re-adopted.
 */

/**
 * How often the tick runs.
 *
 * `pm_capacity.py:111`'s `TICK_SECS` is 45 s, slept in 5 s slices because that watcher is a shell
 * loop that must notice an operator's nudge. This one is an in-process timer with nothing to poll
 * for, so it can afford to be three times as responsive — 15 s is the longest wait a launch can
 * take before a panel click feels answered.
 */
export const TICK_MS = 15_000;

/**
 * How many Metis sessions one board may run at once.
 *
 * `pm_capacity.py`'s dial, whose `DESCENT_PM_CAPACITY` default is 1 and is clamped `[0, 4]`. One is
 * the honest default here: two children of one board share a cwd and claim cards against each
 * other, so a board runs in parallel only when its owner has said so — and the dial is a parameter
 * of this factory for exactly that reason.
 */
export const DEFAULT_CONCURRENCY = 1;

/**
 * How long a board must wait after a spawn before the driver will spawn for it again.
 *
 * `pm_capacity.py:479-488`'s churn cooldown, and it is PER BOARD, never global: a global one lets
 * one busy board's spawn starve every other board on the install. The window is what keeps a board
 * whose work cannot actually be claimed — a stale lease, a card that leaves its lane mid-launch —
 * from being respawned on every tick forever.
 */
export const CHURN_COOLDOWN_MS = 60_000;

/**
 * The driver's own reading of one board: the four facts its spawn decision is made of, plus the
 * last time a spawn for that board landed.
 *
 * `live` is counted NOW rather than remembered, so the answer a route gives is the answer the next
 * tick would act on. `concurrency` is this driver's dial rather than the board's, because the board
 * has no such column and a dial reported from somewhere other than where it is read is a dial that
 * drifts.
 */
export type MetisDriverReading = {
  autonomy: boolean;
  concurrency: number;
  claimable: number;
  live: number;
  lastSpawnAt: number | null;
};

/** What the composition root hands the driver: the two services it drives, and its dial. */
export type MetisDriverDependencies = {
  registry: MetisRegistry;
  spawner: MetisSpawner;
  /** Defaults to {@link DEFAULT_CONCURRENCY}. A probe hands a value so a test board cannot fan out. */
  concurrency?: number;
};

export type MetisDriver = {
  /** Starts the interval. Idempotent: a second call is a no-op rather than a second timer. */
  start(): void;
  /** Stops the interval. Safe to call on a driver that was never started. */
  stop(): void;
  /** Runs one pass by hand — the same body the interval calls, so a probe need not wait 15 s. */
  tick(): void;
  /** The reading the spawn decision for one board is made of. */
  reading(board: KanbanBoard): MetisDriverReading;
};

/**
 * Is the process this session recorded still alive?
 *
 * `null` means CANNOT PROVE, and the caller must read it as "leave her alone". A dead child is
 * `false` only on `ESRCH`; `EPERM` is a live number this process may not signal, and that is doubt,
 * not death. The direction matters: a recycled pid reads as ALIVE here and so suppresses a reap,
 * where the opposite reading would let the reaper aim a SIGTERM at whatever now holds that number.
 */
function childIsAlive(pid: number | null): boolean | null {
  // A `running` session with no pid is one the spawner never got a pid for, which its own `stop`
  // reads the same way: the child is gone and nothing wrote its ending.
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null;
  }
}

/**
 * Is a PLAN lease still young enough to count as work?
 *
 * The card summary computes a build lease's freshness server-side (`shared/kanban-types.ts:83-94`);
 * nothing computes a plan lease's, so the driver applies the same rule to the same number rather
 * than inventing a second staleness window. An unreadable timestamp is treated as FRESH, because a
 * value that cannot be parsed is doubt and doubt exempts a session from being killed.
 */
function planLeaseIsFresh(leaseAt: string | null, now: number): boolean {
  if (leaseAt === null) return false;
  const at = Date.parse(leaseAt);
  if (Number.isNaN(at)) return true;
  return now - at < LEASE_STALE_SECONDS * 1000;
}

/**
 * Every lease owner on one board right now, read in ONE pass over its cards.
 *
 * Both lease kinds count, for the same reason `pm_capacity_stall.py:258-318` re-reads both: a Metis
 * waiting on a long build and a Metis authoring a plan are both silent while working, and the
 * silence is indistinguishable from having stopped. Read once per board per tick — and only for a
 * board whose session has already passed the age gate — so an idle install pays nothing for it.
 */
function ownersHoldingLeases(boardId: string, now: number): Set<string> {
  const owners = new Set<string>();
  const page = kanbanCardsService.listLaneCards(boardId, [...KANBAN_STATUSES], {
    limit: KANBAN_LANE_LIMIT_MAX,
  });
  for (const card of page.cards) {
    if (card.buildOwner !== null && card.leaseState === 'held') owners.add(card.buildOwner);
    if (card.planOwner !== null && planLeaseIsFresh(card.planLeaseAt, now)) owners.add(card.planOwner);
  }
  return owners;
}

/**
 * The two silent windows as the seconds a log line says, DERIVED from their dials so that a line
 * read months later cannot disagree with the rule that produced it.
 */
const QUIESCE_QUIET_SECONDS = Math.round(QUIESCE_QUIET_MS / 1000);
const STALL_SECONDS = Math.round(STALL_MS / 1000);

/** One sentence for the journal, naming the proof rather than only that something was reaped. */
function describeProof(proof: MetisReapProof): string {
  if (proof === 'child-gone') return 'her child is gone and nothing wrote the ending';
  if (proof === 'stalled') return `no log activity for ${STALL_SECONDS}s and no lease`;
  return `quiet for ${QUIESCE_QUIET_SECONDS}s and no lease`;
}

/** One error's message, whatever was thrown. A journal line is never `[object Object]`. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the driver over one registry and the spawner that owns the processes.
 *
 * The driver keeps NO session state of its own. Which sessions exist is the registry's answer, what
 * a board's autonomy is is the board's, and whether a spawn is allowed is arithmetic over those two
 * plus its three dials. The only thing remembered here is the churn cooldown and the two in-flight
 * guards — state that is about this process's own cadence, which nothing else can hold.
 */
export function createMetisDriver(dependencies: MetisDriverDependencies): MetisDriver {
  const { registry, spawner } = dependencies;
  const concurrency = dependencies.concurrency ?? DEFAULT_CONCURRENCY;

  /** When a spawn for a board last LANDED, per board. Absent means never. */
  const lastSpawn = new Map<string, number>();
  /**
   * Boards with a launch in flight. A launch that outlives a tick would otherwise be launched a
   * second time, because the session it is creating is not in the registry until it is recorded.
   */
  const launching = new Set<string>();
  /** Faults already said aloud: a tick repeats every 15 s and a repeating fault is one sentence. */
  const said = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const say = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(`[KanbanMetis] driver: ${message}`);
  };

  /** Every session that is running right now, as one snapshot the tick reuses. */
  const liveSessions = (): KanbanMetisSession[] =>
    registry.list().filter((session) => session.state === 'running');

  const liveFor = (boardId: string): number =>
    liveSessions().filter((session) => session.boardId === boardId).length;

  /**
   * When the child last wrote anything, or `null` when the log cannot be read.
   *
   * The registry's own `lastActivityAt` is NOT used here, deliberately. It falls back to the
   * session's start when the log is absent, which would make a session whose log has gone away read
   * as quiet since it began — and quiet is the proof that retires a session. An unreadable log is a
   * log that proves nothing, and that is what `null` says.
   */
  const readLogMtime = (sessionId: string): number | null => {
    try {
      return fs.statSync(path.join(registry.sessionDir(sessionId), 'child.log')).mtimeMs;
    } catch {
      return null;
    }
  };

  /** The four facts the predicates read, gathered for one session. */
  const viewOf = (
    session: KanbanMetisSession,
    now: number,
    leases: Map<string, Set<string>>,
  ): MetisLivenessView => {
    let owners = leases.get(session.boardId);
    if (owners === undefined) {
      owners = ownersHoldingLeases(session.boardId, now);
      leases.set(session.boardId, owners);
    }
    return {
      startedAt: session.startedAt,
      logMtime: readLogMtime(session.sessionId),
      childAlive: childIsAlive(session.pid),
      holdsFreshLease: owners.has(session.owner),
    };
  };

  /**
   * The tick's FIRST half: read the live set, mark the children that have exited, and retire every
   * session the liveness rule has proven safe to retire.
   *
   * The age gate is applied here as well as inside the predicates, and that is not redundancy: it
   * is what keeps a young session from costing a `child.log` stat and a lease query that could not
   * have changed the answer. The verdict itself is made once, in `reapProof`.
   */
  const reapOnce = (now: number): void => {
    const leases = new Map<string, Set<string>>();
    for (const session of liveSessions()) {
      try {
        if (now - session.startedAt < QUIESCE_MIN_AGE_MS) continue;
        const proof = reapProof(viewOf(session, now, leases), now);
        if (proof === null) continue;
        // Through the spawner, never by signalling here: it is the one thing in the module that
        // knows how to end a session, and it is what writes the ending honestly.
        spawner.stop(session.sessionId);
        console.log(
          `[KanbanMetis] driver reaped ${session.sessionId} (board ${session.boardId}) — ${describeProof(proof)}`,
        );
      } catch (error) {
        say(`reaping ${session.sessionId} failed: ${describe(error)}`);
      }
    }
  };

  /**
   * One board's spawn decision, in the order the dials are cheap.
   *
   * The in-flight guard, the live count and the cooldown are all arithmetic over memory; only a
   * board that could actually spawn pays for the claimable query, and only the LAST question is
   * "is there work". Archived and autonomy-off boards never reach here at all.
   */
  const spawnForBoard = (board: KanbanBoard, now: number, live: KanbanMetisSession[]): void => {
    if (launching.has(board.id)) return;
    if (live.filter((session) => session.boardId === board.id).length >= concurrency) return;
    const landed = lastSpawn.get(board.id);
    if (landed !== undefined && now - landed < CHURN_COOLDOWN_MS) return;
    // A board with autonomy on and nothing to claim gets no child: a session that wakes to find an
    // empty lane has burned a conversation to read nothing, and would do it again every tick.
    if (kanbanBoardsService.claimableCount(board.id) <= 0) return;

    launching.add(board.id);
    void spawner
      .launch({ boardId: board.id, launchedBy: 'driver' })
      .then((session) => {
        lastSpawn.set(board.id, Date.now());
        console.log(
          `[KanbanMetis] driver spawned ${session.sessionId} for board ${board.id}`,
        );
      })
      .catch((error) => {
        // Not recorded as a spawn: a launch that failed did not land, so the cooldown must not hold
        // the board back from the next tick's attempt.
        say(`board ${board.id} launch failed: ${describe(error)}`);
      })
      .finally(() => {
        launching.delete(board.id);
      });
  };

  /** The tick's SECOND half: spawn for every board that autonomy and its dials say may run. */
  const spawnOnce = (now: number): void => {
    const { boards } = kanbanBoardsService.listBoards({});
    // ONE post-reap snapshot, taken after the reaper has closed everything it closed. A session
    // stopped a moment ago can still be `running` here if its exit has not landed, and that is the
    // safe direction: the dial then fills on a LATER tick rather than overshooting on this one.
    const live = liveSessions();
    for (const board of boards) {
      if (board.archived || !board.autonomy) continue;
      try {
        spawnForBoard(board, now, live);
      } catch (error) {
        // ONE BOARD'S FAULT IS ONE BOARD'S. A board whose query threw must not stop the boards
        // behind it in this tick, and must not take the interval down with it either.
        say(`board ${board.id} is not spawnable this tick: ${describe(error)}`);
      }
    }
  };

  /**
   * One pass, and the only place the two halves meet.
   *
   * Wrapped so that a fault the two halves did not catch themselves is said once and the interval
   * survives it. An unwrapped throw here would kill the timer (`setInterval` drops a callback that
   * throws) and autonomy would stop silently — which is the one failure an autonomous loop must not
   * have.
   */
  const tick = (): void => {
    const now = Date.now();
    try {
      reapOnce(now);
      spawnOnce(now);
    } catch (error) {
      say(`tick failed: ${describe(error)}`);
    }
  };

  return {
    tick,

    start: () => {
      if (timer !== null) return;
      timer = setInterval(tick, TICK_MS);
      // Unreferenced: a driver ticking forever is never a reason for the server to stay up, and a
      // process that will not exit is a process the operator has to kill.
      timer.unref();
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },

    reading: (board) => ({
      autonomy: board.autonomy,
      concurrency,
      claimable: kanbanBoardsService.claimableCount(board.id),
      live: liveFor(board.id),
      lastSpawnAt: lastSpawn.get(board.id) ?? null,
    }),
  };
}
