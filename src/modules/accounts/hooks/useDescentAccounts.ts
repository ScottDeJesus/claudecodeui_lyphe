import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { DescentAccounts } from '@/shared/types';

/**
 * How often the account picture is re-read. D7's floor, and deliberately slow: nothing here
 * changes except when a person switches, and the proxy's own 4 s ceiling per call is sized
 * against this interval so a stalled Descent costs one skipped reading, never a queue.
 */
const ACCOUNTS_POLL_MS = 60_000;

/**
 * What to say when a write did not land.
 *
 * Descent's own `error` is preferred whenever it sent one — it names the actual refusal
 * ("unknown account slot 'x'") in words a person can act on. Only when the proxy answered
 * for Descent (503 `{reachable:false, reason}`) does this translate the one word itself.
 */
function writeRefusalInWords(body: unknown): string {
  const answer = (body ?? {}) as { error?: unknown; reason?: unknown };
  if (typeof answer.error === 'string' && answer.error.trim()) return answer.error.trim();
  if (answer.reason === 'timeout') return 'Descent did not answer in time.';
  if (answer.reason === 'bad-response') return 'Descent answered with something this app could not read.';
  return 'Descent is not reachable.';
}

/** A write's verdict is Descent's own body, so it is read before the status is judged — and a body that is not JSON must not throw over the status. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The signed-in Claude accounts, and the two writes that change them.
 *
 * Used by the accounts module's footer row, which owns the single instance — the sidebar
 * renders the row once (the collapsed rail and the expanded footer are mutually exclusive),
 * so there is exactly one poller in the app at a time.
 *
 * A switch is deliberately unguarded by a dialog: the soft gate is the fact on the row
 * ("in use now · 8 sessions running"), not a modal (Descent GOTCHAS #174). What IS guarded
 * is a SECOND write while one is in flight, since a whole-box swap is not re-entrant.
 */
export function useDescentAccounts() {
  // The last picture the proxy answered with. Held because the footer row and the panel both
  // read it between polls, and because `null` (nothing asked yet) has to look different from
  // `{reachable:false}` (asked, and there was no picture to be had).
  const [data, setData] = useState<DescentAccounts | null>(null);
  // True while a switch or a capture is in flight, so the rows can refuse a second press.
  const [busy, setBusy] = useState(false);
  // Descent's refusal of the LAST write, shown inline as a warn banner. Cleared when the next
  // write starts and when the panel closes: a refusal describes one attempt, never the panel's
  // standing state, and one left standing would greet the next person who opens it.
  const [error, setError] = useState<string | null>(null);

  const push = useToast();
  // The current picture as a ref so `switchTo` and `capture` can name a slug's label without
  // being rebuilt every time a poll lands — a callback whose identity changed each minute
  // would restart the polling effect below and turn one poller into a stutter of them.
  const pictureRef = useRef<DescentAccounts | null>(null);
  // Mount flag: a poll that resolves after the sidebar collapsed must not set state.
  const mountedRef = useRef(true);
  // The in-flight guard read synchronously — `busy` is a render value and lands too late to
  // stop a second press in the same tick.
  const writingRef = useRef(false);

  const store = useCallback((next: DescentAccounts) => {
    pictureRef.current = next;
    if (mountedRef.current) setData(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.descent.accounts();
      store((await response.json()) as DescentAccounts);
    } catch {
      // The proxy answers 200 even when Descent is down, so a throw here is this app's own
      // network or a body that is not JSON. Either way the honest reading is "no picture".
      store({ reachable: false, reason: 'unreachable' });
    }
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, ACCOUNTS_POLL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  /** The label Descent gave a slug, or the slug itself when the picture has not caught up (a capture can name a slot this app has never seen). */
  const labelFor = useCallback((slug: string) => {
    const picture = pictureRef.current;
    if (!picture?.reachable) return slug;
    return picture.slots.find((slot) => slot.slug === slug)?.label ?? slug;
  }, []);

  const switchTo = useCallback(async (slug: string) => {
    if (writingRef.current) return;
    writingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await api.descent.switchAccount(slug);
      const body = await readBody(response);
      if (!response.ok) {
        setError(writeRefusalInWords(body));
        return;
      }
      const label = labelFor(slug);
      push({
        tone: 'positive',
        title: `Switched to ${label}`,
        // The honest sentence, not the comfortable one: the swap is whole-box and running
        // sessions keep the tokens they already hold in memory (Descent GOTCHAS #174).
        message: `Running conversations finish on the account they started with. New messages use ${label}.`,
      });
      await refresh();
    } catch {
      setError('Descent is not reachable.');
    } finally {
      writingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [labelFor, push, refresh]);

  const capture = useCallback(async () => {
    if (writingRef.current) return;
    writingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await api.descent.capture();
      const body = await readBody(response);
      if (!response.ok) {
        setError(writeRefusalInWords(body));
        return;
      }
      const captured = (body as { captured?: unknown } | null)?.captured;
      // Descent's capture is not a snapshot only: it also re-points its ACTIVE account to the
      // slug it just saved (`server_api_accounts.py:101-102`). Under drift that MOVES which
      // account is in use, so the toast says so rather than reporting a filing.
      push({
        tone: 'positive',
        title: typeof captured === 'string' ? `Saved ${labelFor(captured)}` : 'Saved the login that is live now',
        message: 'It is now the account in use.',
      });
      await refresh();
    } catch {
      setError('Descent is not reachable.');
    } finally {
      writingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [labelFor, push, refresh]);

  /** Drops a standing refusal. The panel calls it on close; nothing else may need it. */
  const clearError = useCallback(() => setError(null), []);

  return { data, refresh, switchTo, capture, busy, error, clearError };
}
