import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { DeepseekBalance } from '@/shared/types';

/**
 * How often the balance is re-read on its own. The usage cadence, deliberately: this is the same
 * kind of fact as the windows beside it — a figure the provider owns, that moves slowly, and that
 * a person wants fresh at the moment they open the panel rather than every minute.
 */
const BALANCE_POLL_MS = 180_000;

/**
 * How recently a read must have LANDED for the next one to be refused outright.
 *
 * The poll's cadence bounds the timer, but opening the panel is the other trigger — and the row is
 * a button a person presses while thinking, so ten open/close cycles used to spend ten vendor
 * calls. Five seconds sits far below the time it takes to close a panel and reconsider, and far
 * above the vendor's own ~0.3 s answer, so every press that could show a different figure still
 * reads and only the ones that cannot are free. The age line under the figure is what makes that
 * honest: a skipped read draws a figure that SAYS when it was taken, which is the difference
 * between a fresh number and one that merely looks fresh.
 *
 * It bounds attempts, not successes: a read that failed still counts as one, so a route that is
 * answering nothing costs a press no more than a route that is answering everything.
 */
const FORCED_READ_FLOOR_MS = 5_000;

/**
 * Whether a body is the report the route promises.
 *
 * The route answers 200 with this shape or not at all, but the Request goes through whatever sits
 * in front of it: `authenticateToken` answers an expired session with
 * `{"error":"Session expired…","code":"AUTH_TOKEN_EXPIRED"}`, and a proxy answers a bad gateway in
 * JSON too. Stored unexamined, such a body is drawn as a reading with `undefined` where its reason
 * belongs. Anything that is not the contract is "no reading" — which is what an unreadable answer
 * IS.
 */
function isBalanceReport(body: unknown): body is DeepseekBalance {
  if (!body || typeof body !== 'object') return false;
  return typeof (body as { reachable?: unknown }).reachable === 'boolean';
}

/**
 * The money left on this host's DeepSeek account.
 *
 * Used by the accounts module's footer row, which owns the ONE instance and hands the same reading
 * to both registers it draws — the line under the account name and the row in the panel — so the
 * two can never disagree and opening the panel starts no second poller.
 *
 * It is a hook of its own rather than a third read inside `useClaudeUsage` because it is a
 * different account, a different server route and a different origin: the account lane is down
 * and this is not, which is exactly the state the panel has to be able to draw.
 */
export function useDeepseekBalance() {
  // The last reading the server answered with. `null` (not asked yet) and `{reachable:false}`
  // (asked, and there was no reading) are different things to say, and neither of them is zero.
  const [data, setData] = useState<DeepseekBalance | null>(null);
  // Mount flag: a poll that resolves after the sidebar collapsed must not set state.
  const mountedRef = useRef(true);
  // The read already on the wire, if any. Toggling the panel is the ordinary way to use this row,
  // and every open asks for a fresh figure — without this, ten open/close cycles put ten requests
  // in flight, and a vendor sitting on its five-second ceiling lets them stack. A call that finds
  // one running JOINS it rather than starting a second: the answer in flight is newer than the
  // reading on screen, which is the most a forced read can promise anyway.
  const inFlightRef = useRef<Promise<void> | null>(null);
  // When the last read LANDED, whatever it landed on. Together with the ref above this makes the
  // hook's whole contract "at most one read in flight, and never two within `FORCED_READ_FLOOR_MS`".
  const lastReadAtRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    if (Date.now() - lastReadAtRef.current < FORCED_READ_FLOOR_MS) return;

    // Never rejects: every failure below is stored as the unknown, which is the same "no reading"
    // the route's own body would have carried.
    const read = (async () => {
      try {
        const response = await api.deepseek.balance();
        // A non-200 is never a reading, whatever shape its body has.
        if (!response.ok) {
          if (mountedRef.current) setData({ reachable: false, reason: 'unreachable' });
          return;
        }
        const body: unknown = await response.json();
        if (mountedRef.current) {
          setData(isBalanceReport(body) ? body : { reachable: false, reason: 'unreachable' });
        }
      } catch {
        // The route answers 200 with the unknown in its body, so a throw is this app's own network
        // or a body that is not JSON — "no reading", which is not a reading of zero.
        if (mountedRef.current) setData({ reachable: false, reason: 'unreachable' });
      }
    })();

    inFlightRef.current = read;
    void read.finally(() => {
      inFlightRef.current = null;
      // Stamped on the way OUT, so the floor measures the interval between answers rather than
      // between presses: a vendor that spends its whole five-second ceiling delays the next read
      // by its own latency instead of letting one start on top of it.
      lastReadAtRef.current = Date.now();
    });
    return read;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, BALANCE_POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { data, refresh };
}
