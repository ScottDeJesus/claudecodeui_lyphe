import os from 'node:os';
import path from 'node:path';

import { createBoardGate, type BoardGate, type BoardReading } from './dispatcher-board-gate.service.js';
import { watchDirectory, type DirectoryWatch } from './directory-watch.service.js';
import { pacerHomeDir } from './utils.js';

/**
 * What tells the dispatcher's two lanes (`dispatcher_state`, `roadmap_state`) that their picture may
 * have moved: the files each picture is read from, watched, so a lane reads when one of them is
 * WRITTEN instead of on a clock. One watch serves both lanes; each lane attaches its own `poke`
 * (`PolledLane.poke`) and is poked once per burst of changes, never once per file.
 *
 * THE INPUTS, one line each — the list that says the screen looks the same as it did under a poll.
 * Both documents are built by the dispatcher's own commands (`dispatcher status --json`,
 * `dispatcher roadmap show --json`), so what they read was measured with strace, not assumed:
 *
 *   status + roadmap   `dispatcher.db`, `dispatcher.db-wal`    the store: every commit writes the WAL. Asked of the
 *                                                                 board counter first (`dispatcher-board-gate.service.ts`):
 *                                                                 a case run, which no board picture reads, pokes nobody,
 *                                                                 so the roadmap's case standing follows its backstop
 *   status + roadmap   `daemon.lock`, `wake.sock`              the daemon coming up (the lock is rewritten
 *                                                                 with its pid) and going down (it unlinks
 *                                                                 its wake socket on the way out). The
 *                                                                 status document reads the lock always;
 *                                                                 the roadmap's only when a phase has
 *                                                                 stalled (`report_stall` names the cause).
 *                                                                 The socket is announced, never read
 *   status + roadmap   `dispatch-chains/<chain>/chain.json`,   a RUNNING phase's stage rows and tries come
 *                      `walker.pid`                              off its chain record, which the walker
 *                                                                 rewrites with no store write at all.
 *                                                                 Only the chains of phases now running are
 *                                                                 watched (`followChains`)
 *   status only        `epics.flag`                            the dial, in the state root: the dispatcher's own
 *                                                                 reader follows `$DISPATCHER_HOME` (`epic_dial.flag_path`),
 *                                                                 so a scratch home's dial is its own
 *   status only        `park_at_peak.flag`,                    the other switches the document reports, at
 *                      `weekly_stop.flag`,                      fixed `~/.claude/state` paths
 *                      `deepseek_features.flag`
 *   status only        `claude_account/{accounts,chosen}.json` which payer a plan runs under
 *   status only        `pacer/readings.sqlite`(`-wal`),        the pacer's picture. SLOW (`PACER_SETTLE_MS`):
 *                      `pacer/rates.json`                       every agent step appends a reading, so this
 *                                                                 input is busy whenever any agent works
 *   status only        `pacer/cpu-wait/<launch>.json`          an agent waiting for CPU appearing, its words moving or
 *                                                                 it starting (`cpu_wait`): the runner writes the marker with no
 *                                                                 store write at all, and the card's "Waiting for CPU" is read
 *                                                                 off it. Quiet: a marker moves only when its words do
 *   status only        a `dispatcher-*.timer` unit under       an armed hour appearing, firing or being
 *                      systemd's transient directory            stopped by hand
 *
 * WHAT NO FILE CAN SAY — the absence of a write — is not in this file's reach and is the lanes' own
 * backstop (`dispatcher.module.ts`, `roadmap.module.ts`): a walker, a soul or the daemon killed with
 * nothing left to write, the `report_stall` grace running out, the UTC hour the peak window ends at.
 *
 * WHICH EVENTS COUNT. A reader of a WAL database that is the last connection open creates and deletes
 * the `-wal` and `-shm` files around its own read (measured: two `rename` events per read on an
 * otherwise idle store), so a lane watching "anything" in the store directory would trigger itself
 * forever. A commit is a `change`; a reader's comings and goings are `rename`s. The SQLite files are
 * therefore taken on `change` alone — and the daemon lock too, whose only write is its claim.
 */

export type StoreWatchLane = 'status' | 'roadmap';

/** A poke for these lanes, once a burst has gathered for this long. */
type Poke = { kind: 'poke'; lanes: readonly StoreWatchLane[]; settleMs: number };

/** What one event is worth: a poke, or — a write to the store's database files — a question for the board counter first. */
type Interest = Poke | { kind: 'store-write' };

export type DispatcherStoreWatch = {
  /** Registers a lane's poke; the returned function removes it. */
  attach(lane: StoreWatchLane, poke: () => void): () => void;
  /**
   * The chain ids of the phases running now, as the last reading of the dispatcher's picture named
   * them. Their record directories are watched and every other chain's is let go. A chain newly watched
   * pokes both lanes once: the record may have been written between the reading that named it and the
   * watch being armed, and nothing else would say so.
   */
  followChains(chainIds: readonly string[]): void;
  start(): void;
  stop(): void;
};

export type DispatcherStoreWatchDependencies = {
  logError: (message: string) => void;
  /** One reading of the dispatcher's board counter (`createBoardVersionReader`): what a write to the store's database is asked before it pokes. */
  readBoardVersion: () => Promise<BoardReading>;
  env?: NodeJS.ProcessEnv;
};

/**
 * How long a burst gathers before the lanes are poked. A commit touches several files (the WAL, then
 * the database itself at a checkpoint) within a few milliseconds, and a walker replaces its chain
 * record in two clusters about 0.3 s apart (measured live: stage ending, then the next stage's launch);
 * this is long enough to take those as one change and short enough that the screen follows a press
 * within a moment. A second poke landing mid-read costs a whole extra read, which is what a longer
 * window avoids.
 */
const SETTLE_MS = 300;

/**
 * The pacer's readings are appended by every agent step on the host, so while any agent works they
 * arrive about once a second and each moves a percentage on the weekly window. A status read costs
 * seconds of CPU; following each reading would put the lane back on a continuous clock whenever an
 * agent is out. Ten seconds is the pace at which that figure can change anything a reader sees.
 */
const PACER_SETTLE_MS = 10_000;

const BOTH_LANES: readonly StoreWatchLane[] = ['status', 'roadmap'];
const STATUS_LANE: readonly StoreWatchLane[] = ['status'];

/** The database and its WAL: written by every commit, a regression case's run among them. */
const DATABASE_FILES: ReadonlySet<string> = new Set(['dispatcher.db', 'dispatcher.db-wal']);
/** The daemon's claim of its home, rewritten with its pid when it comes up. */
const DAEMON_LOCK_FILE = 'daemon.lock';
/** A write to the database files: the board gate pokes the lanes for it only if the board counter moved. */
const STORE_WRITE: Interest = { kind: 'store-write' };
/** The dial (Pause all): in the state root, which `$DISPATCHER_HOME` moves, as every record of the dispatcher is. */
const DIAL_FILE = 'epics.flag';
/** The other switches the document reports: read from fixed `~/.claude/state/*.flag` paths. */
const FLAG_FILES: ReadonlySet<string> = new Set(['park_at_peak.flag', 'weekly_stop.flag', 'deepseek_features.flag']);
const ACCOUNT_FILES: ReadonlySet<string> = new Set(['accounts.json', 'chosen.json']);
const PACER_FILES: ReadonlySet<string> = new Set(['readings.sqlite', 'readings.sqlite-wal', 'rates.json']);
const CHAIN_FILES: ReadonlySet<string> = new Set(['chain.json', 'walker.pid']);
/** The folder of the agents waiting for CPU, inside the pacer's home (`cpu_marker.WAIT_DIR`), and the one extension its markers carry. */
const CPU_WAIT_DIR = 'cpu-wait';
const CPU_WAIT_MARKER_EXT = '.json';

/** An explicit home when the dispatcher's own code takes one (`PLAN_RUNNER_*_HOME`), else a folder of the state root. */
function overrideOr(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const explicit = (env[name] ?? '').trim();
  return explicit ? path.resolve(explicit.replace(/^~(?=\/|$)/, os.homedir())) : fallback;
}

export function createDispatcherStoreWatch(dependencies: DispatcherStoreWatchDependencies): DispatcherStoreWatch {
  const { logError, readBoardVersion } = dependencies;
  const env = dependencies.env ?? process.env;

  // Where the dispatcher's own code looks (`store.home()`, `plan_runner.state.state_root`): the store
  // is `$DISPATCHER_HOME` or the live one, and every sibling record is a folder of that home's parent.
  const explicitHome = env.DISPATCHER_HOME;
  const storeDir = explicitHome && explicitHome.trim() ? explicitHome : path.join(os.homedir(), '.claude', 'state', 'dispatcher');
  const stateRoot = path.dirname(storeDir);
  const chainsRoot = path.join(stateRoot, 'dispatch-chains');
  const pacerDir = pacerHomeDir(stateRoot, env);
  const accountDir = overrideOr(env, 'PLAN_RUNNER_CLAUDE_ACCOUNT_HOME', path.join(stateRoot, 'claude_account'));
  // The dial is `epics.flag` in the state root (`epic_dial.flag_path`); the other flags are read from fixed `~/.claude/state/*.flag`
  // paths. A probe's per-flag override is not followed. On the live home both are one directory, and one watch serves them.
  const flagsDir = path.join(os.homedir(), '.claude', 'state');
  const dialWithFlags = path.resolve(stateRoot) === flagsDir;
  const transientDir = path.join(env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, 'systemd', 'transient');

  const pokes: Record<StoreWatchLane, Set<() => void>> = { status: new Set(), roadmap: new Set() };

  /** The one pending poke per lane: its due time and the timer that will fire it. */
  const pending = new Map<StoreWatchLane, { due: number; timer: NodeJS.Timeout }>();

  const fire = (lane: StoreWatchLane): void => {
    for (const poke of pokes[lane]) {
      try {
        poke();
      } catch (error) {
        logError(`a lane's poke threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  /**
   * One window per lane, shared by every source. Two sources moving together (a daemon settling a walk
   * writes the store and the chain record in one breath) are one poke, not two — a second poke landing
   * mid-read is a whole extra read. A slow source never delays a quick one: a window already open for
   * longer than a new event asks is shortened to it.
   */
  const mark = (interest: Poke): void => {
    const due = Date.now() + interest.settleMs;
    for (const lane of interest.lanes) {
      const held = pending.get(lane);
      if (held !== undefined && held.due <= due) continue;
      if (held !== undefined) clearTimeout(held.timer);
      const timer = setTimeout(() => {
        pending.delete(lane);
        fire(lane);
      }, interest.settleMs);
      timer.unref();
      pending.set(lane, { due, timer });
    }
  };

  const quickly = (lanes: readonly StoreWatchLane[]): Poke => ({ kind: 'poke', lanes, settleMs: SETTLE_MS });

  /**
   * The gate a write to the store's database files is asked of: made by `start` and spent by `stop`, so every start
   * begins knowing nothing and its first check pokes. Absent, a write to those files is no concern of anyone's.
   */
  let gate: BoardGate | null = null;

  /** Where an event goes: a poke is gathered by `mark`, a write to the database files is the gate's to ask about. */
  const gather = (interest: Interest): void => {
    if (interest.kind === 'poke') mark(interest);
    else gate?.noteStoreWrite();
  };

  /** A directory this watch keeps armed; its events are classified by `classify` and gathered by `gather`. */
  const open = (dir: string, classify: (kind: 'change' | 'rename', name: string) => Interest | null): DirectoryWatch =>
    watchDirectory({
      dir,
      classify,
      onInterest: gather,
      // A watch that was blind may have missed anything: both lanes read once more.
      onRearm: () => mark(quickly(BOTH_LANES)),
      logError: (message) => logError(`[dispatcher store watch] ${message}`),
    });

  let sources: DirectoryWatch[] = [];
  const chains = new Map<string, DirectoryWatch>();

  return {
    attach(lane, poke): () => void {
      pokes[lane].add(poke);
      return () => pokes[lane].delete(poke);
    },

    followChains(chainIds): void {
      if (sources.length === 0) return; // not started, or stopped: a watch armed now would outlive the shutdown
      const wanted = new Set(chainIds.filter((id) => id.length > 0 && !id.includes('/') && id !== '..'));
      for (const [id, watch] of chains) {
        if (wanted.has(id)) continue;
        watch.close();
        chains.delete(id);
      }
      let armedNew = false;
      for (const id of wanted) {
        if (chains.has(id)) continue;
        chains.set(
          id,
          open(path.join(chainsRoot, id), (_kind, name) => (CHAIN_FILES.has(name) ? quickly(BOTH_LANES) : null)),
        );
        armedNew = true;
      }
      if (armedNew) mark(quickly(BOTH_LANES));
    },

    start(): void {
      if (sources.length > 0) return;
      gate = createBoardGate({
        read: readBoardVersion,
        onMoved: () => mark(quickly(BOTH_LANES)),
        minGapMs: SETTLE_MS,
        logError: (message) => logError(`[dispatcher store watch] ${message}`),
      });
      sources = [
        // The store directory. SQLite files on `change` only (see the head of this file); the daemon's
        // socket on any event, since its creation is the daemon starting and its unlinking is the daemon going.
        // The database and its WAL are not poked for directly: the board gate asks the counter first.
        open(storeDir, (kind, name) => {
          if (name === 'wake.sock') return quickly(BOTH_LANES);
          if (kind !== 'change') return null;
          if (name === DAEMON_LOCK_FILE) return quickly(BOTH_LANES);
          return DATABASE_FILES.has(name) ? STORE_WRITE : null;
        }),
        open(flagsDir, (_kind, name) =>
          FLAG_FILES.has(name) || (dialWithFlags && name === DIAL_FILE) ? quickly(STATUS_LANE) : null,
        ),
        // A scratch home's dial sits beside its store, not among the live flags.
        ...(dialWithFlags
          ? []
          : [open(stateRoot, (_kind, name) => (name === DIAL_FILE ? quickly(STATUS_LANE) : null))]),
        open(accountDir, (_kind, name) => (ACCOUNT_FILES.has(name) ? quickly(STATUS_LANE) : null)),
        open(pacerDir, (kind, name) => {
          if (!PACER_FILES.has(name)) return null;
          // The readings database is a WAL one and its readers' open/close shows up as renames and as
          // `-shm` churn (see the head); only a write to the database or its WAL is a reading.
          if (name !== 'rates.json' && kind !== 'change') return null;
          return { kind: 'poke', lanes: STATUS_LANE, settleMs: PACER_SETTLE_MS };
        }),
        // The agents waiting for CPU: a marker appearing is an agent held back, its removal that agent starting. Only the
        // `.json` markers count: the fifo beside each is the Override's door and the atomic writes leave `.tmp` scratch names.
        open(path.join(pacerDir, CPU_WAIT_DIR), (_kind, name) =>
          name.endsWith(CPU_WAIT_MARKER_EXT) ? quickly(STATUS_LANE) : null,
        ),
        open(transientDir, (_kind, name) =>
          name.startsWith('dispatcher-') && name.endsWith('.timer') ? quickly(STATUS_LANE) : null,
        ),
      ];
    },

    stop(): void {
      gate?.stop();
      gate = null;
      for (const watch of sources) watch.close();
      for (const watch of chains.values()) watch.close();
      for (const { timer } of pending.values()) clearTimeout(timer);
      sources = [];
      chains.clear();
      pending.clear();
    },
  };
}
