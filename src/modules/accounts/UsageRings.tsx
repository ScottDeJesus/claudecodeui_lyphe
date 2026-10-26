import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { resetsLine } from '@/modules/accounts/UsageMeters';
import { accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { WINDOW_NAMES, ringTone, windowPercent, windowValue } from '@/modules/accounts/utils/usageWindows';
import type { ClaudeUsageWindow } from '@/shared/types';
import { Meter, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The two rings, top to bottom: the 5-hour window over the week, labelled in the words the account rows print (`5h … · wk …`). */
const RINGS = [
  { key: 'five_hour', short: '5h' },
  { key: 'seven_day', short: 'wk' },
] as const;

/** Said when a window has no figure to draw: the ring keeps its place and shows its track alone. */
const NO_READING_WORDS = 'No reading yet';

type UsageRingProps = {
  ring: (typeof RINGS)[number];
  /** The window as the panel's meters draw it, or null when there is none (no reading, or the window is absent). */
  usageWindow: ClaudeUsageWindow | null;
  /** The reading is the last one filed, not a current one: the ring dims as the panel's bars do. */
  degraded: boolean;
};

/** One ring and its hover words. The words ARE the ring's accessible name: paint alone would tell a screen reader nothing. */
function UsageRing({ ring, usageWindow, degraded }: UsageRingProps) {
  const percent = usageWindow === null ? null : windowPercent(usageWindow);
  const rolled = Boolean(usageWindow?.rolled);
  const tone = ringTone(ring.key, percent);

  // Name, figure, reset — the lines the meters say, from the same helpers. The window's own reset time is dropped when
  // it carries no figure: a countdown to a window nobody measured would be the only number in a "no reading" tooltip.
  const words: string[] = [WINDOW_NAMES[ring.key]];
  if (percent === null) {
    words.push(NO_READING_WORDS);
  } else {
    words.push(windowValue(percent, rolled));
    const reset = resetsLine(usageWindow?.resetsAt ?? null);
    if (reset) words.push(reset);
  }

  return (
    <Tooltip
      position="right"
      content={words.map((line, index) => (
        <span key={line} className={index === 0 ? 'block font-semibold' : 'block'}>
          {line}
        </span>
      ))}
    >
      {/* `data-tone` is the whole colouring: the ring's arc takes `--tone-dot` from here (Verve README rule 4). A window
          with no figure carries none, so the ring is its bare track. A rolled window has already ended and a degraded
          reading is old, so both dim exactly as the panel's bars do — a red ring on a window that has reset would be a
          false alarm. */}
      <div data-tone={tone ?? undefined} className={cn('grid size-8 place-items-center', (degraded || rolled) && 'opacity-60')}>
        <Meter variant="ring" percent={percent} label={ring.short} ariaLabel={words.join('. ')} value={windowValue(percent, rolled)} />
      </div>
    </Tooltip>
  );
}

/**
 * The 5-hour and weekly usage as two small rings, at the foot of the views rail above Inbox, so the figures stay in
 * sight with the Accounts panel shut. Used by the project-workspace module's WorkspaceRail, through the accounts barrel.
 *
 * It reads `useAccountsContext()` and draws the reading THE PANEL'S TOP METERS DRAW — `accountInUseUsage`, the account
 * in use's own figures, not the raw `/api/usage` body, which measures the box's live login and can belong to another
 * account. So a ring and its meter always show the same number, and no ring ever reads under the wrong owner. It starts
 * no fetch and no poll: whatever re-reads the provider's readings redraws the rings. The minute tick is a clock, not a
 * read — it dates a filed reading's age (when the ring dims) and keeps the hover's countdown true.
 *
 * The rings keep their places whatever the reading says — an unreachable reading, a missing window, nothing asked yet
 * all draw the bare track — so the rail's foot never jumps. They are a status, not a control: no button, no tab stop.
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
      {RINGS.map((ring) => (
        <UsageRing
          key={ring.key}
          ring={ring}
          usageWindow={windows.find((usageWindow) => usageWindow.key === ring.key) ?? null}
          degraded={degraded}
        />
      ))}
    </div>
  );
}
