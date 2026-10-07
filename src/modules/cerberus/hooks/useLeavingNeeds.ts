import { useEffect, useRef, useState } from 'react';

import type { CerberusNeed } from '@/shared/cerberus-types';

/** How long a card that stopped needing you stays drawn: the length of `vv-toast-out` that it leaves on. */
const LEAVE_MS = 550;

/**
 * A need that stopped needing you — the check with the fix and run its card was drawn from — and the place
 * in the list DRAWN at that moment (cards still leaving counted) that it held, so its card leaves from
 * where it stood, with its run's strip as it was.
 */
type Leaver = { need: CerberusNeed; place: number };

type DrawnCard = { need: CerberusNeed; leaving: boolean };

const checkKey = ({ check: { node, key } }: CerberusNeed): string => `${node}/${key}`;

/**
 * The list Needs you draws for these `needs` and these leavers: the needs in their order, each leaver
 * spliced back at its place. Ascending, so each splice restores the index the card stood at, and two
 * that left together keep their order.
 */
function drawnCards(needs: CerberusNeed[], leavers: Leaver[]): DrawnCard[] {
  const cards: DrawnCard[] = needs.map((need) => ({ need, leaving: false }));
  [...leavers]
    .sort((a, b) => a.place - b.place)
    .forEach(({ need, place }) => cards.splice(Math.min(place, cards.length), 0, { need, leaving: true }));
  return cards;
}

/**
 * The cards Needs you draws: each of `needs` in its order and, for .55 s after a check stops needing
 * you, its last card kept at the place it held with `leaving: true`. A card that blinked out at once
 * would give no sign of what changed; this one leaves where the eye already was. A check that needs
 * you again before its card is gone takes its place back, and its card stays.
 *
 * A check that stops needing you is a check that was muted, healed or retired; the card kept is the
 * last one drawn, so it still reads what it read — its fix and its run's strip with it. Keyed by
 * `<node>/<key>` by the caller.
 *
 * A place counts in the list as it was DRAWN, cards still leaving included, so a second card that
 * leaves while the first is on its way out is kept where it stood and not one slot above.
 *
 * Used by the cerberus module's `NeedsYouCard`, the one list on the tab that has cards come and go.
 */
export function useLeavingNeeds(needs: CerberusNeed[]): DrawnCard[] {
  // The cards that have stopped needing you and are still on their way out. Essential: it is the one
  // thing the overview no longer holds, and each entry leaves it when its exit has played.
  const [leavers, setLeavers] = useState<Leaver[]>([]);
  // The `needs` the last render drew, kept in state so a departure is found DURING the render that
  // loses the card, never after it: a card must not be missing for one frame before it comes back leaving.
  const [seen, setSeen] = useState(needs);
  // One timer per leaver, by its check's key (a check leaves once at a time), so a card that leaves a
  // moment after another keeps its own .55 s.
  const timers = useRef(new Map<string, number>());

  if (needs !== seen) {
    const stillNeeded = new Set(needs.map(checkKey));
    // Places are read off the list the last render drew, which holds the cards still leaving.
    const departed = drawnCards(seen, leavers).flatMap(({ need, leaving }, place) => (
      leaving || stillNeeded.has(checkKey(need)) ? [] : [{ need, place }]
    ));
    setSeen(needs);
    // A leaver whose check needs you again is no longer leaving: its card is a card again.
    setLeavers((current) => [...current.filter(({ need }) => !stillNeeded.has(checkKey(need))), ...departed]);
  }

  useEffect(() => {
    const leaving = new Set(leavers.map(({ need }) => checkKey(need)));
    for (const key of leaving) {
      if (timers.current.has(key)) continue;
      timers.current.set(key, window.setTimeout(() => {
        timers.current.delete(key);
        // The list is one card shorter once this one is gone: every place after it moves up a slot.
        setLeavers((current) => {
          const gone = current.find(({ need }) => checkKey(need) === key);
          if (gone === undefined) return current;
          return current
            .filter((entry) => entry !== gone)
            .map((entry) => (entry.place > gone.place ? { ...entry, place: entry.place - 1 } : entry));
        });
      }, LEAVE_MS));
    }
    // A leaver that came back is gone from the list and its timer has nothing left to remove.
    for (const [key, timer] of timers.current) {
      if (leaving.has(key)) continue;
      window.clearTimeout(timer);
      timers.current.delete(key);
    }
  }, [leavers]);

  // The timers belong to this hook alone: when the card goes, so do they, so a late one never sets state on a gone component.
  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) window.clearTimeout(timer);
      held.clear();
    };
  }, []);

  return drawnCards(needs, leavers);
}
