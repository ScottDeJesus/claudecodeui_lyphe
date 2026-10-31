import { companionDb, type CompanionActionRow } from '@/modules/database/index.js';

import type { CompanionStoredPending } from '../companion-pending.js';

import { MAY_HAVE_GONE_THROUGH } from './action-end.js';

/**
 * THE RE-ARM: what a prepare of one of the eleven asks of her record of actions before it starts a ceremony of its own.
 *
 * An action is read back, he answers, and then something comes between his answer and the fire: the thirty minutes run out while she is
 * away, the dispatcher's door refuses the fire and bounces it, or she prepares the same thing again while it still stands. Her read-back
 * and his answer to it are still true of the same thing. A prepare of the SAME action on the SAME target, reading back the SAME thing, as
 * the ceremony before it is therefore a re-arm: the new pending action keeps the first prepare's stamp as `armedFrom`, the stamp
 * `checkHisWord` reads her read-back from (and picks the record of his word since), and has its own fresh `expiresAt`. A prepare of anything else is a fresh
 * ceremony, and it begins at its own stamp.
 *
 * "The same thing" is the earlier row's own record: its target, its pin (the ask and its lock token, the chain), its prompt and the lines
 * it carries, each as the row stored it. His answer was to one read-back; if the memories she would clear were counted again, the Accept
 * prompt was raised again or his notes are other lines, it was never for this, and the prepare is a fresh ceremony. A record that reads
 * the same but is written otherwise is a fresh ceremony too, which costs one more read-back and never fires one.
 *
 * "The ceremony before it" is the newest row of the account that is one of the eleven (an open or a close is done at once and is no
 * ceremony), and only when it ended without being done or withdrawn: `expired`, `refused` (the door refused the fire) or `replaced`, or it
 * is still waiting, which this very prepare is about to end `replaced`. A cancelled row never re-arms, he withdrew it. A fire that went
 * through (`took`, `already`) never re-arms, and neither does one the server stopped in the middle of, which may have gone through
 * (`MAY_HAVE_GONE_THROUGH`). A ceremony of another action or target since is a newer ceremony and the earlier one no longer stands. Her
 * read-back also grows old: one that began more than an hour ago (`READ_BACK_STANDS_MS`) is not carried, so a request made today is never
 * fired on a read-back of days ago.
 *
 * Reads the record only: the caller has already ended any lapse it found standing (`action-end.ts`), which is what puts that action's
 * row here as `expired`. Consumer: `hands-tools.ts` (`prepare_action`).
 */

/** How the ceremony a re-arm continues ended: it lapsed, the door refused the fire, or a newer prepare replaced it (still waiting counts as replaced). */
export type RearmedAfter = 'expired' | 'refused' | 'replaced';

/** What a re-arm carries over: the stamp the ceremony began, and how the ceremony it continues ended. */
export type Rearm = { armedFrom: string; endedAs: RearmedAfter };

/**
 * How the earlier ceremony ended when that lets a prepare of the same thing carry it on, else `null`. Written as the outcomes that do,
 * so an outcome added later re-arms nothing until it is named here. No outcome yet is the action still waiting on his panel, which this
 * prepare replaces (`hands-tools.ts` ends it `replaced` right after).
 */
function endedAsOf(earlier: CompanionActionRow): RearmedAfter | null {
  switch (earlier.outcome) {
    case null:
      return 'replaced';
    case 'expired':
    case 'replaced':
      return earlier.outcome;
    case 'refused':
      return earlier.answer === MAY_HAVE_GONE_THROUGH ? null : 'refused';
    case 'took':
    case 'already':
    case 'cancelled':
      return null;
  }
}

/**
 * How long her read-back stands, counted from the first prepare of the ceremony: two waits (the thirty minutes an action waits, and thirty
 * more for the re-prepare after a lapse or a refusal). The read-back is the only thing the server checks before a fire, so it must be about
 * THIS request: a prepare of the same thing past this age is a fresh ceremony and costs one more read-back. Consumed by `rearmOf` below.
 */
const READ_BACK_STANDS_MS = 60 * 60_000;

/**
 * The re-arm a prepare of `prepared` is, or `null` when it is a fresh ceremony. `prepared` is what the recipe fixed (`action`, `target`,
 * `prompt`, `carried`, `pin`), compared with the earlier row's columns. `armedFrom` is the earlier row's own `armed_from`, else its
 * `prepared_at` (the ceremony began there), so a second re-arm still counts from the first prepare. A ceremony that began more than
 * `READ_BACK_STANDS_MS` before `nowMs` is not carried on, however it ended.
 */
export function rearmOf(
  userId: number,
  prepared: Pick<CompanionStoredPending, 'action' | 'target' | 'prompt' | 'carried' | 'pin'>,
  nowMs: number = Date.now(),
): Rearm | null {
  const earlier = companionDb.newestCeremonyAction(userId);
  if (earlier === null) return null;
  const endedAs = endedAsOf(earlier);
  if (endedAs === null) return null;
  const readBackTheSame = earlier.action === prepared.action
    && earlier.target_json === JSON.stringify(prepared.target)
    && earlier.pin_json === JSON.stringify(prepared.pin)
    && earlier.prompt === prepared.prompt
    && earlier.carried_json === JSON.stringify(prepared.carried);
  if (!readBackTheSame) return null;
  const armedFrom = earlier.armed_from ?? earlier.prepared_at;
  // Written as "still stands" so that a stamp that does not parse reads as too old and the prepare is a fresh ceremony.
  return nowMs - Date.parse(armedFrom) <= READ_BACK_STANDS_MS ? { armedFrom, endedAs } : null;
}
