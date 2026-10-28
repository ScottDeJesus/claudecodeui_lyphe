import type { Router } from 'express';

import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { createCompanionRoutes } from './companion.routes.js';
import { companionService } from './companion.service.js';
import { startAlertFeed } from './feeds/alert-feed.js';
import { startFocusFeed } from './feeds/focus-feed.js';

/**
 * Builds Kaylee's module for the server entrypoint: the router it mounts at `/api/companion` behind
 * `authenticateToken`, and `stop()` for shutdown.
 *
 * `runtime` is the gateway her tools stop a chat, answer its ask and send to it through — the same one the chat
 * socket uses, so an act of hers is the page's own act. It is attached to the service BEFORE the router exists,
 * so no request can reach a verb that has none.
 *
 * The two feeds start here, so what she hears unasked is live the moment the module is: the alert feed (the
 * house's notifications, while Live is on) and the focus feed (the focus chat's finished runs). Both are
 * subscriptions to events the house already raises — nothing polls — and both cost nothing for an account whose
 * Live is off. Building the module launches no process: her conversations start asleep, on an account's first
 * message.
 *
 * `stop()` unsubscribes the feeds FIRST, so nothing new is pushed to a conversation that is winding down, then
 * runs the service's `stopAll` — each running conversation is interrupted and its input ended, and a message that
 * arrives after it is refused with a 503 — and the entrypoint's shutdown awaits it before it stops anything else.
 */

/** What the entrypoint holds: the router to mount and the stop for shutdown. The return type of `createCompanionModule`, which the entrypoint receives as a value and never names. */
type CompanionModule = { router: Router; stop(): Promise<void> };

/** Consumed by `server/index.ts` (through the barrel), once at boot. */
export function createCompanionModule({ runtime }: { runtime: ProviderRuntimeGateway }): CompanionModule {
  companionService.attachRuntime(runtime);
  const stopAlertFeed = startAlertFeed(companionService);
  const stopFocusFeed = startFocusFeed(companionService);
  return {
    router: createCompanionRoutes(companionService),
    stop: () => {
      stopAlertFeed();
      stopFocusFeed();
      return companionService.stopAll();
    },
  };
}
