import fs from 'node:fs';
import path from 'node:path';

import { kanbanBoardsService, kanbanCardsService } from '@/modules/kanban/index.js';
import {
  clampKanbanConcurrency,
  KANBAN_LANE_LIMIT_MAX,
  KANBAN_STATUSES,
  type KanbanBoard,
} from '@/shared/kanban-types.js';
import type { KanbanMetisSession } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  LEASE_STALE_SECONDS,
  QUIESCE_MIN_AGE_MS,
  QUIESCE_QUIET_MS,
  reapProof,
  STALL_MS,
  type MetisLivenessView,
  type MetisReapProof,
} from './metis-liveness.js';
import {
  clearAttempts,
  rateLimitHold,
  recordAttempt,
  RELAUNCH_MAX_ATTEMPTS,
  shouldRelaunch,
} from './metis-relaunch.service.js';
import type { MetisRegistry } from './metis-registry.service.js';
import type { MetisSpawner } from './metis-spawn.service.js';

/**
 * The driver: one interval, and inside each tick exactly one order — reap first, then spawn. Never
 * the other way round, never a third thing.
 *
 * The order is the whole of the design: a session that has died or gone quiet is retired BEFORE
 * the spawn decision reads the live count, so the count the spawner acts on is this tick's
 * post-reap snapshot. Reverse the two and a board overshoots its concurrency dial every time a
 * session is dying — the tick would spawn a replacement for a slot the reaper is about to free,
 * and the board would run two Metises for one dial.
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
 * An in-process timer with nothing to poll for, so it can afford to be responsive: 15 s is the
 * longest wait a launch can take before a panel click feels answered.
 */
export const TICK_MS = 15_000;

/**
 * How long a launch may stay in flight before the driver says so.
 *
 * The in-flight guard is never released on a timer — releasing it would let a second child into a
 * board the first is still being launched for, the one thing the guard exists to stop. But a launch
 * that never settles (a hung key read) would otherwise skip its board on every tick for the life of
 * the process in complete silence, which is the failure the tick's own comment says must never
 * happen. So the guard holds, and after this long it says so — once, in the same words each time.
 */
export const LAUNCH_GUARD_WARN_MS = 60_000;

/**
 * How long a board must wait after a spawn before the driver will spawn for it again.
 *
 * The churn cooldown, and it is PER BOARD, never global: a global one lets
 * one busy board's spawn starve every other board on the install. The window is what keeps a board
 * whose work cannot actually be claimed — a stale lease, a card that leaves its lane mid-launch —
 * from being respawned on every tick forever.
 */
export const CHURN_COOLDOWN_MS = 60_000;

/**
 * The driver's own reading of one board: the four facts its spawn decision is made of, the last time
 * a spawn for that board landed, and the TWO GATE ANSWERS — which is what makes a quiet board
 * legible.
 *
 * `live` is counted NOW rather than remembered, so the answer a route gives is the answer the next
 * tick would act on. `concurrency` is the BOARD's dial — `kanban_boards.concurrency` — read off the
 * row the caller hands in and clamped by {@link dialOf}, so the number the panel shows live against
 * is the number the tick compares against rather than a second copy of it kept here. `rateLimitUntil`
 * and `relaunchAllowed` are the SAME two predicates the spawn path asks, in the same order, so the
 * route cannot explain a board differently from the way the tick treats it.
 */
export type MetisDriverReading = {
  autonomy: boolean;
  concurrency: number;
  claimable: number;
  live: number;
  lastSpawnAt: number | null;
  /** The epoch the API rate-limit hold lifts, or `null` for no hold at all — spawning is held. */
  rateLimitUntil: number | null;
  /** Whether the relaunch ledger permits a spawn for this board now — `false` is a backoff or the ceiling. */
  relaunchAllowed: boolean;
};

/** What the composition root hands the driver: the two services it drives, and nothing else. */
export type MetisDriverDependencies = {
  registry: MetisRegistry;
  spawner: MetisSpawner;
};

/**
 * One board's dial, read off its row and clamped — the ONE place this driver gets the number.
 *
 * Read at CALL time and never captured when the factory ran, which is the whole point: the dial
 * lives on the board's own row (`kanban_boards.concurrency`), the panel moves it with a PATCH, and a
 * driver that had baked it in at construction would need a server restart before the number it
 * reported became the number it obeyed.
 *
 * The clamp is applied again here even though the board's own boundary already applied it, because
 * this is the DECISION boundary: the comparison below is `live < dial`, so a `NaN` or a value
 * written by hand into the row would otherwise turn into maximum fan-out — a board spawning a child
 * on every tick. Zero survives the clamp and means the dial is off.
 */
const dialOf = (board: KanbanBoard): number => clampKanbanConcurrency(board.concurrency);

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
 * How many pages of the board's card ladder the lease scan will walk before it gives up.
 *
 * A board holding more cards than this is a board whose leases cannot be read completely this tick,
 * and the answer for it is then `unproven` — which exempts its sessions from reaping rather than
 * guessing. 25 pages is 5 000 cards: far past any board whose ladder was built by this module, and
 * still a bounded amount of work for a tick that runs every 15 s.
 */
export const MAX_LEASE_SCAN_PAGES = 25;

/**
 * One board's lease owners, or the honest admission that the board could not be read completely.
 *
 * `unproven` is not an error state and must never be treated as one: it is the answer a partial read
 * gives, and the caller's only safe response to it is to leave every session on that board alone.
 */
type BoardLeaseOwners = { kind: 'known'; owners: Set<string> } | { kind: 'unproven' };

/**
 * Every lease owner on one board right now, read across the board's WHOLE card ladder.
 *
 * Both lease kinds count, for one reason: a Metis
 * waiting on a long build and a Metis authoring a plan are both silent while working, and the
 * silence is indistinguishable from having stopped.
 *
 * THE SCAN IS PAGED TO EXHAUSTION, and that is the whole point of it. A single page is not a sample
 * of this board's leases, it is a WINDOW with an edge, and leases fall on the far side of it:
 * MEASURED 2026-09-17 on `b-90`, the only non-archived board — 435 live cards, whose first 200-row
 * page ends at `sort_order` 154 while the largest `sort_order` on the board is 367. A card claimed
 * by a fresh Metis is moved to `active` with a `sort_order` of `max + KANBAN_SORT_ORDER_GAP` (the
 * claim path sends no anchors), so it lands at the BOTTOM of the ladder — rank 435 of 435 — and the
 * owner's heartbeat-refreshed build lease never appears in a one-page read. `reapProof` then reads
 * `holdsFreshLease: false` for a Metis who is mid-build by design, silent by design (her
 * `plan-runner` is doing the talking), and retires her. A truncated read of an exemption is not a
 * smaller exemption; it is the opposite of one.
 *
 * The status set stays all five: narrowing it to the lanes that "usually" hold a lease is a second
 * way to miss one, and this read exists to not miss any. Read once per board per tick, and only for
 * a board whose session has already passed the age gate, so an idle install still pays nothing.
 */
function ownersHoldingLeases(boardId: string, now: number): BoardLeaseOwners {
  const owners = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_LEASE_SCAN_PAGES; page += 1) {
    const result = kanbanCardsService.listLaneCards(boardId, [...KANBAN_STATUSES], {
      limit: KANBAN_LANE_LIMIT_MAX,
      cursor,
    });
    for (const card of result.cards) {
      if (card.buildOwner !== null && card.leaseState === 'held') owners.add(card.buildOwner);
      if (card.planOwner !== null && planLeaseIsFresh(card.planLeaseAt, now)) {
        owners.add(card.planOwner);
      }
    }
    cursor = result.nextCursor;
    if (cursor === null) return { kind: 'known', owners };
  }

  // The ladder ran longer than the scan. Whatever owners were collected prove only that they hold a
  // lease; the cards never read could hide any number of others, so the board is unproven.
  return { kind: 'unproven' };
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
 * What makes one ENDING distinct from another: the session, and the moment it ended.
 *
 * The `endedAt` is load-bearing rather than decorative. A session that ends and is RESUMED removes
 * its `result.json` (`metis-registry.service.ts`), and its second ending is a second completion —
 * keyed on the id alone, that second ending would be dropped as one already seen.
 */
function endingKey(session: KanbanMetisSession): string {
  return `${session.sessionId}@${session.endedAt ?? 0}`;
}

/** The two questions asked before a child goes on a board, answered together. */
type MetisGateAnswers = {
  /** The epoch the API's rate-limit hold lifts, or `null` when spawning is not held at all. */
  heldUntil: number | null;
  /** Whether the board's relaunch ledger permits a launch now — a backoff or the ceiling is `false`. */
  relaunchAllowed: boolean;
};

/**
 * The two gates, asked in ONE place: the account's rate-limit hold and the board's relaunch ledger.
 *
 * Both callers ask both questions — `spawnForBoard` before it puts a child on a board, and `reading`
 * to explain why a board is quiet — and a second copy of either predicate is a route that can
 * explain a board differently from the way the tick treats it. A `null` `heldUntil` IS the answer
 * "not held", so no caller compares an epoch against its own clock.
 */
function gateAnswers(boardId: string, now: number): MetisGateAnswers {
  const holdUntil = rateLimitHold(now);
  return {
    heldUntil: holdUntil !== null && holdUntil > now ? holdUntil : null,
    relaunchAllowed: shouldRelaunch(boardId, now),
  };
}

/**
 * Builds the driver over one registry and the spawner that owns the processes.
 *
 * The driver keeps NO session state of its own. Which sessions exist is the registry's answer, what
 * a board's autonomy is is the board's, how many sessions it may run is its row's too, and whether a
 * spawn is allowed is arithmetic over those plus the two cadence windows (`CHURN_COOLDOWN_MS`, the
 * in-flight guard), the relaunch ledger and the rate-limit signal. The only things remembered here
 * are the churn cooldown, the launch-in-flight guard — state that is about this process's own
 * cadence, which nothing else can hold — and the endings already acted on, so a completion forgives
 * a board's ledger row ONCE rather than on every tick it stays in the registry.
 */
export function createMetisDriver(dependencies: MetisDriverDependencies): MetisDriver {
  const { registry, spawner } = dependencies;

  /** When a spawn for a board last LANDED, per board. Absent means never. */
  const lastSpawn = new Map<string, number>();
  /**
   * Boards with a launch in flight, and when it went in flight. A launch that outlives a tick would
   * otherwise be launched a second time, because the session it is creating is not in the registry
   * until it is recorded.
   */
  const launching = new Map<string, number>();
  /**
   * Endings this process has acted on.
   *
   * The forgiveness of a board's relaunch ledger is triggered by the TRANSITION, never by the state:
   * a completed session stays in the registry for the rest of the process's life, and a pass that
   * forgave every board holding one would wipe the row on every tick — which is the same thing as
   * never having a ledger at all for exactly the boards that have run successfully before.
   *
   * SEEDED WITH WHAT IS ALREADY ON DISK, and that seeding is what keeps the ledger durable. The
   * registry RE-ADOPTS every session it finds (`metis-registry.service.ts`), so an empty set would
   * make the first tick after a restart forgive every board that has ever completed a session — a
   * restart reviving the poison board the on-disk count exists to retire, which is the failure the
   * ledger's own header names. An ending already recorded at boot is HISTORY: this process did not
   * watch it happen, and only an ending it watches can forgive.
   */
  const forgiven = new Set(
    registry
      .list()
      .filter((session) => session.state === 'completed')
      .map((session) => endingKey(session)),
  );
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
    leases: Map<string, BoardLeaseOwners>,
  ): MetisLivenessView => {
    let held = leases.get(session.boardId);
    if (held === undefined) {
      held = ownersHoldingLeases(session.boardId, now);
      leases.set(session.boardId, held);
      // Said once per board, and said at all because the alternative is a board whose sessions can
      // never be reaped for a reason nothing in the journal names.
      if (held.kind === 'unproven') {
        say(
          `board ${session.boardId} holds more cards than ${MAX_LEASE_SCAN_PAGES} lease-scan pages cover, so its sessions are not reaped on silence`,
        );
      }
    }
    return {
      startedAt: session.startedAt,
      logMtime: readLogMtime(session.sessionId),
      childAlive: childIsAlive(session.pid),
      // AN UNPROVEN SCAN READS AS "HOLDS A LEASE". A read that did not finish cannot prove an owner
      // holds nothing, and the only safe direction for a verdict whose consequence is a SIGTERM is
      // to leave the session running.
      holdsFreshLease: held.kind === 'unproven' ? true : held.owners.has(session.owner),
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
    const leases = new Map<string, BoardLeaseOwners>();
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

    // The other half of the same read, and it belongs to this half rather than to the spawn
    // decision: an ending is what the reaper is looking at. A board whose session reached a
    // COMPLETED ending has proven it can run a child to the end of its work, so the failures the
    // relaunch ledger was counting against it are forgotten — that is the ONE way back that needs
    // nobody, and without it the ceiling would outlive its own reason.
    for (const session of registry.list()) {
      if (session.state !== 'completed') continue;
      const key = endingKey(session);
      if (forgiven.has(key)) continue;
      forgiven.add(key);
      clearAttempts(session.boardId);
      console.log(
        `[KanbanMetis] driver cleared board ${session.boardId}'s relaunch attempts — ${session.sessionId} ended completed`,
      );
    }
  };

  /**
   * One board's spawn decision, in the order the dials are cheap.
   *
   * The in-flight guard, the live count against the board's own dial and the cooldown are all
   * arithmetic over memory — the dial is the row this board was read as, which `spawnOnce` read on
   * this tick and not at construction; only a board that could actually spawn pays for the claimable
   * query, and only the LAST question is "is there work". Archived and autonomy-off boards never
   * reach here at all.
   */
  const spawnForBoard = (board: KanbanBoard, now: number, live: KanbanMetisSession[]): void => {
    const inFlightSince = launching.get(board.id);
    if (inFlightSince !== undefined) {
      // The guard is held, never released on a timer: a second launch for a board already launching
      // is two children in one cwd. What it must not be is SILENT — a launch that never settles
      // would skip this board on every tick for the life of the process with nothing in the journal.
      if (now - inFlightSince >= LAUNCH_GUARD_WARN_MS) {
        say(
          `board ${board.id} has had a launch in flight for over ${Math.round(LAUNCH_GUARD_WARN_MS / 1000)}s and is skipped until it settles`,
        );
      }
      return;
    }
    // `>=`, so a dial of zero is a board that is never spawned for — and the count is `live`, this
    // tick's post-reap snapshot, so a session the reaper closed a moment ago has already freed its
    // slot rather than being counted against the board twice over.
    if (live.filter((session) => session.boardId === board.id).length >= dialOf(board)) return;
    const landed = lastSpawn.get(board.id);
    if (landed !== undefined && now - landed < CHURN_COOLDOWN_MS) return;
    // THE TWO GATES, asked together and ahead of the claimable read. The hold comes first and for a
    // reason of its own: a child launched into a live account cap dies on her first turn, which the
    // ledger would then count as this board failing to start — and the hold is a fact about the
    // ACCOUNT, not the board, so the sentence is said once for the install. The ledger's file read is
    // the more expensive question, asked second so only a board that could otherwise spawn pays.
    const gates = gateAnswers(board.id, now);
    if (gates.heldUntil !== null) {
      const holdUntil = gates.heldUntil;
      say(
        `spawning is held until ${new Date(holdUntil).toISOString()} — the API answered a rate limit`,
      );
      return;
    }
    if (!gates.relaunchAllowed) {
      say(
        `board ${board.id} has spent its ${RELAUNCH_MAX_ATTEMPTS} relaunch attempts and is not spawned for until one of its sessions ends completed`,
      );
      return;
    }
    // A board with autonomy on and nothing to claim gets no child: a session that wakes to find an
    // empty lane has burned a conversation to read nothing, and would do it again every tick.
    if (kanbanBoardsService.claimableCount(board.id) <= 0) return;

    launching.set(board.id, now);
    void spawner
      .launch({ boardId: board.id, launchedBy: 'driver' })
      .then((session) => {
        lastSpawn.set(board.id, Date.now());
        console.log(
          `[KanbanMetis] driver spawned ${session.sessionId} for board ${board.id}`,
        );
      })
      .catch((error) => {
        // A DIAL REFUSAL IS NOT A FAILURE. The spawner's own gate answers 409 when a board is at its
        // dial, and this is the one throw the driver can cause by being EARLY rather than wrong: the
        // board filled between this tick's live snapshot and this launch — an operator's click, or a
        // session the reaper had not closed yet — so nothing failed and the ledger must not charge
        // the board for it. Every other throw (a vanished board, an unset DeepSeek key, a CLI that is
        // not on PATH) is a real failure and is counted as one.
        if (error instanceof AppError && error.statusCode === 409) {
          say(`board ${board.id} was at its dial by the time this tick's launch went in — not counted as a failed launch`);
          return;
        }
        // Not recorded as a spawn: a launch that failed did not land, so the cooldown must not hold
        // the board back from the next tick's attempt.
        //
        // It IS recorded in the ledger, and that is the difference between the two: the cooldown
        // forgives in a minute, while a spawn that threw is the one thing the ledger counts. A board
        // whose every launch dies must stop being retried every fifteen seconds forever.
        recordAttempt(board.id, Date.now());
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

    reading: (board) => {
      // The two gates come from the ONE helper the spawn path asks (`gateAnswers`), so a route never
      // explains a quiet board by re-deriving why: a board held by a live cap and a board that has
      // spent its ledger both look like "nothing to claim" from anywhere else.
      const gates = gateAnswers(board.id, Date.now());
      return {
        autonomy: board.autonomy,
        concurrency: dialOf(board),
        claimable: kanbanBoardsService.claimableCount(board.id),
        live: liveFor(board.id),
        lastSpawnAt: lastSpawn.get(board.id) ?? null,
        rateLimitUntil: gates.heldUntil,
        relaunchAllowed: gates.relaunchAllowed,
      };
    },
  };
}
