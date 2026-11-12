import { runDispatcherCommand, type DispatcherCommandResult } from './dispatcher-command.js';

/**
 * The board counter, and the gate the store watch asks before it pokes the dispatcher's lanes for a write to the
 * store's database.
 *
 * WHY. A write to `dispatcher.db` used to poke both lanes, and a poke costs a whole re-read of the board:
 * `status --json` (about 3 s of CPU and 10 MB) and the roadmap's reads (about 1.2 s). Most writes are case runs
 * (on 2026-11-11 the store took 7,217 `case_runs` rows and 452 rows in every other table together), and no board
 * screen's picture moves for one. The dispatcher keeps one number for the tables the board is drawn from,
 * `meta.board_version`: SQLite triggers move it on every write to them and on none to `intents`, `case_runs` or
 * `case_triage` (`hooks/dispatcher/store_board.py`), and `dispatcher board-version` prints it. This gate runs that
 * verb first and lets a poke through only when the number moved since the last poke it let through.
 *
 * UNKNOWN COUNTS AS MOVED. Every case where the gate cannot tell pokes, exactly as the watch did before it existed:
 * the first check after the gate is made, a verb that fails, times out or prints anything but one whole number, and
 * a number that went backwards (a store rebuilt from a copy). The gate may be too eager; it is never blind.
 *
 * WHEN IT ASKS. The first write after a quiet spell is asked about once its commit's events have gathered
 * (`GATHER_MS`). While writes keep coming, checks start at least `minGapMs` after the last one ended, however many
 * events arrive, so a sweep of case runs costs about two cheap verbs a second and not a read of the board per run.
 * A write that lands DURING a check is not lost: the check may have read the counter before that commit, so one
 * more check follows. Writes that arrive while a check is only waiting its turn are one check with them: it reads
 * the counter after all of them.
 *
 * The gate decides nothing about which lanes to poke or when: `onMoved` is the watch's own poke, which waits out
 * the watch's settle window like any other and so joins a poke another source already has waiting (a daemon
 * settling a walk writes the store and the chain record in one breath: one read, not two). The gate reads no file and
 * opens no socket; the verb is the only way it learns anything, which keeps the chat server out of the dispatcher's
 * store (`dispatcher-command.ts`).
 */

/** The dispatcher verb that prints the board counter (`hooks/dispatcher/cmd/board_version.py`). */
const BOARD_VERSION_VERB = 'board-version';

/**
 * How long one `board-version` may take. The verb is the dispatcher's own start-up and one row read, about 0.15 s;
 * this is a bound on a wedged one, short enough that a check which never answers delays the pokes it gates by
 * seconds and not by the lanes' backstop.
 */
const BOARD_VERSION_TIMEOUT_MS = 5000;

/**
 * How long the first write after a quiet spell waits before the check. A commit announces itself as a few events within
 * milliseconds of each other (the WAL, and the database at a checkpoint); this is long enough to take those as one write,
 * and short enough that the check — which the watch's own settle window then follows — adds little to a press's latency.
 */
const GATHER_MS = 50;

/** The verb's whole answer: one decimal count. Anything else is no answer, never a guess at a number. */
const COUNT_PATTERN = /^\d+$/;

/** How much of a failed verb's own words a log line carries. */
const WHY_CHARS = 120;

/**
 * What one run of the verb came to: the counter, or why there is none.
 * Consumed by this file's gate and by the store watch's composition in `server/index.ts`.
 */
export type BoardReading = { ok: true; version: number } | { ok: false; why: string };

/** The verb's own first words, trimmed to one short line for a log. */
function firstWords(text: string): string {
  return text.trim().split('\n')[0]?.slice(0, WHY_CHARS) ?? '';
}

/** What the verb's result means: the counter when it printed one whole number and exited 0, else the reason it did not. */
function readingOf(result: DispatcherCommandResult): BoardReading {
  if (result.reason === 'timeout') {
    return { ok: false, why: `dispatcher ${BOARD_VERSION_VERB} was stopped before it answered` };
  }
  if (result.reason === 'spawn-failed') {
    return { ok: false, why: `dispatcher ${BOARD_VERSION_VERB} could not be started` };
  }
  if (!result.ok) {
    const said = firstWords(result.stderr) || firstWords(result.stdout);
    return { ok: false, why: `dispatcher ${BOARD_VERSION_VERB} exited ${result.exit}${said ? `: ${said}` : ''}` };
  }
  const printed = result.stdout.trim();
  const version = COUNT_PATTERN.test(printed) ? Number(printed) : Number.NaN;
  if (!Number.isSafeInteger(version)) {
    return { ok: false, why: `dispatcher ${BOARD_VERSION_VERB} printed ${JSON.stringify(firstWords(printed))}, not a count` };
  }
  return { ok: true, version };
}

/**
 * The reader the gate asks: one `dispatcher board-version` per call, never throwing. `commands` is the lane's
 * composition (the binary and the child environment); the timeout is this reading's own.
 * Consumed by `server/index.ts`, which hands it to the store watch.
 */
export function createBoardVersionReader(commands: {
  bin: string;
  env: NodeJS.ProcessEnv;
}): () => Promise<BoardReading> {
  const dependencies = { ...commands, timeoutMs: BOARD_VERSION_TIMEOUT_MS };
  return async () => readingOf(await runDispatcherCommand([BOARD_VERSION_VERB], dependencies));
}

type BoardGateDependencies = {
  /** One reading of the counter; a rejection is read as no answer. */
  read: () => Promise<BoardReading>;
  /** Called when the counter moved since the last time the gate called it, or could not be read. */
  onMoved: () => void;
  /** The least time from the end of one check to the start of the next: a stream of writes is checked about twice a second and no faster. */
  minGapMs: number;
  /** Said once per distinct sentence, for the life of the gate. */
  logError: (message: string) => void;
};

/**
 * What the store watch holds of a gate: it is told of each write to the store's database and spent when the watch stops.
 * Consumed by `dispatcher-store-watch.service.ts`.
 */
export type BoardGate = {
  /** A write to the store's database was seen: the board may have moved. */
  noteStoreWrite(): void;
  /** Drops a check not yet started and the answer of one in flight; the gate is spent. */
  stop(): void;
};

/**
 * One gate for one start of the store watch: it begins knowing nothing, so its first check always lets a poke through.
 * Consumed by `dispatcher-store-watch.service.ts`, which feeds it the store's file events.
 */
export function createBoardGate(dependencies: BoardGateDependencies): BoardGate {
  const { read, onMoved, minGapMs, logError } = dependencies;

  /** The counter as of the last poke let through; `null` is unknown, which reads as moved. */
  let lastPoked: number | null = null;
  let waiting: NodeJS.Timeout | null = null;
  let checking = false;
  /** When the last check ended, for the gap the next one keeps from it; 0 before the first. */
  let lastCheckEndedAt = 0;
  /** A write landed while a check was out: that check may have read the counter before it. */
  let writtenDuringCheck = false;
  let stopped = false;
  const said = new Set<string>();

  const sayOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    logError(message);
  };

  const schedule = (): void => {
    if (waiting !== null) return;
    const wait = Math.max(GATHER_MS, lastCheckEndedAt + minGapMs - Date.now());
    waiting = setTimeout(() => {
      waiting = null;
      void check();
    }, wait);
    waiting.unref();
  };

  const readSafely = async (): Promise<BoardReading> => {
    try {
      return await read();
    } catch (error) {
      return { ok: false, why: `board counter read threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  const check = async (): Promise<void> => {
    checking = true;
    writtenDuringCheck = false;
    const reading = await readSafely();
    checking = false;
    lastCheckEndedAt = Date.now();
    if (stopped) return;

    if (!reading.ok) {
      sayOnce(`board counter unreadable, so the lanes are poked: ${reading.why}`);
      lastPoked = null;
      onMoved();
    } else if (reading.version !== lastPoked) {
      // `!==` and not `>`: a counter that went backwards is a different store, and moved just the same.
      lastPoked = reading.version;
      onMoved();
    }
    if (writtenDuringCheck) schedule();
  };

  return {
    noteStoreWrite(): void {
      if (stopped) return;
      if (checking) {
        writtenDuringCheck = true;
        return;
      }
      schedule();
    },

    stop(): void {
      stopped = true;
      if (waiting !== null) clearTimeout(waiting);
      waiting = null;
    },
  };
}
