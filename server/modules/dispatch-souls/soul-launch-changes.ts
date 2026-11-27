/**
 * The launcher lane's change, said where it is sent: the lane broadcasts `soul_launch_state` only when its picture moved, so each
 * broadcast is one change of what the launcher souls are doing. The running-sessions lane hears it, because a hand-dispatched soul
 * ending is what puts out its chat's subagent dot. A listener that throws costs only itself.
 */

const soulLaunchListeners = new Set<() => void>();

/** Subscribes to the launcher's changes; answers the unsubscribe. */
export function onSoulLaunchesChanged(listener: () => void): () => void {
  soulLaunchListeners.add(listener);
  return () => {
    soulLaunchListeners.delete(listener);
  };
}

/** Tells every listener the launcher's picture moved. Called by `dispatch-souls.module.ts`'s broadcast only. */
export function announceSoulLaunchesChanged(): void {
  for (const listener of soulLaunchListeners) {
    try {
      listener();
    } catch (error) {
      console.error(`[DispatchSouls] a launch-change listener failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
