import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { UsageRing } from '@/modules/accounts/UsageRing';
import { accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';

/**
 * The week's usage as one small ring, at the foot of the views rail above Inbox, so the figure stays in sight with the
 * Accounts panel shut. Used by the project-workspace module's WorkspaceRail, through the accounts barrel. It is the
 * module's one ring (`UsageRing`) — the same ring each account row draws — labelled with the time left until the week
 * resets.
 *
 * It reads `useAccountsContext()` and draws the reading THE PANEL'S TOP METERS DRAW — `accountInUseUsage`, the account
 * in use's own figures, not the raw `/api/usage` body, which measures the box's live login and can belong to another
 * account. So the ring and its meter always show the same number, and the ring never reads under the wrong owner. It
 * starts no fetch and no poll: whatever re-reads the provider's readings redraws the ring. The minute tick is a clock,
 * not a read — it moves the ring's countdown label and the hover's countdown on, and carries a week whose reset has just
 * passed.
 *
 * The ring keeps its place whatever the reading says — an unreachable reading, a missing window, nothing asked yet all
 * draw the bare track — so the rail's foot never jumps. It is a status, not a control: no button, no tab stop.
 */
export function UsageRings() {
  const { accounts, usage } = useAccountsContext();
  const now = useMinuteTick();
  const reading = accountInUseUsage(usage, accounts, now);
  // `Array.isArray`: the provider's body is stored as it came (`useClaudeUsage` checks no shape), and this component is
  // mounted on every page — a reply with no `windows` must leave a bare track, never take the whole app down.
  const windows = reading !== null && reading.reachable && Array.isArray(reading.windows) ? reading.windows : [];
  const degraded = reading !== null && reading.reachable && reading.degraded;

  return (
    <div className="flex flex-none flex-col items-center pb-2">
      <UsageRing
        usageWindow={windows.find((usageWindow) => usageWindow.key === 'seven_day') ?? null}
        degraded={degraded}
        now={now}
      />
    </div>
  );
}
