import fs from 'node:fs';
import path from 'node:path';

import { readJson } from './soul-launch.transport.js';

/**
 * The BYTES behind one chain — `~/.claude/state/dispatch-chains/<chain id>/`, the record
 * `plan-runner chain` keeps while it walks a builder, a review and a doc sweep in order.
 *
 * Like `soul-launch.transport.ts` this module owns the disk and answers `null` rather than throwing;
 * what a chain MEANS to the purple dot is `running-launchers.service.ts`'s to say. The layout is the
 * launcher's (`hooks/plan_runner/solo/chain_state.py`): `chain.json` is rewritten ATOMICALLY at every
 * stage boundary, so a reader sees the old record or the new one and never half of either, and
 * `walker.pid` names the detached `chain-run` process that moves it.
 */

/** What the dot needs of one chain. Private: `readChainRecord`'s caller reads its fields and never names the type. */
type ChainRecord = {
  chainId: string;
  /** The walker's own word: `running` while it walks, anything else once it has stopped. */
  status: string;
  /** Every stage's launch id, in the order the record lists them. */
  launchIds: string[];
  /** Whether the walker process that owes the next stage is still there. */
  walkerAlive: boolean;
};

/** The argv entry that makes a pid the walker (`solo/chain_state.py:walker_alive` asks the same). */
const WALKER_ARGV = 'chain-run';

/**
 * The launcher's own fence for a launch or chain id (`state_lock.SAFE_ID_RE`, `^[A-Za-z0-9_-]+$`),
 * restated exactly — no length cap, because the launcher sets none and a chain id carries its
 * slug, which is as long as the operator wrote it. A stage's launch id comes out of JSON and is
 * joined onto a path, so it is held to this shape before it goes anywhere near one; the shape has
 * no `.` and no separator, so `..` and an absolute path both fail it.
 */
const SAFE_RECORD_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Where the chain records are, derived from where the launch directories are: both are children of
 * the house's one state root (`plan_runner/state.py:state_root`), so a probe that points the souls
 * root at a hermetic tree gets its chains from the same place and never reads the live ones.
 *
 * Exported for `running-launchers.service.ts`, which lists the chain directories beside the launch
 * directories it was handed.
 */
export function chainsRootBeside(soulsRoot: string): string {
  return path.join(path.dirname(soulsRoot), 'dispatch-chains');
}

/** Whether a value is safe to join onto a record root as a directory name. */
function isSafeRecordId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_RECORD_ID.test(value);
}

/**
 * Whether `walker.pid` still names THIS chain's walker, proved by the pid's own command line.
 *
 * A pid is reused, so the number proves nothing: the process must carry both `chain-run` and this
 * chain's id as argv entries, or a stale pid landing on another chain's walker would answer for it.
 */
function isWalkerAlive(dir: string, chainId: string): boolean {
  try {
    const pid = Number(fs.readFileSync(path.join(dir, 'walker.pid'), 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return argv.includes(WALKER_ARGV) && argv.includes(chainId);
  } catch {
    return false;
  }
}

/**
 * One chain's record, or `null` when its `chain.json` is absent, torn or not a chain's.
 *
 * A stage with no usable launch id (a stage not yet launched, a malformed entry) is left out of
 * `launchIds` rather than failing the record: the other stages still say who owns the chain.
 *
 * Exported for `running-launchers.service.ts`, which asks each chain whether its walker is still
 * walking and which launches it holds, to find the sessions that own it.
 */
export function readChainRecord(root: string, chainId: string): ChainRecord | null {
  if (!isSafeRecordId(chainId)) return null;
  const dir = path.join(root, chainId);
  const record = readJson(path.join(dir, 'chain.json')) as { status?: unknown; stages?: unknown } | null;
  if (record === null || typeof record.status !== 'string') return null;

  const launchIds: string[] = [];
  if (Array.isArray(record.stages)) {
    for (const stage of record.stages) {
      const launch = stage !== null && typeof stage === 'object' ? (stage as { launch?: unknown }).launch : undefined;
      if (isSafeRecordId(launch)) launchIds.push(launch);
    }
  }
  return { chainId, status: record.status, launchIds, walkerAlive: isWalkerAlive(dir, chainId) };
}
