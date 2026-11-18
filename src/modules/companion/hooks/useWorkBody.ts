import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { CompanionWorkBody } from '@/shared/companion-types';

/**
 * What a read of one call has come to: its body, `'gone'` when the server no longer keeps the call, `'failed'` when the read did
 * not come back (to be asked again), or `null` while it is out.
 */
type Held = CompanionWorkBody | 'gone' | 'failed' | null;

const isBody = (value: unknown): value is CompanionWorkBody =>
  typeof value === 'object' && value !== null && typeof (value as CompanionWorkBody).kept === 'boolean' && typeof (value as CompanionWorkBody).cut === 'boolean';

/**
 * WHAT ONE TOOL CALL WAS GIVEN AND WHAT IT ANSWERED, read when its row in the log is opened and not before: the log's list
 * carries each call without them, so a long conversation costs nothing until a call is looked at.
 *
 * `id` is the call and `wanted` whether its row stands open; `ended` is whether the call has answered. A call that had not
 * answered when it was read is read again once it has, so an open row shows the answer as it lands. `retry` asks again after a
 * read that failed.
 *
 * Used by `CompanionWork`, for each opened row.
 */
export function useWorkBody(id: number, wanted: boolean, ended: boolean): { held: Held; retry: () => void } {
  // The read's answer, tagged with what it was asked for, so an answer for one state of the call never draws as another's.
  const [held, setHeld] = useState<{ key: string; value: Exclude<Held, null> } | null>(null);
  // Counts the asks after a failure: a new number is a new read.
  const [asked, setAsked] = useState(0);
  const key = `${id}:${ended ? 'ended' : 'running'}:${asked}`;

  useEffect(() => {
    if (!wanted) return undefined;
    let current = true;
    void (async () => {
      let value: Exclude<Held, null> = 'failed';
      try {
        const response = await api.companion.work(id);
        if (response.status === 404) value = 'gone';
        else if (response.ok) {
          const body: unknown = await response.json();
          if (isBody(body)) value = body;
        }
      } catch {
        value = 'failed';
      }
      if (current) setHeld({ key, value });
    })();
    return () => {
      current = false;
    };
  }, [id, wanted, key]);

  const retry = useCallback(() => setAsked((count) => count + 1), []);
  return { held: held !== null && held.key === key ? held.value : null, retry };
}
