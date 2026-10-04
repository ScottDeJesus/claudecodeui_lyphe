import path from 'node:path';

import { dispatchSoulsStateDir } from '@/shared/utils.js';

import { chainsRootBeside, readChainRecord } from './chain-record.transport.js';
import { classifyLaunch } from './soul-launch.service.js';
import { hasLaunchReceipt, listLaunchDirs, readLaunchFiles, readLaunchSpec } from './soul-launch.transport.js';

/**
 * Which conversations have a dispatched soul or chain OUT right now — the half of the sidebar's
 * purple dot that no transcript can answer.
 *
 * A builder or reviewer started through the dispatch door (`plan-runner chain`, `plan-runner soul`)
 * is a separate process. It streams nothing into the chat that launched it, so the chat's own
 * sidechains never show it; the launcher records it instead, in `spec.json`, stamped `launched_by`
 * with the Claude CLI session id whose turn launched it (`solo/launch.py`, from
 * `CLAUDE_CODE_SESSION_ID`). Ownership is read off that stamp and nowhere else — the same rule
 * `session_rails_chains.py` keeps for the rails: a chain belongs to a session iff ONE of its stages
 * was launched from it.
 *
 * Two readings, because one alone blinks. A soul is out while the launcher's own classification
 * says `running`. A chain is out while its walker is, and that holds BETWEEN its stages too — the
 * relaunch gap, and the hand-off from builder to review to doc sweep, when no soul is running at
 * all but the work is plainly not over. A chain is owned by every session stamped on ANY of its
 * stages: the stages the walker launches inherit the stamp of the session that started the chain
 * (measured 2026-10-02, 60 of 60 recent chains carry one stamp throughout), and a stage resumed
 * from another chat can carry that chat's — a chain started with no session to name carries none, and owns nothing.
 *
 * The answer is CLI ids, not app ids: the translation to the conversation the sidebar draws is the
 * app database's, and belongs to the caller. Everything is read off disk with sync calls, like the
 * lane beside it (`snapshotLaunches`), and a record that is missing, torn or half-written is skipped
 * — never thrown.
 */

/**
 * How far back a record may have been written and still be asked about.
 *
 * Six hours, the lane's own keep (`LAUNCH_KEEP_S` in the composition root), and above every cap the
 * launcher puts on a child: one hour for a soul, four for a planner (`solo/record.py:HOUR_S`,
 * `PLANNER_CAP_S`). That ordering is what makes the bound honest — a launch directory's mtime is
 * frozen at its start, so a soul still out is never older than its cap, and RAISING the cap past
 * this window would drop a live soul from the dot mid-run. A chain's directory is rewritten at every
 * stage boundary, so its mtime is at most one stage old; the same window covers it with room to spare.
 */
const RUNNING_WINDOW_S = 6 * 60 * 60;

/** A launcher that has something out: which CLI session launched it, and why it counts. */
export type RunningLauncher = {
  /** The Claude CLI session id stamped `launched_by` — not the app's id for the conversation. */
  cliSessionId: string;
  reason: 'soul' | 'chain';
  /** The launch id (reason `soul`) or chain id (reason `chain`) that makes it true. */
  sourceId: string;
};

/** The `launched_by` stamp off a parsed spec, or `null` when the launch carries none. */
function launchedBy(spec: unknown): string | null {
  const stamp = spec !== null && typeof spec === 'object' ? (spec as { launched_by?: unknown }).launched_by : undefined;
  return typeof stamp === 'string' && stamp !== '' ? stamp : null;
}

/**
 * Every stamped launch the lane's own classification calls `running`.
 *
 * Measured 2026-10-02: 372 launch directories inside the window, and the full read of each (two
 * pids, a brief) cost 29 ms of a 40 ms pass. Only a launch that names a chat AND has no receipt yet
 * can be a dot, so those two cheap questions go first and the full read is spent on the few that
 * pass — the verdict is still `classifyLaunch`'s, the prefilter only decides who is asked.
 */
function listRunningSouls(soulsRoot: string, nowS: number): RunningLauncher[] {
  const running: RunningLauncher[] = [];
  for (const launchId of listLaunchDirs(soulsRoot, (nowS - RUNNING_WINDOW_S) * 1000)) {
    try {
      const launchDir = path.join(soulsRoot, launchId);
      const cliSessionId = launchedBy(readLaunchSpec(launchDir));
      if (cliSessionId === null || hasLaunchReceipt(launchDir)) continue;
      if (classifyLaunch(readLaunchFiles(launchDir, launchId), nowS, RUNNING_WINDOW_S)?.state === 'running') {
        running.push({ cliSessionId, reason: 'soul', sourceId: launchId });
      }
    } catch {
      // One unreadable launch is a launch not counted this pass — the next pass reads it again.
    }
  }
  return running;
}

/**
 * Every session that launched a stage of a chain whose walker is still walking.
 *
 * `running` alone is not trusted: a walker killed outright leaves its record at `running` until a
 * reaper settles it, and a dot that stays lit over a corpse is worse than one that blinks. The pid
 * check is the launcher's own (`chain_state.walker_alive`), so a chain counts exactly when the
 * house would call it live.
 */
function listRunningChains(soulsRoot: string, nowS: number): RunningLauncher[] {
  const chainsRoot = chainsRootBeside(soulsRoot);
  const running: RunningLauncher[] = [];
  for (const chainId of listLaunchDirs(chainsRoot, (nowS - RUNNING_WINDOW_S) * 1000)) {
    try {
      const chain = readChainRecord(chainsRoot, chainId);
      if (chain === null || chain.status !== 'running' || !chain.walkerAlive) continue;

      const owners = new Set<string>();
      for (const launchId of chain.launchIds) {
        const owner = launchedBy(readLaunchSpec(path.join(soulsRoot, launchId)));
        if (owner !== null) owners.add(owner);
      }
      for (const cliSessionId of owners) {
        running.push({ cliSessionId, reason: 'chain', sourceId: chainId });
      }
    } catch {
      // One unreadable chain is a chain not counted this pass — the next pass reads it again.
    }
  }
  return running;
}

/**
 * The launchers with a soul or a chain out right now, one row per reason: a session with a running
 * builder inside a running chain appears twice, and the caller folds that to one dot.
 *
 * Consumed by the providers module's `session-subagent-runs.service.ts`, which maps each CLI id to
 * the conversation it belongs to and unions the result with what the chat's own sidechains show.
 * `nowS` is epoch SECONDS, the launcher's clock; `soulsRoot` defaults to the lane's own root and is
 * a parameter so a hermetic tree can be read in its place.
 */
export function listRunningLaunchers(
  nowS: number = Date.now() / 1000,
  soulsRoot: string = dispatchSoulsStateDir(),
): RunningLauncher[] {
  return [...listRunningSouls(soulsRoot, nowS), ...listRunningChains(soulsRoot, nowS)];
}
