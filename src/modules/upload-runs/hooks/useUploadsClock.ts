import { useEffect, useState } from 'react';

import { useHostWindow } from '@/shared/context/HostWindowContext';

/** A live run's elapsed time moves by the second. */
const TICK_MS = 1000;

/**
 * The clock every age and a live run's elapsed time in the Uploads view are counted from, as epoch ms. It is read afresh
 * every time the view is shown and every time a read of the overview SETTLES, whether it answered or failed (`readAt` moves
 * on each), so an age is counted from the moment the screen last asked the engine. That is what lets the stale strip say how
 * old the answer on screen is: a read that failed leaves the answer's own stamp where it was, and only the clock moving tells
 * the hours since. It ticks once a second ONLY while `ticking` (a run is live). Otherwise it holds no timer at all: a view
 * that is hidden, or has no run going, stands still and costs nothing (MAN-8918).
 *
 * It is the sibling of `useElapsed` (`@/shared/hooks/useElapsed`), which this view cannot use as it is: that hook hands back
 * a string in the chat composer's spelling ("4m 3s"), and this view counts every age and duration from one number, in its own
 * words (`cerberus.uploads.duration.*`), so a live run's length reads the same in its card, its row and its sheet. The
 * interval is the same one, on the window the reader is looking at (`useHostWindow`).
 *
 * Used by this module's root, `UploadsView`.
 */
export function useUploadsClock(shown: boolean, ticking: boolean, readAt: number): number {
  const hostWindow = useHostWindow();
  // The clock's own reading. Essential and not derivable: nothing else re-renders the view when a second passes.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!shown) return undefined;
    const read = () => setNow(Date.now());
    // Read once on the way in as well as on the tick: a view just shown, or a read just settled, must not wait a second (or
    // for ever, with no run to tick for) to stop counting from the moment it was last on screen.
    read();
    if (!ticking) return undefined;
    const timer = hostWindow.setInterval(read, TICK_MS);
    return () => hostWindow.clearInterval(timer);
  }, [shown, ticking, readAt, hostWindow]);

  return now;
}
