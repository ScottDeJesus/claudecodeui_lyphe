import type { CompanionStore } from './companion-store.js';

/**
 * THE WALK'S CURSOR, as his press moves it. There is one walk per account, held in her store, and her `walk` tool and his
 * Back, Next and × move the SAME cursor through `store.setWalk`, so `companion_walk` reaches every page whoever moved it and no
 * second cursor exists. His press moves or ends the walk that is held; only she starts one or replaces its items.
 *
 * THE REFUSALS ARE HER TOOL'S OWN WORDS (`walkBeyondSentence`, `noWalkSentence`), exported to `tools/draft-tools.ts` so the two
 * doors cannot word one refusal two ways. His press does not set her activity and does not follow a focus, and she is told of
 * it by no push: the shell's `<view kind="walk" …>` rides his next word (the companion's rule: nothing is pushed silently).
 *
 * Consumers: `companion.service.ts` (`moveWalk`, `endWalk`) and `tools/draft-tools.ts` (the two sentences).
 */

/** The sentence of a move past the last item: the count, and the way out. Consumed by `tools/draft-tools.ts` (her `walk`) and `moveHeldWalk` below (his press). */
export const walkBeyondSentence = (at: number, count: number): string =>
  `at is ${at}, but the walkthrough has ${count} ${count === 1 ? 'item' : 'items'}: use 1 to ${count}, or 0 to end it.`;

/** The sentence when no walkthrough is open to be moved or ended. Consumed by `tools/draft-tools.ts` (her `walk` 0) and `moveHeldWalk` below (his press). */
export const noWalkSentence = (verb: 'move' | 'end'): string => `There is no walkthrough open, so there is nothing to ${verb}.`;

/**
 * Moves the held walk to item `at` (counted from 1), keeping its chat and its items, or answers the sentence that refuses:
 * no walk held, or `at` that is not one of 1..n (the route has already refused a body that is not a whole number of 1 or more; the
 * check here keeps the cursor on an item for any caller). Moving to the item it is already on changes nothing and still sends
 * the frame, so a page that missed it learns it. Consumed by `companion.service.ts` (`moveWalk`, his Back and Next).
 */
export function moveHeldWalk(store: CompanionStore, at: number): { ok: true } | { ok: false; sentence: string } {
  const held = store.readState().walk;
  if (held === null) return { ok: false, sentence: noWalkSentence('move') };
  if (!Number.isInteger(at) || at < 1 || at > held.items.length) return { ok: false, sentence: walkBeyondSentence(at, held.items.length) };
  store.setWalk({ session: held.session, items: held.items, at });
  return { ok: true };
}

/** Ends the held walk. With none held it changes nothing and sends nothing, so a second page's × on a walk the first already ended is not an error. Consumed by `companion.service.ts` (`endWalk`, his ×). */
export function endHeldWalk(store: CompanionStore): void {
  if (store.readState().walk === null) return;
  store.setWalk(null);
}
