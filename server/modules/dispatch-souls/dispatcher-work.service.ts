import { field, isRecord } from '@/shared/document-fields.js';

import { chainsRootBeside, readChainRecord } from './chain-record.transport.js';
import { listLaunchDirs } from './soul-launch.transport.js';

/**
 * Which launches are the DISPATCHER's own work — the souls it runs for an epic, as opposed to the
 * ones a chat launched itself.
 *
 * The launcher stamps every soul with the session that called it (`launched_by`), and the
 * dispatcher calls it under the session an epic was STARTED from — so the chat that starts an epic
 * carries the same stamp on every designer, planner, builder and reviewer the epic runs as a soul
 * that chat launched by hand does. Nothing in the stamp tells the two apart, and a chat's own list
 * (the Subagents widget) has to. The answer is a second fact on the same record.
 *
 * TWO READINGS OF ONE QUESTION, and only the first is the rule:
 *
 * 1. THE MARK. `spec.json` carries `dispatcher: {plan, phase}` on every launch the dispatcher makes
 *    for an epic (`hooks/plan_runner/solo/dispatch_mark.py`: a chain's stages through the walker's
 *    environment, a planner's outing straight from its row). A launch that carries it is the
 *    dispatcher's, for the plan and phase it names, whatever its stamp says.
 * 2. THE DISPATCHER'S OWN RECORDS, for a launch written before the mark existed. A chain is the
 *    dispatcher's iff its record says `until_pass: true`, the mode the dispatcher walks a phase's
 *    chain in (INV-169) — measured 2026-10-06: 447 chains carry it and 447 chains are named by
 *    `phases.chain_id`, the same ones — and every stage of such a chain is its work. THE READING IS
 *    NOT EXACT: `cases cure` walks its fixes in the same mode (`hooks/cases/cure.py:argv_for`, slug
 *    `cure-<case>-<stamp>`), and a cure walk writes no mark and has no `phases` row, so while this
 *    bridge lasts a cure walk's stages are hidden from the chat that started it, as if they were an
 *    epic's. The mark has no such blind spot, and the bridge goes with its last launch. A planner is
 *    the `planner` role, which the launcher admits in the daemon's own process alone and never on
 *    the public verb (`solo/launch.py:prepare`); measured the same day, the 50 launches the
 *    `planners` table names on this disk are exactly the launches that wear it. Both readings come
 *    off the launch layer's own files, so this module reads no SQLite of the dispatcher's.
 *    THIS HALF IS A BRIDGE, and it is deleted when its last launch is: a launch directory is kept
 *    fourteen days (`solo/record.py:KEEP_DAYS`), so once the dispatcher and its walkers have all been
 *    started on the marking build and a fortnight has passed, no unmarked dispatcher launch is left
 *    on disk and the bridge answers `false` for everything it is asked.
 *
 * Three readers of the stamp ask this one question: the chat's Subagents list, the lane's
 * `dispatcher_work` flag, and the sidebar's purple dot (`running-launchers.service.ts`), so a chat that
 * only started an epic carries none of the epic's souls in any of them. The file-ownership rail
 * (`session_rails_chains.py`) is the reader that still takes `launched_by` as written.
 */

/** The one role that is the dispatcher's alone (`souls.PLANNER_ROLE`); a hand cannot launch it. */
const PLANNER_ROLE = 'planner';

/** The set a caller that has no chain index to hand compares against: nothing is a legacy chain stage. */
const NO_CHAIN_LAUNCHES: ReadonlySet<string> = new Set();

/** Whether the spec carries the dispatcher's mark: a `dispatcher` record naming a plan. */
function carriesMark(spec: unknown): boolean {
  const mark = field(spec, 'dispatcher');
  return isRecord(mark) && typeof mark.plan === 'string' && mark.plan !== '';
}

/**
 * The launch ids of every stage of every chain the dispatcher walked, among the chains written to
 * since `notOlderThanMs`.
 *
 * The window is the chain DIRECTORY's mtime, the same bound the dot's reader uses
 * (`listLaunchDirs`): a chain's record is rewritten at each stage boundary, so its mtime is never
 * older than the newest stage it holds — a window that reaches back to a launch therefore reaches
 * back to the chain that minted it. A torn or missing record is a chain that names nothing this
 * pass; the next pass reads it again.
 *
 * Consumed by `soul-launch.service.ts`'s lane snapshot, by `running-launchers.service.ts` (the purple
 * dot) and by the providers module's chat-list reader (`session-soul-launches.service.ts`), each of
 * which reads it once per pass and hands it to {@link isDispatcherWork} for every launch it classifies.
 */
export function readDispatcherChainLaunchIds(soulsRoot: string, notOlderThanMs: number): Set<string> {
  const chainsRoot = chainsRootBeside(soulsRoot);
  const launchIds = new Set<string>();
  for (const chainId of listLaunchDirs(chainsRoot, notOlderThanMs)) {
    const chain = readChainRecord(chainsRoot, chainId);
    if (chain === null || !chain.untilPass) continue;
    for (const launchId of chain.launchIds) launchIds.add(launchId);
  }
  return launchIds;
}

/**
 * Whether one launch is the dispatcher's own work: it carries the mark, or the dispatcher's records
 * name it (a planner, or a stage of a chain in `dispatcherChainLaunchIds`).
 *
 * `spec` is the launch's parsed `spec.json`, `launchId` its directory's name. A caller with no chain
 * index (`classifyLaunch` when its caller reads only a launch's state) leaves the set out and gets
 * the mark and the planner role — the answer that needs nothing but the spec.
 *
 * Consumed by `soul-launch.service.ts` (the lane's `dispatcher_work` flag, which the chat's live
 * anchoring skips), by `running-launchers.service.ts` (the purple dot, which a dispatcher launch must
 * not light) and by the providers module's `session-soul-launches.service.ts` (the chat's
 * server-side list), so the ways a chat can claim a launch by its stamp agree on which launches
 * are not the chat's own.
 */
export function isDispatcherWork(
  launchId: string,
  spec: unknown,
  dispatcherChainLaunchIds: ReadonlySet<string> = NO_CHAIN_LAUNCHES,
): boolean {
  return carriesMark(spec)
    || field(spec, 'role') === PLANNER_ROLE
    || dispatcherChainLaunchIds.has(launchId);
}
