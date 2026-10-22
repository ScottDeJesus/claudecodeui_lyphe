import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { ClaudeAccounts } from '@/shared/types';

/**
 * How often the account picture is re-read. D7's floor, and deliberately slow: nothing here
 * changes except when a person switches, and the server answers off its own files — so a slow
 * read costs one skipped picture, never a queue.
 */
const ACCOUNTS_POLL_MS = 60_000;

/**
 * What to say when a write did not land.
 *
 * The service's own `error` is preferred whenever it sent one — it names the actual refusal
 * ("unknown account slot 'x'") in words a person can act on. Only when the route answered
 * without a verdict (`{reachable:false, reason}`) does this translate the one word itself.
 */
function writeRefusalInWords(body: unknown): string {
  const answer = (body ?? {}) as { error?: unknown; reason?: unknown };
  if (typeof answer.error === 'string' && answer.error.trim()) return answer.error.trim();
  if (answer.reason === 'timeout') return 'The server did not answer in time.';
  if (answer.reason === 'bad-response') return 'The server answered with something this app could not read.';
  return 'The server is not reachable.';
}

/** A write's verdict is the service's own body, so it is read before the status is judged — and a body that is not JSON must not throw over the status. */
async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** The event a write made OUTSIDE this hook's own instance fires, so the one instance that polls re-reads the picture at once instead of at its next tick. */
const ACCOUNTS_CHANGED_EVENT = 'cloudcli:accounts-changed';

/**
 * Tells the account row the store moved under it. Used by `useReloginCapture`, whose capture runs from
 * the Settings dialog as well as from the row: the row owns the single poller, and without this it would
 * go on showing the account that was in use until its next tick, up to a minute after the sign-in.
 */
export function announceAccountsChanged(): void {
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT));
}

/**
 * One capture, from the request to the toast that says what it did. Answers the store's refusal in
 * words, or `null` when the login was filed. Used by this hook's `capture` and by `useReloginCapture`,
 * so the two cannot word the same write differently. The caller decides where a refusal is shown: the
 * drift banner's "Save it" has the panel's banner, a re-login has no panel to show one in.
 *
 * `labelFor` names the slot the store filed the login under — the panel's picture knows its slots'
 * labels; a caller without a picture passes the email it just read off the live login.
 */
export async function sendCapture(
  push: ReturnType<typeof useToast>,
  labelFor: (slug: string) => string,
): Promise<string | null> {
  const response = await api.accounts.capture();
  const body = await readBody(response);
  if (!response.ok) return writeRefusalInWords(body);
  const captured = (body as { captured?: unknown } | null)?.captured;
  // A capture is not a snapshot only: the route also re-points the ACTIVE account to the
  // slug it just saved (`accounts.routes.ts`, the capture route). Under drift that MOVES
  // which account is in use, so the toast says so rather than reporting a filing.
  push({
    tone: 'positive',
    title: typeof captured === 'string' ? `Saved ${labelFor(captured)}` : 'Saved the login that is live now',
    message: 'It is now the account in use.',
  });
  return null;
}

/**
 * The signed-in Claude accounts, and the writes that change them.
 *
 * Used by the accounts module's footer row, which owns the single instance — the sidebar
 * renders the row once (the collapsed rail and the expanded footer are mutually exclusive),
 * so there is exactly one poller in the app at a time.
 *
 * TWO DOORS, ONE PICTURE. The old slot switcher's `switchTo`/`capture` (until phase old-switcher
 * removes them) and the account store's `chooseAccount`/`setAuto`/`removeAccount` are different
 * writes over different routes, but both land in the same `data` read: `data.door` is the store's
 * own picture and the panel draws it. Every write re-reads that picture when it lands, because
 * none of the three is meaningful on a stale one.
 *
 * A switch is deliberately unguarded by a dialog: the soft gate is the fact on the row
 * ("in use now · 8 sessions running"), not a modal. What IS guarded
 * is a SECOND write while one is in flight, since a whole-box swap is not re-entrant.
 */
export function useClaudeAccounts() {
  // The last picture the route answered with. Held because the footer row and the panel both
  // read it between polls, and because `null` (nothing asked yet) has to look different from
  // `{reachable:false}` (asked, and there was no picture to be had).
  const [data, setData] = useState<ClaudeAccounts | null>(null);
  // True while any write — a switch, a capture, a door act — is in flight, so the rows can refuse a
  // second press.
  const [busy, setBusy] = useState(false);
  // The server's refusal of the LAST write, shown inline as a warn banner. Cleared when the next
  // write starts and when the panel closes: a refusal describes one attempt, never the panel's
  // standing state, and one left standing would greet the next person who opens it.
  const [error, setError] = useState<string | null>(null);

  const push = useToast();
  // The current picture as a ref so `switchTo` and `capture` can name a slug's label without
  // being rebuilt every time a poll lands — a callback whose identity changed each minute
  // would restart the polling effect below and turn one poller into a stutter of them.
  const pictureRef = useRef<ClaudeAccounts | null>(null);
  // Mount flag: a poll that resolves after the sidebar collapsed must not set state.
  const mountedRef = useRef(true);
  // The in-flight guard read synchronously — `busy` is a render value and lands too late to
  // stop a second press in the same tick.
  const writingRef = useRef(false);

  const store = useCallback((next: ClaudeAccounts) => {
    pictureRef.current = next;
    if (mountedRef.current) setData(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.accounts.picture();
      store((await response.json()) as ClaudeAccounts);
    } catch {
      // The route answers 200 even when nothing can be computed, so a throw here is this app's
      // own network or a body that is not JSON. Either way the honest reading is "no picture".
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

  // A capture made elsewhere (`useReloginCapture`, from the Settings dialog) moved the store: read it now.
  useEffect(() => {
    const readAgain = () => { void refresh(); };
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, readAgain);
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, readAgain);
  }, [refresh]);

  /** The label the store gave a slug, or the slug itself when the picture has not caught up (a capture can name a slot this app has never seen). */
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
      const response = await api.accounts.switchAccount(slug);
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
        // sessions keep the tokens they already hold in memory.
        message: `Running conversations finish on the account they started with. New messages use ${label}.`,
      });
      await refresh();
    } catch {
      setError('The server is not reachable.');
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
      const refusal = await sendCapture(push, labelFor);
      if (refusal !== null) {
        setError(refusal);
        return;
      }
      await refresh();
    } catch {
      setError('The server is not reachable.');
    } finally {
      writingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [labelFor, push, refresh]);

  /**
   * One of the door's three writes, and the one place their shared shape lives.
   *
   * The route answers the door's own line on 200 (`USING <slug>`, `AUTO on`, `REMOVED <slug>`) or
   * the door's own refusal sentence on 422 as `{ error }`. A refusal is shown in the panel's warn
   * banner, in the door's words, exactly as the old switcher's refusals are; a landed write re-reads
   * the picture at once, because the row it moved is drawn from that picture and a minute-old copy
   * would go on showing the account the write just replaced. The single-writer guard is the same one
   * `switchTo` and `capture` hold: none of these is re-entrant.
   */
  const doorWrite = useCallback(async (send: () => Promise<Response>) => {
    if (writingRef.current) return;
    writingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await send();
      const body = await readBody(response);
      if (!response.ok) {
        setError(writeRefusalInWords(body));
        return;
      }
      await refresh();
    } catch {
      setError('The server is not reachable.');
    } finally {
      writingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }, [refresh]);

  /** The door's `use <slug>`: make this account the one new chats and plan runs start on. */
  const chooseAccount = useCallback((slug: string) => doorWrite(() => api.accounts.use(slug)), [doorWrite]);

  /** The door's `auto on|off`: whether the rule may switch by itself when the account in use fills. */
  const setAuto = useCallback((on: boolean) => doorWrite(() => api.accounts.auto(on)), [doorWrite]);

  /** The door's `remove <slug>`: drop the account and its token; a chosen account is unchosen and the dispatcher kicked. */
  const removeAccount = useCallback((slug: string) => doorWrite(() => api.accounts.remove(slug)), [doorWrite]);

  /** Drops a standing refusal. The panel calls it on close; nothing else may need it. */
  const clearError = useCallback(() => setError(null), []);

  // The door's own picture inside the last answer: `data.door`. Read off the same poll as the slot
  // summary, so the panel needs no second request and no second clock; null before the first answer
  // and when the lane itself answered `{reachable:false}`.
  const door = data !== null && data.reachable ? data.door ?? null : null;

  return { data, door, refresh, switchTo, capture, chooseAccount, setAuto, removeAccount, busy, error, clearError };
}
