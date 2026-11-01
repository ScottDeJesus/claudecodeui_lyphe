import type { CompanionActionTarget, CompanionPendingAction } from '@/shared/companion-types';
import type { StationNeed } from '@/shared/station-types';

/**
 * The one item kind each of her actions answers. A Queue, Hide or Rework is her hand on an Accept (`prepareAtAccept`); an Answer is her
 * hand on a questions round. An action absent here answers no item: a Show acts on a hidden card, which the rail holds no item for,
 * and a stop, a resume, a recut, a kick, a run's resume, a follow-up's close and her memory's clear act on things the rail does not hold.
 * A Hide of an approved card whose round is open is the dispatcher's own hide of the card, not an answer to the round: it pairs
 * with an Accept only, so it waits beside the round.
 */
const ANSWERED_KIND: Partial<Record<CompanionPendingAction['action'], StationNeed['kind']>> = {
  queue: 'accept',
  hide: 'accept',
  rework: 'accept',
  answer: 'questions',
};

/**
 * Whether her card `target` is the card `need` is about; only an Accept and a round are about a card. The rail names an epic's card
 * bare with `epic: true` (`need-readers.ts`). Her action names the epic `<name>.arc` when she is asked for the epic, and one feature
 * of it by its own name with the epic in `arc` when she is asked for a feature (`action-targets.ts`); the lock is the epic's either
 * way, so both are that one item.
 */
function isAbout(need: StationNeed, target: Extract<CompanionActionTarget, { kind: 'card' }>): boolean {
  if (need.kind === 'accept' && need.epic) return target.name === `${need.card}.arc` || target.arc === need.card;
  return (need.kind === 'accept' || need.kind === 'questions') && target.name === need.card;
}

/** Whether `pending` is her hands on an Accept or a round the rail holds: then the item and the action are one thing, answered, and it is counted once. */
function answersAnItem(needs: StationNeed[], pending: CompanionPendingAction): boolean {
  const kind = ANSWERED_KIND[pending.action];
  const { target } = pending;
  if (kind === undefined || target.kind !== 'card') return false;
  return needs.some((need) => need.kind === kind && isAbout(need, target));
}

/**
 * HOW MANY THINGS NEED HIM, the one rule: the rail's items, and her one pending action as one more, unless the action answers an
 * item on the rail (a Queue, Hide or Rework on the card an Accept is about, an Answer on the card a round is about), where it is that
 * item and counts once: "two Accepts and one red check" is three while her hand rests on one of the Accepts. An action on something
 * the rail holds no item for (a stop, a resume, a recut, a kick, a run's resume, a follow-up's close, her memory's clear, a Show) waits
 * for his word as a thing of its own, and counts. `pending` is her action as her picture holds it, or `null` for none, and for one whose
 * card has lapsed: a lapsed action is no longer asked of him.
 *
 * `null` while `needs` is `null` (the first read of the items has not landed): a 0 would claim "nothing waits".
 *
 * Read by the three places that say the number: the rail's head (`WhatNeedsYouView`), compact's "Needs you" button and the phone's
 * bar, the last two through `useNeedsCount`; and by `.verify/kaylee-station-shots.mjs`, which hands compact's and the phone's
 * views the number their fixture's rail draws, so no picture holds a count of its own.
 */
export function needsCountOf(needs: StationNeed[] | null, pending: CompanionPendingAction | null): number | null {
  if (needs === null) return null;
  return needs.length + (pending !== null && !answersAnItem(needs, pending) ? 1 : 0);
}
