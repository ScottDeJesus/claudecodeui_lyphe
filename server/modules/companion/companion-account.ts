import { viewOf } from '@/modules/notifications/index.js';
import { readVoiceSettings } from '@/modules/voice/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionActivity } from '@/shared/companion-types.js';

import type { DraftSender } from './companion-send.js';
import { createSpeechCache, type SpeechCache } from './companion-speech-cache.js';
import { createCompanionStore, type CompanionStore } from './companion-store.js';
import { readCompanionSettings } from './companion-settings.js';
import type { CompanionHouse } from './house.js';
import { createCompanionSession } from './session/companion-session.js';
import type { CompanionSession } from './session/companion-session-types.js';
import { IDLE_ACTIVITY } from './session/companion-turns.js';
import { buildCompanionTools } from './tools/companion-tools.js';
import { resolveChat, rosterText } from './tools/house-reads.js';
import { createToolDeps } from './tools/tool-deps.js';

/**
 * One account's Kaylee, assembled: her store, her live conversation and the activity the panel shows, wired to
 * one another. The session reads nothing itself and the tools know nothing of the session, so this is the one
 * place that says which callback of the conversation writes which row and sends which frame:
 *   - a sentence of hers → a `kaylee` log line (the store sends `companion_sentence`);
 *   - a turn's start → the speech cache's new current turn, then `companion_turn`; its end → `companion_turn`;
 *   - her activity → `companion_activity`, and it is held here so the picture can say it;
 *   - her process's condition → `companion_process`;
 *   - a line of the system's → a `system` log line.
 * And the readers a message is assembled from at push time: his settings, her focus, draft and walk, the roster,
 * the chat on his screen and the sounds she may make (the voice settings' sound-tag list).
 *
 * THE HOUSE (`house.ts`) is handed in by the server entrypoint through `companion.module.ts` and the service, and passes
 * through here untouched to the tools as `CompanionToolDeps.house`: the readers only a module instance holds (the
 * roadmap and dispatcher pictures, a card's text, the souls lane's launches, Cerberus's overview, the heal service).
 * Nothing in the account reads it; only the tools do.
 *
 * ACTIVITY has two writers, the turn and the tools, and they must not undo each other: `tools/tool-deps.ts` says how.
 * It is HELD here, in one place both write through, so the picture can say what she is doing.
 *
 * Consumer: `companion.service.ts`, which keeps one of these per account in its registry.
 */

/**
 * One account's Kaylee: her `store`, her live `session`, the `speechCache` of her current turn's audio and the `activity` as
 * last announced to the pages. Consumed by `companion.service.ts`, `companion-speech.ts` and `companion-picture.ts`.
 */
export type CompanionAccount = {
  readonly userId: number;
  readonly store: CompanionStore;
  readonly session: CompanionSession;
  readonly speechCache: SpeechCache;
  /** What the pages were last told she is doing. */
  currentActivity(): CompanionActivity;
  /** Sends the held draft (`companion-send.ts`): the panel's Send reaches it through the service; her tools hold the same one. */
  readonly sendDraft: DraftSender;
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

/**
 * Consumed by `companion.service.ts`: one call per account, on the account's first use. Nothing is launched: she is asleep until a message is pushed.
 * `runtime` and `house` are the entrypoint's, passed through to the tools (`CompanionToolDeps.runtime` and `.house`).
 */
export function createCompanionAccount(userId: number, runtime: ProviderRuntimeGateway, house: CompanionHouse): CompanionAccount {
  const store = createCompanionStore(userId);
  const speechCache = createSpeechCache();
  let activity: CompanionActivity = IDLE_ACTIVITY;

  const setActivity = (next: CompanionActivity): void => {
    activity = next;
    store.emit({ kind: 'companion_activity', activity: next });
  };

  const toolDeps = createToolDeps({ userId, store, runtime, house, activity: { current: () => activity, set: setActivity } });

  const session = createCompanionSession({
    userId,
    tools: buildCompanionTools(toolDeps),
    readSettings: () => readCompanionSettings(userId),
    readState: () => store.readState(),
    readRoster: rosterText,
    readView: () => viewedChat(userId),
    // The voice settings hold the one sound-tag list: the parse of her turns and the register she is taught both read it from here.
    readSoundTags: () => readVoiceSettings(userId).gemini.soundTags,
    readProviderSessionId: () => store.readState().providerSessionId,
    writeProviderSessionId: (id) => store.setProviderSessionId(id),
    // His words no turn has answered: the next process says them to her again (`session/companion-ledger.ts`). No frame goes to a page.
    readUnanswered: () => store.readUnanswered(),
    writeUnanswered: (unanswered) => store.setUnanswered(unanswered),
    onSentence: (sentence) => {
      store.appendLog({ role: 'kaylee', text: sentence.display, turnId: sentence.turnId, index: sentence.index, mood: sentence.mood, sounds: sentence.sounds });
    },
    // The cache moves to the new turn BEFORE any page hears of it: a page pulls her first sentence the moment its frame arrives.
    onTurnStarted: (turnId) => {
      speechCache.startTurn(turnId);
      store.emit({ kind: 'companion_turn', turnId, state: 'started', outcome: null, error: null });
    },
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
    speechCache,
    currentActivity: () => activity,
    sendDraft: toolDeps.sendDraft,
  };
}
