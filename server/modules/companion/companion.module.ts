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
 * four announcements that a chat changed into the one `station_sessions_changed` frame every open page hears. It starts
 * with the feeds and ends with them. Building the module launches no process: her conversations start asleep, on an
 * account's first message. The one other thing that wakes her is `resendUnanswered`, which the entrypoint calls among the
 * duties of the sole server (after a handover, once the predecessor is gone): the words her last process was given and
 * never answered are said to her again, and she answers them with nobody speaking.
 *
 * `stop()` unsubscribes the feeds and the station's hint FIRST, so nothing new is pushed to a conversation that is winding down, then
 * runs the service's `stopAll` — each running conversation is interrupted and its input ended, and a message that
 * arrives after it is refused with a 503 — beside the face service's `stop`, which aborts the running face bake; the
 * entrypoint's shutdown awaits both before it stops anything else.
 *
 * The face service starts here too (`faceService.start()`): it registers the seed photo, queues the original's bake when it
 * is not made, resumes every account's pending bake and prunes (`face/face.service.ts`). Its work runs in the background and
 * a failure of it is logged; the module serves either way.
 */

/** What the entrypoint holds: the router to mount, `resendUnanswered` for its sole-server duties and the stop for shutdown. The return type of `createCompanionModule`, which the entrypoint receives as a value and never names. */
type CompanionModule = { router: Router; resendUnanswered(): void; stop(): Promise<void> };

/** Consumed by `server/index.ts` (through the barrel), once at boot. */
export function createCompanionModule({ runtime, house }: { runtime: ProviderRuntimeGateway; house: CompanionHouse }): CompanionModule {
  companionService.attachRuntime(runtime, house);
  const stopAlertFeed = startAlertFeed(companionService);
  const stopFocusFeed = startFocusFeed(companionService);
  const stopDeletedChatFeed = startDeletedChatFeed(companionService);
  const stopStationHint = startStationHint();
  faceService.start();
  return {
    router: createCompanionRoutes(companionService),
    resendUnanswered: () => companionService.resendUnanswered(),
    stop: () => {
      stopAlertFeed();
      stopFocusFeed();
      stopDeletedChatFeed();
      stopStationHint();
      // The running bake is aborted beside the sessions' wind-down, so ComfyUI and the bake lock are gone before the process is.
      return Promise.all([companionService.stopAll(), faceService.stop()]).then(() => undefined);
    },
  };
}
