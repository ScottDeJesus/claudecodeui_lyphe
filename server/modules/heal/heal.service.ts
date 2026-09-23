import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { userFacingEnv } from '../../shared/child-env.js';

const execFileAsync = promisify(execFile);

/**
 * Relaying the heal reflex's own worker.
 *
 * This server keeps no view of the reflex and owns none of its state. It never touches the ledger's
 * file, never lists the reflex's queue directory and never writes a friction row: it runs the
 * worker's own command and carries back what the worker said. The reflex's Python package is the one
 * reader of each of those stores, and the worker's `--status` payload already CONTAINS the runner's
 * heal queue — read there, in Python, through its own module — so the queue's item shape exists once
 * in this house rather than once per language. That is the whole design: one reader per store, one
 * transport, and the transport is a process this service does not look inside of.
 *
 * Nothing here throws. A refusal is a RESULT — the operator needs the worker's own sentence, not a
 * 500 — and the shapes below are the plan-runner lane's (`runner-verb.service.ts`), so the two relay
 * lanes in this server answer the same way. The argv array is the security boundary: no shell parses
 * any of this, so a pattern or a reason carrying a space, a semicolon or a quote is one argument the
 * worker rejects rather than a second command.
 */

/**
 * How much the worker may say. `--status` is one JSON object of tallies and `--ignore-add` is one
 * line, so this is thousands of times the real output; it is stated rather than left to the default
 * so the number is visible beside the payload that has to reason about overflowing it.
 */
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024;

/** Wall-clock ceiling for the summary. The worker opens its ledger, asks the queue and prints. */
const STATUS_TIMEOUT_MS = 20_000;

/** Wall-clock ceiling for an ignore add. It inserts one row and sweeps the rows it matches. */
const IGNORE_TIMEOUT_MS = 20_000;

/** Wall-clock ceiling for one kind's rows: a bounded read off the ledger, newest row first. */
const KIND_TIMEOUT_MS = 20_000;

/**
 * Wall-clock ceiling for a cycle door. Both doors run the worker's own bounded wait for the ledger's
 * flock first (`LOCK_WAIT_S`, 45 s) and then answer, so the bound has to clear that wait with room to
 * index what the press arrives among; 90 s is `heal-reflex`'s own number for this door, kept here so
 * the server does not cut a worker that is behaving exactly as it promised.
 */
const CYCLE_TIMEOUT_MS = 90_000;

/**
 * The worker's `--status` payload, carried WHOLE. This service does not reshape it: every key in it
 * belongs to the tab, the tab reads it by the name the worker printed, and a translation layer here
 * would be a second place the payload's shape is written down.
 */
export type HealSummary = Record<string, unknown>;

/** What `--ignore-add` answers: how many ignore rows landed, and how many live rows they swept. */
export type HealIgnoreAdd = { added: number; swept: number };

/**
 * Why a heal question went unanswered.
 *
 *  - `unreachable`  the worker never answered: not on this host, or torn down before it spoke.
 *  - `unreadable`   the worker answered, and it was not the one JSON object its contract promises.
 */
export type HealFault = 'unreachable' | 'unreadable';

export type HealResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: HealFault; message: string };

/**
 * What a cycle door answers, carried WHOLE: the worker's own object (`{"cycle", "started", "stage",
 * "why"}`), which is the cycle's verdict on the press — including its REFUSAL, which is an answer and
 * not a fault. `started` false carries the worker's sentence in `why` ("busy — run … is walking …",
 * "heal switch off", "a cycle is already open (healing) — Stop ends it"); true carries the id and stage
 * the press opened. Nothing here narrows the object: the panel renders `why`, and a second shape
 * written down in this lane would be a second place it is defined.
 */
export type HealCycleAnswer = Record<string, unknown>;

export type HealServiceDependencies = {
  /** The worker's entry point, absolute — `~/.claude/scripts/heal-reflex` unless the env moved it. */
  bin: string;
};

export type HealService = {
  /** The whole summary the tab reads: counts, kind rows, heal cards, the ignore table, the queue. */
  summary(): Promise<HealResult<HealSummary>>;
  /** The rows filed under one door's word, newest first, as the worker's own kind door answers them. */
  kind(kind: string): Promise<HealResult<unknown>>;
  /** The ignore table, seeded rows included. */
  ignore(): Promise<HealResult<unknown>>;
  /** Add one ignore row, and sweep the live rows its pattern already matches. */
  addIgnore(tool: string, pattern: string, reason: string): Promise<HealResult<HealIgnoreAdd>>;
  /** Press the cycle door: open a cycle now over what the ledger holds, or refuse with a reason. */
  cycle(): Promise<HealResult<HealCycleAnswer>>;
  /** Stop the open cycle: its running heals finish and nothing new starts. */
  stopCycle(): Promise<HealResult<HealCycleAnswer>>;
};

/**
 * Runs the worker and decodes the one JSON object it prints.
 *
 * `cwd` is the home directory rather than this repository, and the environment is the one a process
 * started for the operator inherits: the worker can LAUNCH a plan-runner chain, which spawns souls
 * that spawn `tsx`, and the server's own `TSX_TSCONFIG_PATH` would send those descendants to the
 * server's tsconfig — the measured failure `shared/child-env.ts` exists to prevent.
 */
async function ask(
  bin: string,
  argv: string[],
  timeoutMs: number,
): Promise<HealResult<Record<string, unknown>>> {
  let stdout: string;
  try {
    stdout = (await execFileAsync(bin, argv, {
      timeout: timeoutMs,
      maxBuffer: OUTPUT_MAX_BYTES,
      env: userFacingEnv(),
      cwd: os.homedir(),
    })).stdout;
  } catch (error) {
    const failure = error as { stderr?: unknown };
    const said = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
    return {
      ok: false,
      reason: 'unreachable',
      message: `the heal worker could not be asked${said ? ` (${said})` : ''}`,
    };
  }
  try {
    const payload: unknown = JSON.parse(stdout);
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new Error('not an object');
    }
    return { ok: true, value: payload as Record<string, unknown> };
  } catch {
    // The worker's contract is ONE object and nothing else, so anything else is a worker this lane
    // has no answer for — never a body of our own over the top of it.
    return { ok: false, reason: 'unreadable', message: 'the heal worker did not answer with a JSON object' };
  }
}

export function createHealService({ bin }: HealServiceDependencies): HealService {
  /** Runs the worker, then narrows its payload to the one field the caller asked for. */
  const numberIn = (payload: Record<string, unknown>, key: string): number | null =>
    typeof payload[key] === 'number' ? (payload[key] as number) : null;

  return {
    summary: () => ask(bin, ['--status'], STATUS_TIMEOUT_MS),

    // The kind is the key the caller asked by, handed to the worker as ONE argument (the argv array
    // is the boundary: a kind name is not a trusted token and never becomes a shell string).
    kind: (kind: string) => ask(bin, ['--kind', kind], KIND_TIMEOUT_MS),

    /**
     * The ignore table, sliced off ONE summary read rather than a second transport: the payload the
     * tab is already waiting on carries these rows, and asking twice for one file is a second way for
     * the two answers to disagree. A payload without the array is a worker this lane has no answer for.
     */
    async ignore() {
      const asked = await ask(bin, ['--status'], STATUS_TIMEOUT_MS);
      if (!asked.ok) return asked;
      const rows = asked.value['ignore'];
      if (!Array.isArray(rows)) {
        return { ok: false, reason: 'unreadable', message: 'the heal worker did not report the ignore table' };
      }
      return { ok: true, value: rows };
    },

    async addIgnore(tool, pattern, reason) {
      const asked = await ask(bin, ['--ignore-add', tool, pattern, reason], IGNORE_TIMEOUT_MS);
      if (!asked.ok) return asked;
      const added = numberIn(asked.value, 'added');
      const swept = numberIn(asked.value, 'swept');
      // Both counts or neither: the tab renders them as one sentence ("ignored 14 existing rows") and
      // a half-read pair would print a number nobody counted.
      if (added === null || swept === null) {
        return { ok: false, reason: 'unreadable', message: 'the heal worker did not report what the ignore row swept' };
      }
      return { ok: true, value: { added, swept } };
    },

    /**
     * The cycle door, asked and ANSWERED. A cycle press is a question ("may one open now?"), and the
     * worker's own object IS the answer, refusal included: `execFile` holds the response until the
     * worker prints it, and the bound is that worker's own for this door. Spawning it detached would give the press nowhere to
     * put its reason, and the panel would read "busy — run … is walking …" as a wall instead.
     */
    cycle: () => ask(bin, ['--cycle', 'now'], CYCLE_TIMEOUT_MS),

    /** The stop door: same shape, same bound, same rule — the worker's object is the answer. */
    stopCycle: () => ask(bin, ['--cycle', 'stop'], CYCLE_TIMEOUT_MS),
  };
}
