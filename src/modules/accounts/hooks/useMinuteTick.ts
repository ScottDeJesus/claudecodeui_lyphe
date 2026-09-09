import { useEffect, useState } from 'react';

/**
 * A timestamp that advances once a minute, so a countdown rendered from it stays true.
 *
 * The interval lives and dies with the component that calls this, and the only caller is the
 * account panel — which is mounted ONLY while it is open. So nothing ticks behind a closed
 * panel, and no reading is ever a minute older than the panel has been open.
 *
 * The first tick is aligned to the next real minute boundary rather than set a flat 60s from
 * mount: a countdown that turns over 40 seconds after the clock does is a countdown that reads
 * one minute high for two thirds of every minute.
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
