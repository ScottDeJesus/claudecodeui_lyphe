import { useCallback, useSyncExternalStore } from 'react';

import {
  getJevSwitchesSnapshot,
  refreshJevSwitches,
  subscribeJevSwitches,
  writeJevMaster,
  writeJevScope,
  type JevScopeName,
  type JevSwitchesSnapshot,
} from '@/shared/hooks/jevSwitchesStore';

/**
 * The narrower opt-ins and the name of one, re-exported from the store so a surface keeps one import.
 *
 * `JevContent.tsx` draws a row per entry of `JEV_SCOPES`, and `JevControls.tsx` types its own rows
 * with `JevScopeName`; both reach them here, which is where they have always reached them.
 */
export { JEV_SCOPES } from '@/shared/hooks/jevSwitchesStore';
export type { JevScopeName } from '@/shared/hooks/jevSwitchesStore';

/** The switches as a surface draws them, and the three ways of acting on them. */
type JevSwitches = JevSwitchesSnapshot & {
  /** Move the master switch — the file that decides whether anything leaves this machine at all. */
  setMaster: (next: boolean) => Promise<void>;
  /** Move one narrower opt-in. Its stored value is kept and shown even while the master is off. */
  setScope: (scope: JevScopeName, next: boolean) => Promise<void>;
  /** Ask the server again — the way out of an unreadable set of rows, and the only press a control
   * with no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * The house Jev switches, read and written from one place.
 *
 * They are flag FILES on this host, read by Python at call time, which is why every read here is a
 * request to the server rather than a value the browser already holds — and why the write RE-READS
 * instead of echoing what was asked for.
 *
 * The state is ONE shared store (`jevSwitchesStore.ts`), so every surface that mounts this hook draws
 * the same positions — a flip on any of them reaches the others the moment the server confirms it.
 */
export function useJevSwitches(): JevSwitches {
  // Subscribed, never copied: the store owns the position, this run only redraws on the store's word.
  // `getJevSwitchesSnapshot` returns the same reference until something changes, which is what keeps
  // `useSyncExternalStore` from looping and what makes a changed reference mean a changed screen.
  const snapshot = useSyncExternalStore(subscribeJevSwitches, getJevSwitchesSnapshot);

  const setMaster = useCallback((next: boolean) => writeJevMaster(next), []);
  // One setter for every scope rather than one per scope: the patch names the scope it moves, and a
  // scope added to the list needs nothing here.
  const setScope = useCallback((scope: JevScopeName, next: boolean) => writeJevScope(scope, next), []);
  const refresh = useCallback(() => refreshJevSwitches(), []);

  return { ...snapshot, setMaster, setScope, refresh };
}
