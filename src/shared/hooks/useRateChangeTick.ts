import { useEffect, useState } from 'react';

import { deepseekPeakStatus } from '@/shared/deepseekPeakHours';

/**
 * A timestamp that advances exactly when DeepSeek's rate changes, and at no other time.
 *
 * Used by the composer's Flash chip, which is mounted for as long as a chat is open: a minute tick
 * there would re-render the composer sixty times an hour to repaint a colour that changes four
 * times a day. One timer, set to the next boundary the rule names, re-armed when it fires.
 */
export function useRateChangeTick(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A second past the boundary, so the re-read lands on the far side of it; capped because
    // `setTimeout` overflows past ~24.8 days and a sleeping laptop wakes with a stale timer anyway.
    const wait = Math.min(deepseekPeakStatus(now).changesAt - Date.now() + 1_000, 6 * 3_600_000);
    const timer = setTimeout(() => setNow(Date.now()), Math.max(wait, 1_000));
    return () => clearTimeout(timer);
  }, [now]);

  return now;
}
