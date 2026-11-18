import { useAccountsContext } from '@/modules/accounts/context/AccountsContext';
import { useMinuteTick } from '@/modules/accounts/hooks/useMinuteTick';
import { ACCOUNT_PANEL_ID } from '@/modules/accounts/AccountPopover';
import { accountInUse, accountInUseUsage } from '@/modules/accounts/utils/accountInUseUsage';
import { WINDOW_NAMES, ringTone, windowPercent } from '@/modules/accounts/utils/usageWindows';
import { cn } from '@/shared/utils';

/** How far past the ring's line its press reaches, in px: the band a pointer lands on. */
const REACH = 7;

/** The ring's line, as thick as it is drawn: a hairline, a little heavier once the week runs high. */
const LINE = { quiet: 1.5, high: 2 } as const;

type AccountWeekRingProps = {
  /** The ring's radius in px, from the middle of the core it stands round. */
  radius: number;
  /**
   * Whether a press on it opens the account switcher. Off where the switcher could not be opened beside it (a chat standing in a window
   * of its own, which the switcher is not drawn in): the ring is then a reading and nothing else.
   */
  pressable?: boolean;
  className?: string;
};

/**
 * THE ACCOUNT'S WEEK AS A HAIRLINE ROUND A CORE: how much of this week the account in use has spent, filling clockwise from twelve. It
 * is quiet until the week runs high: the muted ink below 75%, the warn ink from there and the danger ink from 90% (`ringTone`, the
 * rule every usage ring in the app is coloured by). A week nobody has measured draws its track alone.
 *
 * IT IS A PRESS: the band round the core opens the account switcher beside it (`toggleSwitcher`), and a second press shuts it. The
 * core's own press is the core's; this one lies under it, so only the band outside the core reaches it.
 *
 * It centres itself on the box it is put in, which must be positioned (`relative`) and is the core's own. Used, through the accounts
 * barrel, by the chat module's `ChatCore` (outside the hairline that reads the context), the project-workspace module's `WorkspaceHome`
 * and the station module's `StationKaylee` (round Kaylee's core). It reads `AccountsProvider` and starts no read of its own.
 */
export function AccountWeekRing({ radius, pressable = true, className }: AccountWeekRingProps) {
  const { accounts, usage, switcher, toggleSwitcher } = useAccountsContext();
  // A clock, not a read: it carries a week whose reset has just passed to the week that began there.
  const now = useMinuteTick();
  const reading = accountInUseUsage(usage, accounts, now);
  const windows = reading !== null && reading.reachable && Array.isArray(reading.windows) ? reading.windows : [];
  const week = windows.find((usageWindow) => usageWindow.key === 'seven_day') ?? null;
  const percent = week === null ? null : windowPercent(week);
  const tone = ringTone(percent);
  const high = tone === 'warn' || tone === 'danger';
  const inUse = accountInUse(accounts);
  const owner = inUse?.email ?? inUse?.slug ?? null;

  const side = 2 * (radius + REACH);
  const length = 2 * Math.PI * radius;
  const filled = percent === null ? 0 : Math.min(100, Math.max(0, percent)) / 100;
  const words = `${owner === null ? 'Account' : `Account ${owner}`}. ${WINDOW_NAMES.seven_day} ${percent === null ? 'has no reading yet' : `${percent}%`}`;

  const drawing = (
    <svg aria-hidden="true" viewBox={`${-side / 2} ${-side / 2} ${side} ${side}`} className="pointer-events-none size-full -rotate-90">
      <circle r={radius} fill="none" strokeWidth={1} style={{ stroke: 'var(--border)' }} />
      {percent !== null && (
        <circle
          r={radius}
          fill="none"
          strokeWidth={high ? LINE.high : LINE.quiet}
          strokeDasharray={`${filled * length} ${length}`}
          style={{ stroke: tone === 'danger' ? 'var(--danger-ink)' : tone === 'warn' ? 'var(--warn-ink)' : 'var(--ink-muted)' }}
          className="transition-[stroke-dasharray,stroke] duration-500 motion-reduce:transition-none"
        />
      )}
    </svg>
  );
  const box = cn('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full', className);

  if (!pressable) {
    return (
      <span role="img" aria-label={words} title={words} data-account-week={percent ?? ''} className={box} style={{ width: side, height: side }}>
        {drawing}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-account-ring=""
      data-account-week={percent ?? ''}
      aria-label={`${words}. Accounts`}
      title={words}
      aria-haspopup="dialog"
      aria-expanded={switcher !== null}
      aria-controls={switcher !== null ? ACCOUNT_PANEL_ID : undefined}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        toggleSwitcher({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, clear: rect.height / 2 + 6 });
      }}
      className={cn(box, 'outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      style={{ width: side, height: side }}
    >
      {drawing}
    </button>
  );
}
