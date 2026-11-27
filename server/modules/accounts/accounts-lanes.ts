import { broadcastToAll, laneWatch } from '@/modules/websocket/index.js';
import type { DispatcherStoreWatch } from '@/shared/dispatcher-store-watch.service.js';
import { createPacedHint } from '@/shared/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { AccountsUsageStateEvent, ClaudeUsage } from '@/shared/types.js';

import { onVendorReading, readUsage } from './usage.service.js';

/**
 * The accounts module's two pushes: `accounts_changed`, told when the door's account files move, and
 * `accounts_usage_state`, the usage window's reading, sent only while some socket watches it.
 *
 * Both hang off the store watch's `accounts` lane (`accounts.json`, `chosen.json`). A switch changes
 * whose window the meter reads, so the same event that tells the hint pokes the usage lane.
 */

/** At most one `accounts_changed` per two seconds: a switch rewrites both files in one breath, and each frame costs every tab one read. */
const ACCOUNTS_HINT_GAP_MS = 2_000;

/**
 * The usage window is the one figure here no file announces: the vendor's percentages move with
 * every account's use, so a watched lane reads again three minutes after its last reading. Three
 * minutes is the floor the meter already kept, and the meter's own cache keeps the vendor read
 * at most one per window.
 */
const USAGE_BACKSTOP_MS = 180_000;

/** The lane name a tab's `watch.start` names; no key, since there is one live login per host. */
const USAGE_LANE = 'accounts_usage';

type AccountsUsageFrame = AccountsUsageStateEvent<{ usage: ClaudeUsage }>;

/**
 * `readUsage` stamps `checkedAt` on a pending or degraded answer from the clock of each read, so two
 * readings of one unmoved window would differ; it is left out of the comparison and kept on the wire.
 */
function usageWithoutClock(usage: ClaudeUsage): string {
  return JSON.stringify({ ...usage, checkedAt: null });
}

/** Wires both pushes; called once by the server entrypoint with the store watch every lane shares. */
export function startAccountsLanes(storeWatch: DispatcherStoreWatch, logError: (message: string) => void): void {
  const hint = createPacedHint({ kind: 'accounts_changed', minGapMs: ACCOUNTS_HINT_GAP_MS, send: broadcastToAll });

  // A restarted polled lane re-announces its picture (it forgets what it sent on stop), and this lane
  // restarts whenever its last watcher leaves and the next arrives: a tab whose socket churns would
  // put the same reading on every socket each time. A tab reads the route on mount and on reconnect,
  // so only a window that moved is news; what was last sent is kept here, across restarts.
  let lastSentUsage: string | null = null;
  const sendUsageIfMoved = (frame: AccountsUsageFrame): void => {
    const serialized = usageWithoutClock(frame.usage);
    if (serialized === lastSentUsage) return;
    broadcastToAll(frame);
    lastSentUsage = serialized;
  };

  // A reading the lane takes itself also reaches onVendorReading below. Were it to poke the lane, the
  // poke would land while that reading is still in flight, be owed a replay, and read again: one wasted
  // read on a stamped login, and on a login with no credentials stamp (never served from cache) a loop
  // that never yields the event loop. So the lane's own readings are marked and the listener skips them.
  let isLaneReading = false;
  const readUsageForLane = async (): Promise<ClaudeUsage> => {
    isLaneReading = true;
    try {
      return await readUsage();
    } finally {
      isLaneReading = false;
    }
  };

  const usageLane = createPolledLane<ClaudeUsage, AccountsUsageFrame>({
    snapshot: readUsageForLane,
    frame: (usage) => ({ kind: 'accounts_usage_state', at: Date.now(), usage }),
    serialize: usageWithoutClock,
    broadcast: sendUsageIfMoved,
    backstopMs: USAGE_BACKSTOP_MS,
    logError: (message) => logError(`[accounts usage lane] ${message}`),
  });

  // No socket watching means no vendor read: a poke while unwatched is dropped, and the next
  // watcher's first start reads afresh.
  let isWatched = false;
  laneWatch.define(USAGE_LANE, {
    first: () => {
      isWatched = true;
      usageLane.start();
    },
    last: () => {
      isWatched = false;
      usageLane.stop();
    },
  });

  // A provider reading the route took (a tab's mount or reconnect) reaches every watching tab at once.
  onVendorReading(() => {
    if (isWatched && !isLaneReading) usageLane.poke();
  });

  storeWatch.attach('accounts', () => {
    hint.tell();
    if (isWatched) usageLane.poke();
  });
}
