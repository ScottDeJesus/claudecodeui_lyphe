import type { Router } from 'express';

import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { createCompanionRoutes } from './companion.routes.js';
import { companionService } from './companion.service.js';
import { faceService } from './face/face.service.js';
import { startAlertFeed } from './feeds/alert-feed.js';
import { startDeletedChatFeed } from './feeds/deleted-chat-feed.js';
import { startFocusFeed } from './feeds/focus-feed.js';
import type { CompanionHouse } from './house.js';
import { startStationHint } from './station/station-hint.js';
import { startStationLandedFeed } from './station/station-landed-feed.js';

/**
 * Builds Kaylee's module for the server entrypoint: the router it mounts at `/api/companion` behind
 * `authenticateToken`, and `stop()` for shutdown.
 *
 * `runtime` is the gateway her tools stop a chat, answer its ask and send to it through — the same one the chat
 * socket uses, so an act of hers is the page's own act. `house` is the readers only a module instance holds: the
 * roadmap and dispatcher pictures, a card's text, the souls lane's launches, Cerberus's overview and the heal service
 * (`house.ts`). The entrypoint builds her AFTER those modules for exactly that reason, and hands the house in the way it
 * hands the gateway. Both are attached to the service BEFORE the router exists, so no request can reach a verb that
 * has either missing.
 *
 * The two feeds start here, so what she hears unasked is live the moment the module is: the alert feed (the
 * house's notifications, while Live is on) and the focus feed (the focus chat's finished runs). Both are
 * subscriptions to events the house already raises — nothing polls — and both cost nothing for an account whose
 * Live is off. A third subscription tells her nothing: when the chat she is focused on is deleted her focus ends
 * (`startDeletedChatFeed`). A fourth is not hers at all: Kaylee Station's hint (`startStationHint`), which coalesces the
 * six announcements that a chat changed into the `station_sessions_changed` frames every open page hears; a fifth is the
 * station's landed feed (`startStationLandedFeed`), which turns each row the notification history keeps that is a landing
 * into one `station_landed` frame to that account's pages. Both start with the feeds and end with them. Building the module
 * launches no process: her conversations start asleep, on an account's first message. The one other thing that wakes her is
 * `resendUnanswered`, which the entrypoint calls among the duties of the sole server (after a handover, once the predecessor
 * is gone): the words her last process was given and never answered are said to her again, and she answers them with nobody
 * speaking.
 *
 * `stop(turnBoundMs, sentenceBoundMs)` unsubscribes the feeds, the station's hint and its landed feed FIRST, so nothing new is pushed to a conversation
 * that is winding down, then runs the service's `stopAll` — a turn in flight is let to finish, at most `turnBoundMs`, then each running
 * conversation is interrupted and its input ended (after the sentences still streaming have finished, at most `sentenceBoundMs`), and a message that arrives after it is refused with a 503 — beside the face
 * service's `stop`, which aborts the running face bake. The entrypoint starts it FIRST (the refusal is in force before anything else
 * stops) and awaits it LAST, so the rest of the shutdown does not sit behind her turn; only the process's exit does.
 *
 * ON A HANDOVER BOOT (`awaitingTakeover`) her sessions hold every push until `resendUnanswered`, the takeover: the retiring server still
 * has her CLI, and a second one on the same conversation would fork it. The hold ends at the takeover, or at `TAKEOVER_HOLD_MAX_MS` if no takeover
 * ever comes (the supervisor is gone): by then the supervisor has killed the predecessor, so nothing is answering any more.
 *
 * The face service starts here too (`faceService.start()`): it registers the house's avatars, queues the bake of each whose face
 * is not made, resumes every account's pending bake and prunes (`face/face.service.ts`). Its work runs in the background and
 * a failure of it is logged; the module serves either way.
 */

/** What the entrypoint holds: the router to mount, `resendUnanswered` for its sole-server duties and the stop for shutdown. The return type of `createCompanionModule`, which the entrypoint receives as a value and never names. */
type CompanionModule = { router: Router; resendUnanswered(): void; stop(turnBoundMs: number, sentenceBoundMs: number): Promise<void> };

/**
 * The longest a handover boot holds her pushes waiting for a takeover that never comes: a boot (30 s at most, `BOOT_TIMEOUT_MS`) and then the
 * SIGKILL the supervisor sends a retiring server 75 s after its SIGTERM (`STOP_TIMEOUT_MS`, `deploy/dev-supervisor/child.mjs`), which follows this
 * boot's READY at once; past this the predecessor is gone, whatever became of the supervisor.
 */
const TAKEOVER_HOLD_MAX_MS = 110_000;

/** Consumed by `server/index.ts` (through the barrel), once at boot. `awaitingTakeover` is the entrypoint's `handover` bit. */
export function createCompanionModule({ runtime, house, awaitingTakeover }: { runtime: ProviderRuntimeGateway; house: CompanionHouse; awaitingTakeover: boolean }): CompanionModule {
  companionService.attachRuntime(runtime, house, awaitingTakeover);
  const takeover = (): void => companionService.resendUnanswered();
  // One timer, armed once and only on a handover boot, for the case where the event never comes; it never keeps the process alive.
  const holdLimit = awaitingTakeover
    ? setTimeout(() => {
        console.warn(`[Companion] no takeover after ${TAKEOVER_HOLD_MAX_MS / 1000} s; her held pushes are let go`);
        takeover();
      }, TAKEOVER_HOLD_MAX_MS)
    : null;
  holdLimit?.unref();
  const stopAlertFeed = startAlertFeed(companionService, house);
  const stopFocusFeed = startFocusFeed(companionService);
  const stopDeletedChatFeed = startDeletedChatFeed(companionService);
  const stopStationHint = startStationHint();
  const stopStationLandedFeed = startStationLandedFeed(house);
  faceService.start();
  return {
    router: createCompanionRoutes(companionService),
    resendUnanswered: () => {
      if (holdLimit !== null) clearTimeout(holdLimit);
      takeover();
    },
    stop: (turnBoundMs, sentenceBoundMs) => {
      stopAlertFeed();
      stopFocusFeed();
      stopDeletedChatFeed();
      stopStationHint();
      stopStationLandedFeed();
      // The running bake is aborted beside the sessions' wind-down, so ComfyUI and the bake lock are gone before the process is.
      return Promise.all([companionService.stopAll(turnBoundMs, sentenceBoundMs), faceService.stop()]).then(() => undefined);
    },
  };
}
