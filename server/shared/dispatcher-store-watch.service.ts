import os from 'node:os';
import path from 'node:path';

import { createBoardGate, type BoardGate, type BoardReading } from './dispatcher-board-gate.service.js';
import { watchDirectory, type DirectoryWatch } from './directory-watch.service.js';
import { dispatcherHome } from './dispatcher-command.js';

/**
 * What tells the dispatcher's two lanes (`dispatcher_state`, `roadmap_state`) that their picture may
 * have moved: the files each picture is read from, watched, so a lane reads when one of them is
 * WRITTEN instead of on a clock. One watch serves both lanes; each lane attaches its own `poke`
 * (`PolledLane.poke`) and is poked once per burst of changes, never once per file.
 *
 * THE STATUS LANE WATCHES ONE FILE. Its document is the dispatcher keeper's kept picture
 * (`dispatcher-kept.reader.ts`), rewritten whenever anything it is derived from moves — the store, a running
 * phase's chain record, the pacer's readings, the switches, an armed hour: every writer tells the keeper
 * (`hooks/dispatcher/keeper_tell.py`), and what no write announces (a grace running out, a window ending) is
 * the keeper's own one-shot `dispatcher-keep-*` unit. Every run writes `index.json` last, so its arrival is
 * the whole picture landed:
 *
 *   status + roadmap   `<home>/status/index.json`             the keeper's head, tmp-then-rename. The roadmap takes it
 *                                                                 too: a running phase's chain record is a keeper input,
 *                                                                 so a walk's progress lands here as one settled write
 *
 * THE OTHER LANES' INPUTS. Their documents are still built by commands (`dispatcher roadmap show --json`,
 * `rnd show --json`), so what they read was measured with strace, not assumed:
 *
 *   roadmap + rnd      `dispatcher.db`, `dispatcher.db-wal`    the store: every commit writes the WAL. Asked of the
 *                                                                 board counter first (`dispatcher-board-gate.service.ts`):
 *                                                                 a case run, which no board picture reads, pokes nobody,
 *                                                                 so the roadmap's case standing follows its backstop
 *   roadmap            `daemon.lock`, `wake.sock`              the daemon coming up (the lock is rewritten with its pid)
 *                                                                 and going down (it unlinks its wake socket on the way
 *                                                                 out); the roadmap reads the lock when a phase has stalled
 *   accounts           `claude_account/{accounts,chosen}.json` which payer is in use, told to every tab
 *
 * WHAT NO FILE CAN SAY — the absence of a write — is the roadmap lane's backstop (`roadmap.module.ts`).
 *
 * WHICH EVENTS COUNT. A reader of a WAL database that is the last connection open creates and deletes
 * the `-wal` and `-shm` files around its own read (measured: two `rename` events per read on an
 * otherwise idle store), so a lane watching "anything" in the store directory would trigger itself
 * forever. A commit is a `change`; a reader's comings and goings are `rename`s. The SQLite files are
 * therefore taken on `change` alone — and the daemon lock too, whose only write is its claim.
 */

export type StoreWatchLane = 'status' | 'roadmap' | 'rnd' | 'accounts';

/** A poke for these lanes, once a burst has gathered for this long. */
type Poke = { kind: 'poke'; lanes: readonly StoreWatchLane[]; settleMs: number };

/** What one event is worth: a poke, or — a write to the store's database files — a question for the board counter first. */
type Interest = Poke | { kind: 'store-write' };

export type DispatcherStoreWatch = {
  /** Registers a lane's poke; the returned function removes it. */
  attach(lane: StoreWatchLane, poke: () => void): () => void;
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
 * the database itself at a checkpoint) within a few milliseconds;
 * this is long enough to take those as one change and short enough that the screen follows a press
 * within a moment. A second poke landing mid-read costs a whole extra read, which is what a longer
 * window avoids.
 */
const SETTLE_MS = 300;

/**
 * The keeper's index lands: the status lane's one poke, and the roadmap's for a running phase's chain record. The keeper stats
 * every running chain's chain.json as an input (`keeper_files.input_paths`), so its run is that record's move, already settled.
 */
const KEPT_LANES: readonly StoreWatchLane[] = ['status', 'roadmap'];
/** The roadmap lane alone: the daemon's lock and socket, which its stall words read. */
const ROADMAP_LANE: readonly StoreWatchLane[] = ['roadmap'];
/**
 * Every lane whose document a command reads from the store: the roadmap and the R&D lane (`rnd show --json`). The R&D picture
 * reads no daemon lock, so only a store write the board gate lets through and a re-armed watch poke it.
 */
const STORE_LANES: readonly StoreWatchLane[] = ['roadmap', 'rnd'];
/** Every lane a blind watch may have missed a write for. */
const REARM_LANES: readonly StoreWatchLane[] = ['status', 'roadmap', 'rnd'];
/** The door's account files: the accounts module tells every tab. */
const ACCOUNT_LANES: readonly StoreWatchLane[] = ['accounts'];

/** The keeper's folder under the home (`keeper_files.STATUS_DIR`) and the head it writes last (`keeper_files.INDEX`). */
const KEPT_DIR = 'status';
const KEPT_INDEX = 'index.json';

/** The database and its WAL: written by every commit, a regression case's run among them. */
const DATABASE_FILES: ReadonlySet<string> = new Set(['dispatcher.db', 'dispatcher.db-wal']);
/** The daemon's claim of its home, rewritten with its pid when it comes up. */
const DAEMON_LOCK_FILE = 'daemon.lock';
/** A write to the database files: the board gate pokes the lanes for it only if the board counter moved. */
const STORE_WRITE: Interest = { kind: 'store-write' };
const ACCOUNT_FILES: ReadonlySet<string> = new Set(['accounts.json', 'chosen.json']);

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
  const storeDir = dispatcherHome(env);
  const stateRoot = path.dirname(storeDir);
  const accountDir = overrideOr(env, 'PLAN_RUNNER_CLAUDE_ACCOUNT_HOME', path.join(stateRoot, 'claude_account'));

  const pokes: Record<StoreWatchLane, Set<() => void>> = {
    status: new Set(),
    roadmap: new Set(),
    rnd: new Set(),
    accounts: new Set(),
  };

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
      // A watch that was blind may have missed anything: every lane reads once more.
      onRearm: () => mark(quickly(REARM_LANES)),
      logError: (message) => logError(`[dispatcher store watch] ${message}`),
    });

  let sources: DirectoryWatch[] = [];

  return {
    attach(lane, poke): () => void {
      pokes[lane].add(poke);
      return () => pokes[lane].delete(poke);
    },

    start(): void {
      if (sources.length > 0) return;
      gate = createBoardGate({
        read: readBoardVersion,
        onMoved: () => mark(quickly(STORE_LANES)),
        minGapMs: SETTLE_MS,
        logError: (message) => logError(`[dispatcher store watch] ${message}`),
      });
      sources = [
        // The keeper's index: written last by every run, so its arrival is the whole picture landed. Taken on any event,
        // since it arrives as a rename of the keeper's tmp file; the plan files and tmp names beside it are passed by.
        open(path.join(storeDir, KEPT_DIR), (_kind, name) => (name === KEPT_INDEX ? quickly(KEPT_LANES) : null)),
        // The store directory. SQLite files on `change` only (see the head of this file); the daemon's
        // socket on any event, since its creation is the daemon starting and its unlinking is the daemon going.
        // The database and its WAL are not poked for directly: the board gate asks the counter first.
        open(storeDir, (kind, name) => {
          if (name === 'wake.sock') return quickly(ROADMAP_LANE);
          if (kind !== 'change') return null;
          if (name === DAEMON_LOCK_FILE) return quickly(ROADMAP_LANE);
          return DATABASE_FILES.has(name) ? STORE_WRITE : null;
        }),
        open(accountDir, (_kind, name) => (ACCOUNT_FILES.has(name) ? quickly(ACCOUNT_LANES) : null)),
      ];
    },

    stop(): void {
      gate?.stop();
      gate = null;
      for (const watch of sources) watch.close();
      for (const { timer } of pending.values()) clearTimeout(timer);
      sources = [];
      pending.clear();
    },
  };
}
