import { useEffect, useState } from 'react';

/** One minute, the width of a strip's cell, in ms. */
const MINUTE_MS = 60_000;

/** The minute an epoch moment is inside, as the epoch ms it began. */
function minuteOf(at: number): number {
  return Math.floor(at / MINUTE_MS) * MINUTE_MS;
}

/**
 * The minute the browser's clock is in, as the epoch ms it began, moved at each minute boundary. The strips are
 * re-windowed on it from the reading held (`rewindowCells`), so a strip slides on the minute without a read. One
 * deadline at a time, armed for the next boundary when the minute changes; a deadline that fires a hair early
 * still moves on to the next minute.
 *
 * Used by `CerberusProvider` (the overview's strips) and `useCheckDetail` (the open sheet's live strip).
 */
export function useMinute(): number {
  // The minute shown. Essential: nothing else re-renders a strip when a minute passes with nothing written.
  const [minute, setMinute] = useState(() => minuteOf(Date.now()));

  useEffect(() => {
    const next = minute + MINUTE_MS;
    const timer = window.setTimeout(() => setMinute(Math.max(minuteOf(Date.now()), next)), next - Date.now());
    return () => window.clearTimeout(timer);
  }, [minute]);

  return minute;
}
