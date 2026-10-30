import fs from 'node:fs';
import path from 'node:path';

import { field, isCount, isRecord, isText } from '@/shared/document-fields.js';
import type { SoulLaunchState } from '@/shared/types.js';
import { dispatchSoulsStateDir, expandHome } from '@/shared/utils.js';

import { chainsRootBeside, readChainRecord, SAFE_RECORD_ID } from './chain-record.transport.js';
import { classifyLaunch } from './soul-launch.service.js';
import { listLaunchDirs, readJson, readLaunchFiles } from './soul-launch.transport.js';

/**
 * A RUN, READ BACK FROM ITS OWN RECORD — what the companion's `list_runs` and `read_run` ask the launcher's files.
 *
 * A chain's bytes are `~/.claude/state/dispatch-chains/<id>/`: `chain.json` (the walker's record, rewritten atomically
 * at every stage boundary), `report.md` (the ending's report) and `walker.out` (the detached walker's output, which ends
 * with the report's own lines). A soul's are its launch directory's `spec.json`, `result.json` and `result.md`. Both roots
 * derive from `dispatchSoulsStateDir()`, so a scratch `DISPATCH_SOULS_STATE_DIR` moves every read here with it.
 *
 * THIS IS A READER, NEVER THE RUNNER'S `plan-runner chain --status`: that verb ADOPTS a stage whose walker died, which is a
 * write. Nothing here writes, spawns or throws; a record that is absent, torn or not a run's answers `null`.
 *
 * NEVER THE RUN'S COST (operator ruling 1: usage and spend are not hers to say). The report ends with a `  cost:` line
 * and so does `walker.out`, which repeats the report; every line that opens with `cost:` is cut before the text leaves
 * this file. A stage's own `cost_usd`, `tokens*` and `provider` are never copied into the answer.
 *
 * Consumers: the companion's `eyes/run-list.ts`, `run-resolve.ts` and `run-scopes.ts` (through this module's barrel), for `list_runs` and `read_run`.
 */

/** How many lines of `walker.out` the answer carries: the end of the walk, which holds the report and how it ended. */
const WALKER_TAIL_LINES = 80;

/** How much of the end of `walker.out` is read to find those lines: the file is a few kilobytes, so this reads it whole in practice. */
const WALKER_TAIL_BYTES = 128 * 1024;

/** A line that opens with `cost:` (any indent), through its end: the report's spend line, which never leaves this file. */
const COST_LINE = /^[ \t]*cost:[^\n]*(?:\n|$)/gm;

/** The report's `paths:` line: the result files and review files of the walk, ` · `-separated, `~/`-abbreviated. */
const PATHS_LINE = /^[ \t]*paths:[ \t]*(.+)$/m;

/** One stage of a chain, as its record holds it (without the stage's spend figures). Consumed by the companion's `read_run`. */
export type ChainRunStage = {
  name: string;
  /** The launch id of the soul the stage ran, or `null` before it launched: the key to `readSoulRun`. */
  launch: string | null;
  /** Which try of the stage this row is, or `null` when the record does not say. */
  attempt: number | null;
  /** The stage's own word: `done`, `waiting` (out), `crash`, `timeout`, `api_error`, `dead`. */
  status: string;
  /** The reviewer's tally or the doc sweep's counts (`B:0 H:0 M:2 L:5`), or `null`. */
  verdict: string | null;
  /** When the stage launched, epoch SECONDS (the launcher's clock), or `null`. */
  at: number | null;
  ended_at: number | null;
  /** The PATH of the stage's `result.md`, or `null` while it has none. */
  text: string | null;
  /** The PATH of the stage's review file (a reviewer's findings), or `null`. */
  findings: string | null;
};

/**
 * One chain read whole from disk. `stage` is the record's current (or last) stage name; `stopped_by` is the word of the
 * stop that ended a `dead` chain (`operator`, `prune-sweep`), `null` for a chain nobody stopped through the verb;
 * `walker_alive` says the walker process that owes the next stage is still there; `updated_at` is when the record was last
 * written. `report` is `report.md` with its cost line cut (`null` when the read was summary-only), `paths` the paths its `paths:` line names (`~/` expanded), and
 * `walker_tail` the last 80 lines of `walker.out`, cost line cut. Times are epoch SECONDS. Consumed by the companion's eyes.
 */
export type ChainRun = {
  chain_id: string;
  slug: string;
  agent: string;
  status: string;
  stage: string | null;
  cause: string;
  failed_stage: string | null;
  stopped_by: string | null;
  walker_alive: boolean;
  started_at: number | null;
  ended_at: number | null;
  updated_at: number | null;
  stages: ChainRunStage[];
  report: string | null;
  paths: string[];
  walker_tail: string;
};

/** One soul launch read from its own directory (without its spend or provider). Consumed by the companion's `read_run`. */
export type SoulRun = {
  launch_id: string;
  agent: string;
  role: string;
  /** The brief's first meaningful line, as the pin shows it; `''` when it cannot be read. */
  brief: string;
  /** The CLI session id of the chat that launched it, or `null`. */
  launched_by: string | null;
  state: SoulLaunchState;
  status: string;
  cause: string;
  started_at: number;
  ended_at: number | null;
  /** The path of its `result.md`, or `null` while it has none. */
  result_path: string | null;
};

/** A string field of a parsed record, or `null` when it is absent, blank or another type. */
function textOf(record: unknown, name: string): string | null {
  const value = field(record, name);
  return isText(value) && value.trim() !== '' ? value : null;
}

/** A finite number field of a parsed record, or `null`. */
function countOf(record: unknown, name: string): number | null {
  const value = field(record, name);
  return isCount(value) ? value : null;
}

/**
 * A time field of a parsed record in epoch SECONDS, or `null` when it is absent, not a finite number, or so far out of range that no
 * date can be made of it (`new Date(seconds * 1000)` throws past ±8.64e12 s). The runner writes `time.time()`; a torn or hand-edited
 * record that holds something else must cost its own time, never the reader that is asked for the whole list.
 */
function secondsOf(record: unknown, name: string): number | null {
  const value = countOf(record, name);
  return value !== null && Number.isFinite(new Date(value * 1000).getTime()) ? value : null;
}

/** `text` without the lines that open with `cost:`. */
function withoutCostLines(text: string): string {
  return text.replace(COST_LINE, '');
}

/** A whole small file as text, or `null` when it cannot be read. */
function readTextFile(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The last `lines` lines of the end of a file, or `''`: only the final `WALKER_TAIL_BYTES` are read, so a long log costs one small read. */
function readTail(file: string, lines: number): string {
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(handle).size;
      const start = Math.max(0, size - WALKER_TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      const all = buffer.toString('utf8').split('\n');
      // A read that began mid-file starts on a partial line; it is dropped rather than shown torn.
      const whole = start > 0 ? all.slice(1) : all;
      while (whole.length > 0 && whole[whole.length - 1] === '') whole.pop();
      return whole.slice(-lines).join('\n');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return '';
  }
}

/** The paths the report's `paths:` line names, `~/` expanded; `[]` when it has no such line. */
function pathsNamedBy(report: string | null): string[] {
  const line = report === null ? undefined : PATHS_LINE.exec(report)?.[1];
  if (line === undefined) return [];
  return line.split(' · ').map((entry) => expandHome(entry.trim())).filter((entry) => entry !== '');
}

/** One stage entry of the record, or `null` when it is not an object. */
function stageOf(entry: unknown): ChainRunStage | null {
  if (!isRecord(entry)) return null;
  return {
    name: textOf(entry, 'name') ?? '',
    launch: textOf(entry, 'launch'),
    attempt: countOf(entry, 'attempt'),
    status: textOf(entry, 'status') ?? '',
    verdict: textOf(entry, 'verdict'),
    at: secondsOf(entry, 'at'),
    ended_at: secondsOf(entry, 'ended_at'),
    text: textOf(entry, 'text'),
    findings: textOf(entry, 'findings'),
  };
}

/**
 * One chain read whole from its record: `chain.json`'s `status`, `cause`, `failed_stage`, `slug`, times and `stages`, the
 * report with its cost line cut, the paths the report names and the last 80 lines of `walker.out` with the cost line cut.
 * `null` when the id fails the launcher's fence (`SAFE_RECORD_ID`, held before any path is joined) or the record is absent or
 * torn. Reads files and nothing else — never the runner's `--status`, which adopts a dead walker's stage.
 *
 * `summaryOnly` reads the record alone: `report` is `null`, `paths` empty and `walker_tail` `''`, with every other field as it is. A list
 * of runs (hundreds of records in one synchronous pass) needs the status, stage and times, and the report and the walker's log are two
 * more files each; a read of one run asks for all of it.
 * Consumed by the companion's `eyes/run-list.ts` and `run-resolve.ts` (summary only: a dispatcher run's own status, is this id a chain)
 * and `run-scopes.ts` (all four scopes, whole).
 */
export function readChainRun(chainId: string, options: { summaryOnly?: boolean } = {}): ChainRun | null {
  if (!SAFE_RECORD_ID.test(chainId)) return null;
  const root = chainsRootBeside(dispatchSoulsStateDir());
  const dir = path.join(root, chainId);
  const record = readJson(path.join(dir, 'chain.json'));
  const status = textOf(record, 'status');
  if (record === null || status === null) return null;

  const stopped = field(record, 'stopped');
  const stoppedBy = status === 'dead' ? textOf(stopped, 'by') : null;
  const reportText = options.summaryOnly === true ? null : readTextFile(path.join(dir, 'report.md'));
  const stages = Array.isArray(field(record, 'stages'))
    ? (field(record, 'stages') as unknown[]).flatMap((entry) => stageOf(entry) ?? [])
    : [];
  return {
    chain_id: chainId,
    slug: textOf(record, 'slug') ?? chainId,
    agent: textOf(record, 'agent') ?? '',
    status,
    stage: textOf(record, 'stage'),
    cause: textOf(record, 'cause') ?? '',
    failed_stage: textOf(record, 'failed_stage'),
    stopped_by: stoppedBy,
    walker_alive: readChainRecord(root, chainId)?.walkerAlive ?? false,
    started_at: secondsOf(record, 'started_at'),
    ended_at: secondsOf(record, 'ended_at'),
    updated_at: secondsOf(record, 'updated_at'),
    stages,
    report: reportText === null ? null : withoutCostLines(reportText),
    paths: pathsNamedBy(reportText),
    walker_tail: options.summaryOnly === true ? '' : withoutCostLines(readTail(path.join(dir, 'walker.out'), WALKER_TAIL_LINES)),
  };
}

/**
 * One soul launch read from its own directory: its spec's agent, role, brief line and `launched_by`, the state the lane's
 * classification gives it (a launch of any age: the lane's six-hour keep does not apply) and the path of its `result.md`.
 * `null` when the id fails the launcher's fence or the directory holds no launch. Spend and provider are not copied.
 * Consumed by the companion's `eyes/run-resolve.ts` (is this id a soul, and whose chat) and `run-scopes.ts` (a soul alone).
 */
export function readSoulRun(launchId: string): SoulRun | null {
  if (!SAFE_RECORD_ID.test(launchId)) return null;
  const dir = path.join(dispatchSoulsStateDir(), launchId);
  try {
    const snapshot = classifyLaunch(readLaunchFiles(dir, launchId), Date.now() / 1000, Number.POSITIVE_INFINITY);
    if (snapshot === null) return null;
    const resultFile = path.join(dir, 'result.md');
    return {
      launch_id: launchId,
      agent: snapshot.agent,
      role: snapshot.role,
      brief: snapshot.brief,
      launched_by: snapshot.launched_by,
      state: snapshot.state,
      status: snapshot.status,
      cause: snapshot.cause,
      started_at: snapshot.started_at,
      ended_at: snapshot.ended_at,
      result_path: fs.existsSync(resultFile) ? resultFile : null,
    };
  } catch {
    return null;
  }
}

/**
 * For each launch of `launchIds` that a chain's stage launched, that chain's id: the join the lane's snapshots lack (a launch
 * carries no chain id, only the chain's record lists its stages). It reads the chain records written to since
 * `notOlderThanMs` — a chain's directory is rewritten at every stage boundary, so a window that reaches a launch reaches
 * its chain — and answers a map from launch id to chain id; a launch no chain holds is a soul alone and is absent.
 * Consumed by the companion's `eyes/run-list.ts`, to list a chat's chain as one run and not as one row per stage.
 */
export function readChainsHoldingLaunches(launchIds: ReadonlySet<string>, notOlderThanMs: number): Map<string, string> {
  const chainOfLaunch = new Map<string, string>();
  if (launchIds.size === 0) return chainOfLaunch;
  const chainsRoot = chainsRootBeside(dispatchSoulsStateDir());
  for (const chainId of listLaunchDirs(chainsRoot, notOlderThanMs)) {
    const chain = readChainRecord(chainsRoot, chainId);
    if (chain === null) continue;
    for (const launchId of chain.launchIds) {
      if (launchIds.has(launchId)) chainOfLaunch.set(launchId, chainId);
    }
  }
  return chainOfLaunch;
}
