import { useCallback, useRef, useState } from 'react';

import { announceAccountsChanged, sendCapture } from '@/modules/accounts/hooks/useClaudeAccounts';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { ClaudeAccounts } from '@/shared/types';

/**
 * The live login as the server reads it: who is signed in, and the clock on their token. Two readings
 * are the same login exactly when both match — a different account changes the first, and a fresh
 * sign-in of the same account (a new token) changes the second.
 */
type LiveLoginReading = { label: string | null; expiresAt: number | null };

/** One read of the live login, or `null` when the server could not be asked — which proves nothing either way. */
async function readLiveLogin(): Promise<LiveLoginReading | null> {
  try {
    const picture = (await (await api.accounts.picture()).json()) as ClaudeAccounts;
    return picture.reachable ? { label: picture.liveLabel, expiresAt: picture.liveExpiresAt } : null;
  } catch {
    return null;
  }
}

/** Email addresses are compared the way the store's own drift check compares them: without case. */
function liveLoginChanged(before: LiveLoginReading, after: LiveLoginReading): boolean {
  return before.label?.toLowerCase() !== after.label?.toLowerCase() || before.expiresAt !== after.expiresAt;
}

/**
 * What a Claude re-login does to the account switcher, for the window that runs `claude /login`.
 *
 * Used by the accounts module's footer row (the panel's Re-login) and by the settings module
 * (Agents → Claude → Re-login), so both doors end the same way: `begin` before the window opens,
 * `finish` when it closes.
 *
 * WHY THE LOGIN ITSELF IS THE SIGNAL. `claude /login` signs in and then stays in the CLI's prompt — it
 * does not exit — so the window is closed by the operator with ✕ and the command's exit code never
 * arrives. What a sign-in leaves behind is the live login, and the server reads that: `finish` reads it
 * once, as the window closes, and files it when it differs from what `begin` read as the window opened.
 * A capture files the login under its own email's slot and makes that slot the account in use
 * (`accounts.routes.ts`), so the switcher lands on the account just signed in. A window closed without
 * signing in changes nothing and writes nothing. No timer and no polling: two reads, one at each end.
 */
export function useReloginCapture() {
  const push = useToast();
  // Armed by `begin` with the live login as it stood when the window opened, and spent by `finish`, so it
  // is also what makes `finish` a no-op for a window `begin` never ran for (another provider's login, the
  // design authorization). `before` is `null` when the server could not be read at the start: the window
  // is armed, but there is nothing to compare against.
  const armedRef = useRef<{ before: LiveLoginReading | null } | null>(null);
  // The in-flight guard read synchronously, as `useClaudeAccounts` guards its own writes: a second press
  // in the same tick would otherwise send a second capture, and `busy` below lands a render too late.
  const workingRef = useRef(false);
  // True while `begin` or `finish` is reading or writing, so the account panel can disable its rows and
  // buttons for the same stretch — a switch sent in the middle of a capture would file the wrong login.
  const [busy, setBusy] = useState(false);

  /** Runs one read-and-write step alone. Answers false, having done nothing, when another step is still working. */
  const runAlone = useCallback(async (work: () => Promise<void>): Promise<boolean> => {
    if (workingRef.current) return false;
    workingRef.current = true;
    setBusy(true);
    try {
      await work();
      return true;
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  }, []);

  /** Files the live login under `label` and tells the row to re-read. A refusal is a toast — a re-login has no panel to put a banner in. */
  const saveLiveLogin = useCallback(async (label: string) => {
    try {
      const refusal = await sendCapture(push, () => label);
      if (refusal !== null) {
        push({ tone: 'warn', title: `Could not save ${label}`, message: refusal });
        return;
      }
      announceAccountsChanged();
    } catch {
      push({ tone: 'warn', title: `Could not save ${label}`, message: 'The server is not reachable.' });
    }
  }, [push]);

  /**
   * Saves the login that is live NOW, before the CLI can replace it, so signing in as someone else
   * loses nothing; and remembers it as the one `finish` compares against. Awaited by the caller before
   * the window opens, and the window opens only when this answers true — false means another step of
   * this flow was still working and this press did nothing. Never throws and never blocks the window: a
   * login with nothing to save (nobody signed in yet) just opens it.
   */
  const begin = useCallback((): Promise<boolean> => runAlone(async () => {
    const before = await readLiveLogin();
    armedRef.current = { before };
    if (before?.label) await saveLiveLogin(before.label);
  }), [runAlone, saveLiveLogin]);

  /**
   * Called as the window closes, however it closes. Files the live login only if it changed while the
   * window was open. A server that could not be read at either end cannot prove a change, so nothing is
   * filed — and a toast says so, because otherwise the operator who signed in as another account sees the
   * switcher stay where it was and nothing to say why.
   */
  const finish = useCallback(async () => {
    const armed = armedRef.current;
    armedRef.current = null;
    if (armed === null) return;
    await runAlone(async () => {
      const after = await readLiveLogin();
      if (armed.before === null || after === null) {
        push({
          tone: 'warn',
          title: 'Could not tell whether you signed in',
          message: 'The server could not be read, so the login was not saved. If you signed in as another account, the account panel will offer to save it.',
        });
        return;
      }
      if (after.label && liveLoginChanged(armed.before, after)) await saveLiveLogin(after.label);
    });
  }, [push, runAlone, saveLiveLogin]);

  return { begin, finish, busy };
}
