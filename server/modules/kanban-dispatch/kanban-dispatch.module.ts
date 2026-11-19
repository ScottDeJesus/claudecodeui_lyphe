import type { Router } from 'express';

import { onKanbanWrite } from '@/modules/kanban/index.js';
import { sessionlessEnv } from '@/shared/child-env.js';
import { dispatcherBin } from '@/shared/dispatcher-command.js';
import type { DispatcherStoreWatch } from '@/shared/dispatcher-store-watch.service.js';

import { createNoteApplier } from './kanban-dispatch.apply.js';
import { createKanbanDispatchRouter } from './kanban-dispatch.routes.js';
import { createCardTeller } from './kanban-dispatch.tell.js';

/**
 * Ceiling for `card notes`, `card applied`, and `card config`. Each is one
 * store read or one write, so anything near this limit is a hang.
 */
const VERB_TIMEOUT_MS = 20_000;

/**
 * Ceiling for `card told`. It sorts a new card before it answers: Jev, and
 * when Jev is not sure, one tool-less Haiku child. This is the sort's worst
 * case, not its usual second or two.
 */
const TELL_TIMEOUT_MS = 180_000;

/**
 * What the server mounts and drives: the router for the board's dispatch API,
 * and the start/stop pair the server calls around its listen lifecycle.
 */
export type KanbanDispatchModule = { router: Router; start(): void; stop(): void };

/**
 * Composition root for the board-dispatch module. The board tells the
 * dispatcher what a person did to a card of a self-running board, and the
 * applier writes back the notes the dispatcher's card walks owe the board.
 * The server never opens a file under the dispatcher's home: it runs the
 * `dispatcher card ...` verbs and reads what they print.
 */
export function createKanbanDispatchModule(
  storeWatch: DispatcherStoreWatch,
): KanbanDispatchModule {
  const commands = { bin: dispatcherBin(), timeoutMs: VERB_TIMEOUT_MS, env: sessionlessEnv() };
  const teller = createCardTeller({
    commands: { ...commands, timeoutMs: TELL_TIMEOUT_MS },
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  });
  // Subscribed at construction, not in start: a write can reach the board from
  // the moment the server listens, before start runs in the listen callback,
  // and a person's card created in that gap must still be told.
  let unsubscribe: (() => void) | null = onKanbanWrite(teller);
  const applier = createNoteApplier({ commands, log: (line) => console.error(line) });
  const router = createKanbanDispatchRouter({ commands });
  let detach: (() => void) | null = null;

  /**
   * Watches the status lane because the notes table lives in the dispatcher's
   * store and its board counter counts it. Pokes once so notes written while
   * this server was down are applied now.
   */
  function start(): void {
    detach ??= storeWatch.attach('status', () => applier.poke());
    applier.poke();
  }

  /**
   * Unsubscribes and detaches before stopping the applier, so no new write or
   * store change reaches a poke once the applier is stopping.
   */
  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
    detach?.();
    detach = null;
    applier.stop();
  }

  return { router, start, stop };
}
