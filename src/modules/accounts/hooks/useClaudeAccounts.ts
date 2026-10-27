import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ClaudeAccounts } from '@/shared/types';

/**
 * How often the account picture is re-read. Deliberately slow: nothing here changes except when a
 * person acts, and the server answers off the door's own files — so a slow read costs one skipped
 * picture, never a queue.
 */
const ACCOUNTS_POLL_MS = 60_000;

/**
 * What to say when a write did not land.
 *
 * The service's own `error` is preferred whenever it sent one — it names the actual refusal
 * ("no checked sign-in token — set it up first") in words a person can act on. Only when the route
 * answered without a verdict (`{reachable:false, reason}`) does this translate the one word itself.
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

/** The event a command made OUTSIDE this hook's own instance fires, so the one instance that polls re-reads the picture at once instead of at its next tick. */
const ACCOUNTS_CHANGED_EVENT = 'cloudcli:accounts-changed';

/**
 * Tells the account provider the picture moved under it. Fired when the Re-login window closes (the
 * panel's door and Settings' door both) and when the Set up window closes: each ran a command this
 * app cannot see the end of, so the panel re-reads rather than going on showing the old account
 * until its next tick.
 */
export function announceAccountsChanged(): void {
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT));
}

/**
 * The Claude accounts the door holds, and the three writes that change them.
 *
 * Used by the accounts module's AccountsProvider, which owns the single instance — it is mounted once
 * above the views rail and the main region, so there is exactly one poller in the app however many
 * places draw the panel.
 *
 * ONE PICTURE, THREE WRITES. `GET /api/accounts` answers the door's own picture, tagged with
 * `reachable`; `use`/`auto`/`remove` are the writes that choose, unchoose and drop an account.
 * Every write re-reads the picture when it lands, because none of the three is meaningful on a
 * stale one.
 *
 * A write is deliberately unguarded by a dialog: the panel's row states the fact it would ask about.
 * What IS guarded is a SECOND write while one is in flight, since the choice is not re-entrant.
 */
export function useClaudeAccounts() {
  // The last picture the route answered with. Held because the rail button and the panel both
  // read it between polls, and because `null` (nothing asked yet) has to look different from
  // `{reachable:false}` (asked, and there was no picture to be had).
  const [data, setData] = useState<ClaudeAccounts | null>(null);
  // True while any write is in flight, so the rows can refuse a second press.
  const [busy, setBusy] = useState(false);
  // The server's refusal of the LAST write, shown inline as a warn banner. Cleared when the next
  // write starts, when the popover closes or the widget is folded, and when the next picture lands: a
  // refusal describes one attempt, never the panel's standing state, and one left standing would greet
  // the next person who opens it — or, in the gutter widget that is on screen all day with no close to
  // end it, every glance until the next write.
  const [error, setError] = useState<string | null>(null);

  // Mount flag: a poll that resolves after the provider unmounted (a sign-out, or the workspace leaving the tree) must not set state.
  const mountedRef = useRef(true);
  // The in-flight guard read synchronously — `busy` is a render value and lands too late to
  // stop a second press in the same tick.
  const writingRef = useRef(false);

  const store = useCallback((next: ClaudeAccounts) => {
    if (!mountedRef.current) return;
    setData(next);
    // The picture is the fact a refusal was about, and this one is newer than the refusal: a failed write
    // re-reads nothing, so only a later read — the poll, an announced change, a landed write — ends it.
    setError(null);
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

  // A window closed elsewhere (`useAccountSetup`, and each Re-login door) ran a door command: read now.
  useEffect(() => {
    const readAgain = () => { void refresh(); };
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, readAgain);
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, readAgain);
  }, [refresh]);

  /**
   * One of the door's three writes, and the one place their shared shape lives.
   *
   * The route answers the door's own line on 200 (`USING <slug>`, `AUTO on`, `REMOVED <slug>`) or
   * the door's own refusal sentence on 422 as `{ error }`. A refusal is shown in the panel's warn
   * banner, in the door's words; a landed write re-reads the picture at once, because the row it
   * moved is drawn from that picture and a minute-old copy would go on showing the account the
   * write just replaced. The single-writer guard makes none of these re-entrant.
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

  /** Drops a standing refusal. The popover calls it on close and the gutter widget on fold; a landed picture drops it too. */
  const clearError = useCallback(() => setError(null), []);

  return { data, refresh, chooseAccount, setAuto, removeAccount, busy, error, clearError };
}
