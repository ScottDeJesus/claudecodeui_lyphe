import type { Router } from 'express';

import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';

import { createCompanionRoutes } from './companion.routes.js';
import { companionService } from './companion.service.js';

/**
 * Builds Kaylee's module for the server entrypoint: the router it mounts at `/api/companion` behind
 * `authenticateToken`, and `stop()` for shutdown.
 *
 * `runtime` is the gateway her tools stop a chat, answer its ask and send to it through — the same one the chat
 * socket uses, so an act of hers is the page's own act. It is attached to the service BEFORE the router exists,
 * so no request can reach a verb that has none.
 *
 * Nothing starts here that has to stop other than her conversations, and they start asleep, on an account's first
 * message: building the module launches no process. `stop()` is the service's `stopAll` — each running conversation
 * is interrupted and its input ended, and a message that arrives after it is refused with a 503 — and the entrypoint's
 * shutdown awaits it before it stops anything else.
 */

/** What the entrypoint holds: the router to mount and the stop for shutdown. The return type of `createCompanionModule`, which the entrypoint receives as a value and never names. */
type CompanionModule = { router: Router; stop(): Promise<void> };

/** Consumed by `server/index.ts` (through the barrel), once at boot. */
export function createCompanionModule({ runtime }: { runtime: ProviderRuntimeGateway }): CompanionModule {
  companionService.attachRuntime(runtime);
  return {
    router: createCompanionRoutes(companionService),
    stop: () => companionService.stopAll(),
  };
}
