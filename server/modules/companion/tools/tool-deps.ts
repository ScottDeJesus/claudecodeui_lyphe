import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionActivity, CompanionOpenTarget, CompanionSessionRef, CompanionWalk } from '@/shared/companion-types.js';
import { textResult } from '@/shared/tool-text-result.js';

import { createDraftSender } from '../companion-send.js';
import type { CompanionStore } from '../companion-store.js';
import type { CompanionHouse } from '../house.js';
import { THINKING_ACTIVITY } from '../session/companion-turns.js';

import type { CompanionToolDeps } from './companion-tools.js';

/**
 * The helpers the harness hands every tool file (`CompanionToolDeps`), so each tool behaves the same way
 * without doing the work itself (`house` rides beside them: the readers only a module instance holds, handed in by
 * the entrypoint and passed through untouched, `house.ts`):
 *   - `setFocus`: a tool that names a chat makes it her FOCUS — inferred here, never a tool of its own. The
 *     focus is rewritten, and announced to the pages, only when the chat moved or was renamed;
 *   - `withActivity`: while a tool runs her activity is the tool's (what the panel's status line says), and
 *     when it ends she is `thinking` again (or back at a parallel tool still running);
 *   - `openOnFloor`: "the app brings that chat, card, page or check up" is told to the page that holds the floor ALONE
 *     (`companion_open` carries its client id and the spoken `label` the door resolved; every other page ignores it),
 *     and to nobody while no page holds the floor;
 *   - `refuse`: a refusal is `isError` text that says what to do next, never a throw;
 *   - `sendDraft`: the one door the draft goes out by (`companion-send.ts`), built on the two helpers above.
 *
 * ACTIVITY has two writers, and they must not undo each other. The turn sets `thinking` as it starts and
 * `idle` as it ends; a tool sets its own while it runs. A tool changes the activity at its end ONLY when its own
 * activity is still the one standing: if she was stopped meanwhile, the turn's `idle` stands, and a tool that
 * finishes late must not make her look busy again. She calls tools in parallel, so the tools still running are
 * kept in the order they began: when the one standing ends, the activity goes back to the newest of those
 * (the earlier tool is still reading), and to `thinking` only when none is left. A tool that ends while another
 * one's activity stands changes nothing.
 *
 * Consumer: `companion-account.ts`, which builds one set per account around the activity it holds.
 */

/**
 * Where an account's activity is held and announced. Both writers go through `set`, which records the
 * activity and sends `companion_activity`; `current` is the one the pages were last told. Consumed by
 * `companion-account.ts`, which owns the state, and by `createToolDeps` here.
 */
export type ActivityHolder = { current(): CompanionActivity; set(next: CompanionActivity): void };

/** The place a walk has reached, as an activity states it: `null` when no walk is held. */
const placeOf = (walk: CompanionWalk | null): CompanionActivity['walk'] => (walk === null ? null : { at: walk.at, total: walk.items.length });

/** Whether two refs name the same chat the same way. */
const sameRef = (a: CompanionSessionRef, b: CompanionSessionRef | null): boolean =>
  b !== null && a.sessionId === b.sessionId && a.name === b.name && a.project === b.project;

/** Consumed by `companion-account.ts`: one call per account, with that account's store, the gateway, the entrypoint's house and its activity holder. */
export function createToolDeps(input: {
  userId: number;
  store: CompanionStore;
  runtime: ProviderRuntimeGateway;
  house: CompanionHouse;
  activity: ActivityHolder;
}): CompanionToolDeps {
  const { userId, store, runtime, house, activity } = input;
  // The activities of the tools still running, oldest first: what the status line goes back to when the one standing ends.
  const running: CompanionActivity[] = [];
  const setFocus = (chat: CompanionSessionRef): void => {
    if (!sameRef(chat, store.readState().focus)) store.setFocus(chat);
  };
  const openOnFloor = (target: CompanionOpenTarget, label: string): void => {
    const { floor } = store.readState();
    if (floor !== null) store.emit({ kind: 'companion_open', target, floor, label });
  };
  return {
    userId,
    store,
    runtime,
    house,
    setFocus,
    openOnFloor,
    sendDraft: createDraftSender({ userId, store, runtime, setFocus, openOnFloor }),
    async withActivity(phase, chat, files, run) {
      const mine: CompanionActivity = { phase, session: chat, files, walk: phase === 'walking' ? placeOf(store.readState().walk) : null };
      running.push(mine);
      activity.set(mine);
      try {
        return await run();
      } finally {
        running.splice(running.indexOf(mine), 1);
        if (activity.current() === mine) activity.set(running.at(-1) ?? THINKING_ACTIVITY);
      }
    },
    refuse: (sentence) => textResult(sentence, true),
  };
}
