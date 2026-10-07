import { cerberusCatalogDb, cerberusDefinitionsDb, cerberusRunsDb, type CerberusCatalogRow } from '@/modules/database/index.js';
import type { CerberusStatus } from '@/shared/cerberus-types.js';

import { ingest, type CerberusStatusChange } from './ingest.service.js';
import { checkHasRun, startRun } from './runs.service.js';
import { wardenLinks } from './warden-links.js';

/**
 * Cerberus's own rule for running a fix without being asked — the only place that decides it. The
 * warden never does: it verifies what it is sent and runs it, and holds no trigger, limit or switch.
 *
 * THE RULE, applied to each status change ingest stores (`ingest.onChange`): a check whose status MOVED
 * INTO an entry's state from outside it —
 *
 *   `when: failing`   the state is `failing`;
 *   `when: warn`      the state is `warn` or `failing` (a check nearing its limit, or past it);
 *
 * is offered to the entries written for that check, oldest first, and the first that
 *   - has auto on, is not capped and is not retired (a retired entry is in no list below),
 *   - has had fewer than `limit_runs` AUTO runs in the last `limit_per` seconds — a manual run is
 *     never counted, and every auto run asked for is, whatever came of it, so a fix that keeps failing
 *     cannot loop —
 *   - and whose check has no run going (or being asked for)
 * is started, `by: 'auto'`.
 *
 * A MOVE IS AN EVENT ONLY WHILE IT IS NEWS. A warden that was cut off replays its outbox on reconnect,
 * oldest first, so a failure that healed hours ago is delivered as a move into failing now. Two tests keep
 * the rule from acting on history: of one frame's moves only the LAST per check counts (it is the state
 * the frame left the check in; `[ok, failing, ok]` is a check that is ok), and a move whose result is
 * older than the check's own staleness window (`stale_after`, by the warden's clock, brought onto
 * center's by the node's offset) is a past event, not a reason to run a fix on a node that has since
 * recovered — and not a reason to spend one of the entry's runs. The price: a check still failing when
 * a long outage ends is not run on its own until it next moves; it is on Needs you with its button.
 *
 * WHAT NEVER RUNS. A `denied` check: its state is in no entry's set, so no change into it matches — the
 * warden said no to a command or a credential, and a person may still choose to try a fix, which is the
 * need card's button. A check that STAYS failing: it never moves, so it never matches — the run after
 * the one that did not help is the limit's business only if the check recovers and fails again.
 * What DOES run: a MUTED check. Mute silences asking, not fixing; the status ingest hands over is the
 * stored one, with no mute laid over it.
 *
 * The run is asked for, not awaited: `startRun` may wait up to 10 s for a catalog ack and the listener
 * is ingest's, called inline for a warden's frame. A refusal (the node's link closed, the check began a
 * run in the meantime) is one log line — it is the rule's answer, not a fault.
 *
 * Consumers: `cerberus.module.ts` (`startAutoRun`, at the module's start).
 */

/** The statuses an entry of this `when` applies to. */
const STATES_OF: Record<CerberusCatalogRow['run_when'], readonly CerberusStatus[]> = {
  failing: ['failing'],
  warn: ['warn', 'failing'],
};

/** Whether the change carried the check from outside the entry's states into them. */
function movedInto(entry: CerberusCatalogRow, change: CerberusStatusChange): boolean {
  const states = STATES_OF[entry.run_when];
  return states.includes(change.to) && (change.from === null || !states.includes(change.from));
}

/** Whether the entry may be run on its own right now: switched on, uncapped, under its limit. */
function mayRunNow(entry: CerberusCatalogRow, now: number): boolean {
  if (entry.auto !== 1 || entry.capped !== null) return false;
  return cerberusRunsDb.autoRunsSince(entry.id, now - entry.limit_per * 1000) < entry.limit_runs;
}

/** One frame's moves cut to the last per check: the state the frame left each check in. */
function lastMovePerCheck(changed: CerberusStatusChange[]): CerberusStatusChange[] {
  const last = new Map<string, CerberusStatusChange>();
  for (const change of changed) last.set(change.key, change);
  return [...last.values()];
}

function onStatusChanges({ node, changed }: { node: string; changed: CerberusStatusChange[] }): void {
  const now = Date.now();
  // A result's `at` is the warden's clock; this is now on it.
  const wardenNow = now - wardenLinks.clockOffsetMs(node);
  const staleAfterSeconds = new Map(cerberusDefinitionsDb.activeChecks(node).map((check) => [check.key, check.stale_after_s]));
  for (const change of lastMovePerCheck(changed)) {
    const staleAfter = staleAfterSeconds.get(change.key);
    // A check with no resolvable staleness has no window to judge the move's age by: it is not run on a guess.
    if (staleAfter == null || wardenNow - change.at > staleAfter * 1000) continue;
    const entry = cerberusCatalogDb
      .forCheck(node, change.key)
      .find((candidate) => movedInto(candidate, change) && mayRunNow(candidate, now));
    if (!entry || checkHasRun(node, change.key)) continue;

    startRun({ entryId: entry.id, by: 'auto' }).catch((error) => {
      console.warn(`[Cerberus] "${entry.name}" was not run on its own for ${node}/${change.key}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

/** Subscribes the rule to ingest's status changes; answers the function that unsubscribes. */
export function startAutoRun(): () => void {
  return ingest.onChange(onStatusChanges);
}
