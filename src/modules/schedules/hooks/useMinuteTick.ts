import { useEffect, useState } from 'react';

/**
 * A timestamp that advances once a minute, so the sync's age and every "ago" on the panel stay
 * true while the tab is open.
 *
 * The interval lives and dies with the component that calls this, and the only caller is the
 * Schedules panel — which is mounted ONLY while its tab is active (`WorkspaceMain` gates it the
 * same way it gates the accounts panel). So nothing ticks behind a closed tab. This is a RENDER
 * clock and not a poll: it fetches nothing, and it is the only thing on this screen that fires on
 * a timer at all.
 *
 * The first tick is aligned to the next real minute boundary rather than set a flat 60s from
 * mount: `syncFreshness` turns the header amber the moment the last sync crosses one hour, and a
 * clock that ran 40 seconds behind the wall would hold it amber for a minute it never earned.
 *
 * Module-private on purpose, in the shape of `src/modules/accounts/hooks/useMinuteTick.ts` and not
 * an import of it: this module's barrel exports the panel and nothing else, and a shared clock
 * would be a second public surface for every panel that ever wants one.
 */
export function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const alignment = setTimeout(() => {
      setNow(Date.now());
      interval = setInterval(() => setNow(Date.now()), 60_000);
    }, msToNextMinute);

    return () => {
      clearTimeout(alignment);
      if (interval) clearInterval(interval);
    };
  }, []);

  return now;
}
