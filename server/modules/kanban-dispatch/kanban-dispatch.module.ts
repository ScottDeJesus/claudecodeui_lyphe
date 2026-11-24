import type { Router } from 'express';

import { onKanbanWrite, type KanbanWriteEvent } from '@/modules/kanban/index.js';
import { sessionlessEnv } from '@/shared/child-env.js';
import { dispatcherBin } from '@/shared/dispatcher-command.js';
import type { DispatcherStoreWatch } from '@/shared/dispatcher-store-watch.service.js';
import { expandHome } from '@/shared/utils.js';

import { createNoteApplier } from './kanban-dispatch.apply.js';
import { createKanbanDispatchRouter } from './kanban-dispatch.routes.js';
import { createCardTeller } from './kanban-dispatch.tell.js';

/** The actor the start's catch-up tells as: no person pressed anything, CloudCLI itself is telling. */
const START_ACTOR = 'cloudcli';

/**
 * Ceiling for `card notes`, `card applied`, and `card config`. Each is one
 * store read or one write, so anything near this limit is a hang. It is also
 * the ceiling of the dashboard's two reads (`cases stats`, `bug stats`), each
 * a pure store read of about a second.
 */
const VERB_TIMEOUT_MS = 20_000;

/**
 * Ceiling for `card told`. It sorts a new card before it answers: Jev, and
 * when Jev is not sure, one tool-less Haiku child. This is the sort's worst
 * case, not its usual second or two. It is also the ceiling for `bug placed`,
 * the placing stamp, which on a board that runs itself sorts the new card the
 * same way before it answers.
 */
const TELL_TIMEOUT_MS = 180_000;

/** The regression cases' one door, unless the operator moved it (`CASES_BIN`) — the roadmap module composes the same binary. */
const DEFAULT_CASES_BIN = '~/.claude/scripts/cases';

/**
 * Whether a board write may have given a waiting ticket a board: a board created, or a board whose folders
 * (`repos`) changed or that came back from the archive. Only then is the placing pass asked to look again
 * at the tickets no board could take; any other write leaves them as they were.
 */
function mayPlaceWaitingTickets(write: KanbanWriteEvent): boolean {
  if (write.kind === 'board.created') return true;
  if (write.kind !== 'board.updated') return false;
  const fields: unknown = write.payload.fields;
  return Array.isArray(fields) && fields.some((field: unknown) => field === 'repos' || field === 'archived');
}

/**
 * What the server mounts and drives: the router for the board's dispatch API,
 * and the start/stop pair the server calls around its listen lifecycle.
 */
export type KanbanDispatchModule = { router: Router; start(): void; stop(): void };

/**
 * Composition root for the board-dispatch module. The board tells the
 * dispatcher what a person did to a card of a self-running board, and the
 * applier writes back the notes the dispatcher's card walks owe the board.
 * The applier also places the bug tickets the house files (`dispatcher bug pending`, then `dispatcher bug placed`) on the board whose folders hold each ticket's path.
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
  let unsubscribe: (() => void) | null = onKanbanWrite(teller.onWrite);
  const applier = createNoteApplier({ commands, ticketStampCommands: { ...commands, timeoutMs: TELL_TIMEOUT_MS }, log: (line) => console.error(line) });
  // The placing pass's wake for a ticket waiting on a board (an event, never a sweep).
  let unsubscribeBoards: (() => void) | null = onKanbanWrite((write) => {
    if (mayPlaceWaitingTickets(write)) applier.pokeWithUnplaced();
  });
  // The dashboard's cases part runs through the cases door, its own binary, with the module's timeout and child environment; a failure's sentence leads with `cases`.
  const casesCommands = { ...commands, bin: expandHome(process.env.CASES_BIN || DEFAULT_CASES_BIN), door: 'cases' };
  const router = createKanbanDispatchRouter({ commands, dashboard: { dispatcher: commands, cases: casesCommands } });
  let detach: (() => void) | null = null;

  /**
   * Watches the status lane because the notes table lives in the dispatcher's
   * store and its board counter counts it. Pokes once so notes written while
   * this server was down are applied now. The first pass also takes the
   * tickets no board could take while the server was down.
   */
  function start(): void {
    detach ??= storeWatch.attach('status', () => applier.poke());
    applier.pokeWithUnplaced();
    tellApprovedTodo();
  }

  /**
   * The start's catch-up: a self-running board's To Do cards that no switch-on reached are approved work
   * (operator, 11-18), so each is told board-on. A failure is logged and never stops the start.
   */
  function tellApprovedTodo(): void {
    try {
      const told = teller.tellSelfRunningTodo(START_ACTOR);
      console.log(`[kanban-dispatch] start: board-on told for ${told} To Do card(s) of the self-running boards`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[kanban-dispatch] start: could not tell the self-running boards' To Do cards: ${reason}`);
    }
  }

  /**
   * Unsubscribes and detaches before stopping the applier, so no new write or
   * store change reaches a poke once the applier is stopping.
   */
  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribeBoards?.();
    unsubscribeBoards = null;
    detach?.();
    detach = null;
    applier.stop();
  }

  return { router, start, stop };
}
