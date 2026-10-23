import { useEffect, useRef, useState } from 'react';

import type { AffectedAreasRead, AffectedAreasTrouble } from '@/shared/types';
import { troubleOfFailure, troubleOfResponse } from '@/shared/utils';

type Settled<T> = { key: string; value: T | null; trouble: AffectedAreasTrouble | null };

/**
 * One JSON read of a shadow-connector lane (affected-areas', carrier-bulletins'), kept for the key it was made for. The read happens when the key is set or
 * changes and when `retry` or `reload` is called — never on a timer, so a view that is hidden reads nothing. A null
 * key reads nothing. `fetchFor` must be the same function on every render (a module-level one): it is in the
 * effect's dependencies, so a new one each render would read again each render.
 *
 * `retry` is Try again: it clears the trouble, so the screen shows its waiting surface while the read is out and a
 * second failure mounts the banner afresh (an alert is heard when it mounts). `reload` reads again quietly, keeping
 * the value on screen until the new answer comes. `replace` writes an answer that came by another road (a press's
 * pano) as the value of the key it is GIVEN, which need not be this render's (a press made while the key was null, for
 * a pano the tour had not yet listed as cut, answers after the key was set), and it outranks every read that began
 * before it: those are dropped on arrival, so a stale read can never land over a newer answer.
 *
 * Used by the affected-areas module's `useTours`, `useTour`, `useCodebook`, `usePano`, `useQueue` and `useProving`, and the
 * carrier-bulletins module's `useOverview`, `useBulletinPages` and `usePageReading`.
 */
export function useLaneRead<T>(key: string | null, fetchFor: (key: string) => Promise<Response>): AffectedAreasRead<T> & {
  reload: () => void;
  replace: (value: T, forKey: string) => void;
} {
  // The newest answer and the key it answers. Kept with its key so a key that changed shows nothing at once (the
  // old tour never stands under the new one's name) without an effect to clear it.
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  // How many times a read of the same key was asked for again; the effect reads when it moves.
  const [round, setRound] = useState(0);
  // How many answers `replace` has written. A ref: a read compares it with the count it began under, and nothing draws from it.
  const replacedRef = useRef(0);

  useEffect(() => {
    if (key === null) return undefined;
    // A key that changed, or a view that went, must not receive the answer of the read it left behind; nor must a read
    // that began before a `replace` land over it.
    let current = true;
    const replacedAtStart = replacedRef.current;
    const stale = () => !current || replacedRef.current !== replacedAtStart;
    const fail = (trouble: AffectedAreasTrouble) => {
      // A quiet reload that fails keeps the last good value, with the trouble beside it.
      if (!stale()) setSettled((previous) => ({ key, value: previous?.key === key ? previous.value : null, trouble }));
    };
    void (async () => {
      try {
        const response = await fetchFor(key);
        if (stale()) return;
        if (!response.ok) {
          fail(await troubleOfResponse(response));
          return;
        }
        const value = (await response.json()) as T;
        if (!stale()) setSettled({ key, value, trouble: null });
      } catch (failure) {
        fail(troubleOfFailure(failure));
      }
    })();
    return () => {
      current = false;
    };
  }, [key, fetchFor, round]);

  const mine = settled !== null && settled.key === key ? settled : null;
  return {
    value: mine?.value ?? null,
    trouble: mine?.trouble ?? null,
    retry: () => {
      setSettled((previous) => (previous !== null && previous.key === key ? { ...previous, trouble: null } : previous));
      setRound((asked) => asked + 1);
    },
    reload: () => setRound((asked) => asked + 1),
    replace: (value, forKey) => {
      replacedRef.current += 1;
      setSettled({ key: forKey, value, trouble: null });
    },
  };
}
