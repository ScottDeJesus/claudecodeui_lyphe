import { viewOf } from '@/modules/notifications/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionActivity } from '@/shared/companion-types.js';

import { createCompanionStore, type CompanionStore } from './companion-store.js';
import { readCompanionSettings } from './companion-settings.js';
import { createCompanionSession, type CompanionSession } from './session/companion-session.js';
import { IDLE_ACTIVITY } from './session/companion-turns.js';
import { buildCompanionTools } from './tools/companion-tools.js';
import { resolveChat, rosterText } from './tools/house-reads.js';
import { createToolDeps } from './tools/tool-deps.js';

/**
 * One account's Kaylee, assembled: her store, her live conversation and the activity the panel shows, wired to
 * one another. The session reads nothing itself and the tools know nothing of the session, so this is the one
 * place that says which callback of the conversation writes which row and sends which frame:
 *   - a sentence of hers → a `kaylee` log line (the store sends `companion_sentence`);
 *   - a turn's start and end → `companion_turn`;
 *   - her activity → `companion_activity`, and it is held here so the picture can say it;
 *   - her process's condition → `companion_process`;
 *   - a line of the system's → a `system` log line.
 * And the readers a message is assembled from at push time: his settings, her focus, draft and walk, the roster
 * and the chat on his screen.
 *
 * ACTIVITY has two writers, the turn and the tools, and they must not undo each other: `tools/tool-deps.ts` says how.
 * It is HELD here, in one place both write through, so the picture can say what she is doing.
 *
 * Consumer: `companion.service.ts`, which keeps one of these per account in its registry.
 */

/** One account's Kaylee: her `store`, her live `session`, and the `activity` as last announced to the pages. Consumed by `companion.service.ts` and `companion-picture.ts`. */
export type CompanionAccount = {
  readonly userId: number;
  readonly store: CompanionStore;
  readonly session: CompanionSession;
  /** What the pages were last told she is doing. */
  currentActivity(): CompanionActivity;
};

/**
 * The chat on this account's screen with the name she is to call it, or `null` when none is shown or the shown
 * chat is not one she can act on (a chat she cannot resolve is a chat she could not draft for, so naming it would
 * only invite her to try). Read when a message is pushed, never earlier.
 */
function viewedChat(userId: number): { sessionId: string; name: string } | null {
  const sessionId = viewOf(userId);
  if (sessionId === null) return null;
  const chat = resolveChat(sessionId);
  return chat.ok ? { sessionId, name: chat.chat.name } : null;
}

/** Consumed by `companion.service.ts`: one call per account, on the account's first use. Nothing is launched: she is asleep until a message is pushed. */
export function createCompanionAccount(userId: number, runtime: ProviderRuntimeGateway): CompanionAccount {
  const store = createCompanionStore(userId);
  let activity: CompanionActivity = IDLE_ACTIVITY;

  const setActivity = (next: CompanionActivity): void => {
    activity = next;
    store.emit({ kind: 'companion_activity', activity: next });
  };

  const toolDeps = createToolDeps({ userId, store, runtime, activity: { current: () => activity, set: setActivity } });

  const session = createCompanionSession({
    userId,
    tools: buildCompanionTools(toolDeps),
    readSettings: () => readCompanionSettings(userId),
    readState: () => store.readState(),
    readRoster: rosterText,
    readView: () => viewedChat(userId),
    readProviderSessionId: () => store.readState().providerSessionId,
    writeProviderSessionId: (id) => store.setProviderSessionId(id),
    onSentence: (sentence) => {
      store.appendLog({ role: 'kaylee', text: sentence.display, turnId: sentence.turnId, index: sentence.index, mood: sentence.mood, sounds: sentence.sounds });
    },
    onTurnStarted: (turnId) => store.emit({ kind: 'companion_turn', turnId, state: 'started', outcome: null, error: null }),
    onTurnEnded: (turnId, outcome, error) => store.emit({ kind: 'companion_turn', turnId, state: 'ended', outcome, error }),
    onActivity: setActivity,
    onProcess: (process) => store.emit({ kind: 'companion_process', process }),
    onSystemLine: (text) => {
      store.appendLog({ role: 'system', text });
    },
  });

  return {
    userId,
    store,
    session,
    currentActivity: () => activity,
  };
}
