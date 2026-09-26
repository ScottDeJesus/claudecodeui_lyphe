import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { DispatcherOffpeak } from '@/shared/types';

/**
 * ONE ask for the whole tab: every card and deck that mounts shares the answer, and it is dropped the moment
 * the time it names has passed, so the next mount asks again for tomorrow's. A failed ask is dropped at once.
 */
let shared: Promise<number | null> | null = null;
let sharedAt: number | null = null;

function askOffpeak(): Promise<number | null> {
  if (shared && (sharedAt === null || sharedAt * 1000 > Date.now())) return shared;
  sharedAt = null;
  shared = api.dispatcher
    .offpeak()
    .then(async (response) => (response.ok ? ((await response.json()) as DispatcherOffpeak).at : null))
    .then((at) => {
      if (typeof at !== 'number') shared = null;
      sharedAt = typeof at === 'number' ? at : null;
      return sharedAt;
    })
    .catch((error: unknown) => {
      console.warn('[useOffpeak] the off-peak request did not complete:', error);
      shared = null;
      return null;
    });
  return shared;
}

/**
 * The dispatcher's next DeepSeek off-peak moment, epoch SECONDS, or `null` until it answers (the `Start at …`
 * button waits for it rather than guessing). The card NEVER computes DeepSeek's clock: the moment is the
 * dispatcher's own (`dispatcher offpeak`, relayed by `GET /api/dispatcher/plans/offpeak`). Re-asked when it
 * passes, so a tab left open across 3 AM offers the next day's time. Used by `ScheduleControl`, on the plan
 * card and the dispatch arc's header.
 */
export function useOffpeak(): number | null {
  const [at, setAt] = useState<number | null>(sharedAt);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    void askOffpeak().then((answer) => {
      if (alive) setAt(answer);
    });
    return () => {
      alive = false;
    };
  }, [generation]);

  useEffect(() => {
    if (at === null) return undefined;
    // `setTimeout` caps at ~24.8 days; the moment is at most a day out, so one timer is enough.
    const timer = window.setTimeout(() => setGeneration((n) => n + 1), Math.max(at * 1000 - Date.now(), 0) + 1000);
    return () => window.clearTimeout(timer);
  }, [at]);

  return at;
}
