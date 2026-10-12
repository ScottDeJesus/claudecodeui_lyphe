import { useEffect, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/**
 * The browser's clock, read again every `tickMs` (a second by default) while the caller stands, as epoch
 * ms. The header's "Live HH:MM:SS" and its "last result 12 s ago" both count from it, so the two never
 * disagree by a tick.
 *
 * The tick runs on the window the reader is looking at (`useHostWindow()`): a hidden opener throttles
 * its timers to about one a minute, and a seconds clock would stutter in a floating window.
 *
 * Used by `CerberusHeader`, whose words move with the second, by `FixOutput`, which counts a running fix's
 * seconds, and by `CatalogView`, which only needs to know when an entry's hour as new is up.
 */
export function useClock(tickMs = 1000): number {
  const hostWindow = useHostWindow();

  // The clock's own reading. Essential and not derivable: nothing else re-renders the header when a
  // second passes, and the pill's time and the age both change for no other reason.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = hostWindow.setInterval(() => setNow(Date.now()), tickMs);
    return () => hostWindow.clearInterval(timer);
  }, [hostWindow, tickMs]);

  return now;
}
