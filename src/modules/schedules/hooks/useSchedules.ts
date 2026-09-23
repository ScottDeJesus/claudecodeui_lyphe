import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { CronRegistrySnapshot, CronSyncReport } from '@/shared/types';

/**
 * One read of the registry — the whole answer the schedules read route gives. It answers a bare
 * `CronRegistrySnapshot` with no envelope, straight out of the tables and nothing else, so there
 * is no second thing to unwrap and no state for this module to map. The path itself is spelled in
 * `src/shared/api.ts` and nowhere else.
 */
async function readSnapshot(): Promise<CronRegistrySnapshot> {
  const response = await api.schedules.list();
  if (!response.ok) throw new Error(`the registry route answered ${response.status}`);
  return (await response.json()) as CronRegistrySnapshot;
}

/**
 * The Schedules tab's data: the registry as the server's last sync wrote it, read once when the
 * tab opens, and re-read after the one control this screen has.
 *
 * READ ON MOUNT, NEVER ON A TIMER. A panel unmounts when its tab is left, so mounting genuinely
 * means the operator just opened it — a poll would only fetch behind a tab he is looking at, and a
 * registry that is stale while open already says so in the header, from the last sync's own age.
 * Refresh is the way to make it newer.
 *
 * The house convention for a panel that owns its data is `useEffect` + `useState` (there is no
 * react-query or SWR here); the module-level store plus `useSyncExternalStore` is for the one
 * thing several panels read, which this is not.
 */
export function useSchedules(): {
  snapshot: CronRegistrySnapshot | null;
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => void;
} {
  // The registry as the last read left it. `null` until one lands — "not read yet" and "no jobs
  // are tracked" are two different answers, and the panel draws them as a spinner and as an empty
  // state respectively.
  const [snapshot, setSnapshot] = useState<CronRegistrySnapshot | null>(null);
  // True only while the FIRST read is out: it owns the spinner, and a re-read behind rows already
  // on screen must never be mistaken for a screen with nothing to show.
  const [loading, setLoading] = useState(true);
  // True across a sync AND the re-read that follows it, so the one button can show it is working
  // for the whole round trip rather than for its first half.
  const [syncing, setSyncing] = useState(false);
  // The read's or the sync's failure, in words the panel prints BESIDE whatever rows it kept —
  // a failed refresh never blanks the last good read, so the message must not be the only thing
  // left on screen either.
  const [error, setError] = useState<string | null>(null);
  // Unmount guard: the panel goes the moment its tab is left, so an answer that lands after that
  // must not set state on a component that is gone.
  const mountedRef = useRef(true);

  /** One read of the registry. Never throws: a failure lands in `error`, where a reader sees it. */
  const load = useCallback(async () => {
    try {
      const next = await readSnapshot();
      if (mountedRef.current) {
        setSnapshot(next);
        setError(null);
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  /**
   * The one control: run a sync, then re-read the registry, so the rows and the fresh counts land
   * together. The POST is the point — a bare re-GET would answer the same rows and the button
   * would appear to do nothing.
   */
  const runSync = useCallback(async () => {
    if (mountedRef.current) {
      setSyncing(true);
      setError(null);
    }
    try {
      const response = await api.schedules.sync();
      if (!response.ok) throw new Error(`the sync route answered ${response.status}`);
      const report = (await response.json()) as CronSyncReport;
      // Re-read EITHER WAY: a sync that reports a failure still ran, and what it did or did not
      // write is the honest answer for the rows. Only a sync that never answered skips the read,
      // in which case the rows already on screen stay exactly as they were.
      const next = await readSnapshot();
      if (mountedRef.current) {
        setSnapshot(next);
        // A run that died is reported IN THE BODY (`{ ok: false, error }` with a 200), so the
        // status code could never carry it — the report's own verdict is what this button shows.
        setError(report.ok ? null : report.error ?? 'The sync reported a failure');
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, []);

  // The button's handler: an async control handed to `onClick`, so it answers with nothing and
  // any failure is a message on screen rather than a rejection nobody awaits.
  const refresh = useCallback(() => void runSync(), [runSync]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { snapshot, loading, syncing, error, refresh };
}
