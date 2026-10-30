import { companionDb } from '@/modules/database/index.js';

import type { CompanionStoredPending } from '../companion-pending.js';

/**
 * THE RE-ARM: what a prepare of one of the eleven asks of her record of actions before it starts a ceremony of its own.
 *
 * An action waits thirty minutes for his word. When it lapses, a yes he said since is still his word: he said yes at the screen, the
 * thirty minutes ran out while she was away, and the next thing that happened was her call to take it. A prepare of the SAME action on
 * the SAME target, reading back the SAME thing, as the ceremony that lapsed last is therefore a re-arm: the new pending action keeps the first
 * prepare's stamp as `armedFrom`, the stamp `checkHisWord` reads her read-back and his yes from, and has its own fresh `expiresAt`. A prepare of
 * anything else is a fresh ceremony, and it begins at its own stamp.
 *
 * "The same thing" is the lapsed row's own record: its target, its pin (the ask and its lock token, the chain), its prompt and the lines it
 * carries, each as the row stored it. His yes answered one read-back; if the memories she would clear were counted again, the Accept prompt was
 * raised again or his notes are other lines, the yes was never for this, and the prepare is a fresh ceremony. A record that reads the same but
 * is written otherwise is a fresh ceremony too, which costs one more yes and never fires one.
 *
 * "The ceremony that lapsed last" is the newest row of the account that is one of the eleven (an open or a close is done at once and
 * is no ceremony), and only when that row ended `expired`. So a ceremony of another action or target since the lapse, a take or a
 * cancel, is a newer ceremony and the lapse no longer stands: a yes from before it is never carried across.
 *
 * Reads the record only: the caller has already ended any lapse it found standing (`action-end.ts`), which is what puts that action's
 * row here as `expired`. Consumer: `hands-tools.ts` (`prepare_action`).
 */

/** What a re-arm carries over from the lapse: the stamp the ceremony began, and when the action that lapsed would have lapsed. */
export type Rearm = { armedFrom: string; lapsedAt: string };

/**
 * The re-arm a prepare of `prepared` is, or `null` when it is a fresh ceremony. `prepared` is what the recipe fixed (`action`, `target`,
 * `prompt`, `carried`, `pin`), compared with the lapsed row's columns. `armedFrom` is the lapsed row's own `armed_from`, else its
 * `prepared_at` (the ceremony began there), so a second re-arm still counts from the first prepare.
 */
export function rearmOf(userId: number, prepared: Pick<CompanionStoredPending, 'action' | 'target' | 'prompt' | 'carried' | 'pin'>): Rearm | null {
  const lapsed = companionDb.newestCeremonyAction(userId);
  if (lapsed === null || lapsed.outcome !== 'expired') return null;
  const readBackTheSame = lapsed.action === prepared.action
    && lapsed.target_json === JSON.stringify(prepared.target)
    && lapsed.pin_json === JSON.stringify(prepared.pin)
    && lapsed.prompt === prepared.prompt
    && lapsed.carried_json === JSON.stringify(prepared.carried);
  return readBackTheSame ? { armedFrom: lapsed.armed_from ?? lapsed.prepared_at, lapsedAt: lapsed.expires_at } : null;
}
