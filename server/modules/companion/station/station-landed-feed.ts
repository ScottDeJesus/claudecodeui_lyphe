import type { NotificationHistoryRow } from '@/modules/database/index.js';
import { onHistoryKept } from '@/modules/notifications/index.js';
import { sendToUser } from '@/modules/websocket/index.js';
import type { StationFrame } from '@/shared/station-types.js';

import type { CompanionHouse } from '../house.js';

import { dispatcherPictureOrNull, landedOf, LANDED_KIND_BY_CODE, landsThroughLane, planChatOf } from './station-landed.js';

/**
 * A LANDING ARRIVES ON THE EVENT THAT KEEPS IT. The strip "since you last looked" reads the week once (`GET /station/landed`) and
 * then needs to hear what lands. This feed hears the notification history's own write (`onHistoryKept`): after a row is stored,
 * with its id, and with its wording already clear of every figure. A row whose code is one of the four landings
 * (`LANDED_KIND_BY_CODE`) becomes ONE `station_landed { entry }` frame to that account's pages (`sendToUser`); every other row sends
 * nothing. Nothing polls, and no second reader of the runs says what finished: the page is told what the history holds.
 *
 * NO LANDING IS SENT TWICE. The history replaces a repeat ask in place and keeps every other kind as it happens, and only the
 * kept row is announced; a landing is never a replaced repeat, so one stored landing is one frame. The page folds an entry in by
 * its id regardless, so a frame heard twice (a reconnect's re-read racing a frame) still draws once.
 *
 * THE ENTRY IS `landedOf(row, planChat)`, the one reading of a row as a landing, the same function the route's read goes through.
 * For a shipped feature or epic its chat is the dispatcher plan's, so `planChat` reads the lane's picture at that moment
 * (`house.dispatcher()`); a background landing names its own chat and a recovered check none, so those never wait on the lane. A lane
 * that does not answer leaves the entry honestly naming no chat and the frame is still sent: the strip's entry is the news, its chat
 * a convenience. The frames of two landings close together may arrive out of order (one waited on the lane), so each carries its own
 * `id` and `at` for the page to place it by.
 *
 * THE STOP ENDS WHAT IS IN FLIGHT. The unsubscribe stops new rows being heard, and a landing whose lane read was already waiting
 * (up to the lane's first-read wait) is dropped when that read returns, so a module that is winding down tells its pages nothing new.
 *
 * Consumer: `companion.module.ts`, which starts it beside her feeds and stops it with them.
 */

/** Starts hearing the history's kept rows; answers the stop. Consumed by `companion.module.ts`. */
export function startStationLandedFeed(house: CompanionHouse): () => void {
  // Set by the stop. A shipped landing heard before it is still waiting on the lane's picture, and must not be sent after it.
  let stopped = false;

  /** The account's pages hear one frame; a fault building it is logged by the caller with which row it was. */
  async function sendLanding(userId: number, row: NotificationHistoryRow): Promise<void> {
    const picture = landsThroughLane(row.code) ? await dispatcherPictureOrNull(house) : null;
    if (stopped) return;
    const entry = landedOf(row, planChatOf(picture));
    if (entry === null) return;
    const frame: StationFrame = { kind: 'station_landed', entry };
    sendToUser(userId, frame);
  }

  const unsubscribe = onHistoryKept((userId, row) => {
    // The usual row is no landing: it is dropped here before anything is read.
    if (!LANDED_KIND_BY_CODE.has(row.code)) return;
    sendLanding(userId, row).catch((error: unknown) => {
      console.error(`[Station] account ${userId}: the landing of ${row.code} (row ${row.id}) could not be sent to his pages`, error);
    });
  });

  return () => {
    stopped = true;
    unsubscribe();
  };
}
