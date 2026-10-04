import { useCallback, useState } from 'react';

import { sameOrder } from '@/shared/ui/sortable/carryState';

/** How long a drop's order is still held after its write has answered, for a store whose next reading has not landed yet. */
const HOLD_GRACE_MS = 3000;

/** The order a drop made. */
type Held = { order: readonly string[] };

/** The keys of `order` that `among` also holds, in `order`'s own sequence: two lists compared only by the items both of them know. */
function shared(order: readonly string[], among: readonly string[]): readonly string[] {
  const known = new Set(among);
  return order.filter((key) => known.has(key));
}

/**
 * The order a drop made, kept drawn while the store it was written to catches up. A list whose owner
 * persists a reorder asynchronously (a write to a server whose next reading redraws the keys) would
 * otherwise snap back to the old order for as long as the write takes, then jump forward again.
 *
 * `hold` is told the order the drop made and the write's answer. The order is held until the keys stand in
 * it — the store has caught up, compared only by the items both know, so another writer adding or
 * removing an item in the list neither ends the hold nor stands in for the drop's frame — or the write
 * answers `false` or throws, which puts the list back as the store has it; a write that answers `true`
 * and is never followed by the drop's order is let go `HOLD_GRACE_MS` later. A later drop's hold replaces
 * this one, so a frame that carries only the earlier drop does not end it, and an earlier write's answer
 * never ends it. Essential state, not derivable: between the drop and the next reading, no prop says
 * where the item was put.
 *
 * Used by `useSortable`.
 */
export function useDropHold(keys: readonly string[]): {
  heldOrder: readonly string[] | null;
  hold: (order: readonly string[], answer: Promise<boolean>) => void;
} {
  const [held, setHeld] = useState<Held | null>(null);
  // The keys now stand in the drop's order, so the store has caught up and the hold has done its work.
  const live = held !== null && !sameOrder(shared(keys, held.order), shared(held.order, keys)) ? held : null;
  if (held !== null && live === null) setHeld(null);

  const hold = useCallback((order: readonly string[], answer: Promise<boolean>) => {
    const mine: Held = { order };
    setHeld(mine);
    const release = () => setHeld((now) => (now === mine ? null : now));
    void answer.then((taken) => (taken ? setTimeout(release, HOLD_GRACE_MS) : release()), release);
  }, []);

  return { heldOrder: live?.order ?? null, hold };
}
