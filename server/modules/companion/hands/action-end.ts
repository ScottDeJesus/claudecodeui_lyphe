import { companionDb } from '@/modules/database/index.js';

import type { CompanionStoredPending } from '../companion-pending.js';
import type { CompanionStore } from '../companion-store.js';

/**
 * THE ENDING OF A STANDING ACTION: the one place an action leaves her state without being taken, and the one place that knows
 * which actions a take is carrying out. Her `cancel_action` and his × on the card (`companionService.cancelAction`) both withdraw
 * an action HERE, so the two doors cannot end one two ways, and every verb that finds a lapse ends it here, so a row of her record
 * of actions (`companion_actions`) is never left without an outcome.
 *
 * NOTHING TIMES A LAPSE OUT. An action is past its time when `expiresAt` has gone by, and the next prepare, take or cancel that
 * meets it ends it `expired` (the page hides it at the deadline it set itself, `CompanionActionCard`). There is no timer here:
 * this house reacts to events, and a prepare, a take and a cancel are the events a lapse matters at.
 *
 * A TAKE IN FLIGHT IS NOBODY ELSE'S TO END. While a take's door is out, the action is claimed twice over: in this process
 * (`carryOut` holds its id per account) and on its row (`claimAction` writes the firing line, and `endAction` ends a claimed row
 * only for a call that names that line). A withdrawal, a lapse, a newer prepare and a Clear therefore leave it, and the take
 * ends it with the door's own outcome. A claimed row that no take of THIS process is carrying — its server restarted, or its
 * take failed after the door — may have gone through: the next prepare, take or cancel ends it `refused` and says so, and the
 * action leaves his panel, so the same word is never fired twice.
 *
 * Consumers: `hands-tools.ts` (all three tools) and `companion.service.ts` (`cancelAction`, his ×).
 */

/** What a row says when the process that was carrying its action out is gone: the door may or may not have run. Consumed by `action-rearm.ts`, which never re-arms a row that says it. */
export const MAY_HAVE_GONE_THROUGH = 'The server stopped while this was being carried out, so it may have gone through; check before preparing it again.';

/** The actions a take of this process is carrying out, per account. */
const carryingOut = new Map<number, Set<string>>();

/** Whether a take of this process is carrying out the action `id` of the account. */
export function isCarryingOut(userId: number, id: string): boolean {
  return carryingOut.get(userId)?.has(id) ?? false;
}

/**
 * Runs `run` as the carrying out of the action `id`: the id is held from this call, with no await before `run` starts, to the end
 * of `run`, so a second call in this process meets it. The caller claims the row (`claimAction`) first thing inside `run`.
 */
export async function carryOut<T>(userId: number, id: string, run: () => Promise<T>): Promise<T> {
  const held = carryingOut.get(userId) ?? new Set<string>();
  carryingOut.set(userId, held);
  held.add(id);
  try {
    return await run();
  } finally {
    held.delete(id);
  }
}

/** Whether `standing` is past its time at `nowMs`. Written as "not still alive" so an `expiresAt` that does not parse reads as lapsed. */
function hasLapsed(standing: CompanionStoredPending, nowMs: number): boolean {
  return !(nowMs <= Date.parse(standing.expiresAt));
}

/**
 * Ends every claimed row of the account that no take of this process is carrying out, `refused` with the sentence that it may have
 * gone through, and takes the standing action off his panel if it is one of them. What a prepare, a take and a cancel do first.
 */
function settleOrphanedActions(userId: number, store: CompanionStore): void {
  for (const row of companionDb.listActions(userId, 20)) {
    if (row.outcome !== null || row.said_log_id === null || isCarryingOut(userId, row.id)) continue;
    companionDb.endAction(userId, row.id, { outcome: 'refused', said_log_id: row.said_log_id, answer: MAY_HAVE_GONE_THROUGH });
    if (store.readState().pending?.id === row.id) store.setPending(null);
  }
}

/** What a withdrawal found: nothing standing (`null`), an action a take is carrying out (`busy`, left as it was), or the action it took off his panel (`cancelled`, or `expired` when it had lapsed first). */
type Withdrawal = { standing: CompanionStoredPending; ended: 'cancelled' | 'expired' | 'busy' } | null;

/**
 * Withdraws the action standing in her state, if any, and takes it off his panel. Its row ends `cancelled` — or `expired` when it
 * had lapsed first: a lapse found by this call is a lapse, whatever the caller meant by it. An action a take is carrying out is
 * left alone (`busy`). The row ends before the state clears, and the state clears even when the row was already ended (a Clear
 * got there first), so a page is never left drawing an action no row waits on.
 */
export function withdrawStandingAction(userId: number, store: CompanionStore, nowMs: number = Date.now()): Withdrawal {
  settleOrphanedActions(userId, store);
  const standing = store.readState().pending;
  if (standing === null) return null;
  if (isCarryingOut(userId, standing.id)) return { standing, ended: 'busy' };
  const ended = hasLapsed(standing, nowMs) ? 'expired' : 'cancelled';
  companionDb.endAction(userId, standing.id, { outcome: ended });
  store.setPending(null);
  return { standing, ended };
}

/**
 * What a prepare and a take do first, after settling orphans: an action found past its time ends `expired` and leaves his panel
 * (one a take is carrying out is left to the take). Answers the action it ended, so a take can say it lapsed rather than that
 * nothing was waiting, or `null` when none had lapsed.
 */
export function endLapsedAction(userId: number, store: CompanionStore, nowMs: number = Date.now()): CompanionStoredPending | null {
  settleOrphanedActions(userId, store);
  const standing = store.readState().pending;
  if (standing === null || isCarryingOut(userId, standing.id) || !hasLapsed(standing, nowMs)) return null;
  companionDb.endAction(userId, standing.id, { outcome: 'expired' });
  store.setPending(null);
  return standing;
}
