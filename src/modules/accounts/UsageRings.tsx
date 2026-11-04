import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { UsageRing } from '@/modules/accounts/UsageRing';
import { accountInUse, accountInUseUsage, hasFiveHour } from '@/modules/accounts/utils/accountInUseUsage';
import { ringWindowKeys } from '@/modules/accounts/utils/usageWindows';

/**
 * The 5-hour and weekly usage as two small rings, at the foot of the views rail above Inbox, so the figures stay in
 * sight with the Accounts panel shut. Used by the project-workspace module's WorkspaceRail, through the accounts barrel.
 * Each is the module's one ring (`UsageRing`) — the same ring each account row draws — labelled with the time left until
 * its window resets, top to bottom: the 5-hour window over the week.
 *
 * It reads `useAccountsContext()` and draws the reading THE PANEL'S TOP METERS DRAW — `accountInUseUsage`, the account
 * in use's own figures, not the raw `/api/usage` body, which measures the box's live login and can belong to another
 * account. So a ring and its meter always show the same number, and no ring ever reads under the wrong owner. It starts
 * no fetch and no poll: whatever re-reads the provider's readings redraws the rings. The minute tick is a clock, not a
 * read — it moves each ring's countdown label and the hover's countdown on, and carries a window whose reset has just passed.
 *
 * The rings keep their places whatever the reading says — an unreachable reading, a missing window, nothing asked yet
 * all draw the bare track — so the rail's foot never jumps. The one exception is an account the door says has no
 * 5-hour window at all (`no_five`, never a window missing from a reply): it has no 5-hour ring to keep, so only the
 * weekly ring stands (`ringWindowKeys`). They are a status, not a control: no button, no tab stop.
 */
export function UsageRings() {
  const { accounts, usage } = useAccountsContext();
  const now = useMinuteTick();
  const reading = accountInUseUsage(usage, accounts, now);
  // `Array.isArray`: the provider's body is stored as it came (`useClaudeUsage` checks no shape), and this component is
  // mounted on every page — a reply with no `windows` must leave two bare tracks, never take the whole app down.
  const windows = reading !== null && reading.reachable && Array.isArray(reading.windows) ? reading.windows : [];
  const degraded = reading !== null && reading.reachable && reading.degraded;

  return (
    <div className="flex flex-none flex-col items-center pb-2">
      {ringWindowKeys(hasFiveHour(accountInUse(accounts))).map((windowKey) => (
        <UsageRing
          key={windowKey}
          windowKey={windowKey}
          usageWindow={windows.find((usageWindow) => usageWindow.key === windowKey) ?? null}
          degraded={degraded}
          now={now}
        />
      ))}
    </div>
  );
}
