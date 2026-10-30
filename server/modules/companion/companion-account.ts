import { viewTargetOf } from '@/modules/notifications/index.js';
import { readVoiceSettings } from '@/modules/voice/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionActivity, CompanionWalk } from '@/shared/companion-types.js';

import type { DraftSender } from './companion-send.js';
import { createSpeechCache, type SpeechCache } from './companion-speech-cache.js';
import { createCompanionStore, type CompanionStore } from './companion-store.js';
import { readCompanionSettings } from './companion-settings.js';
import type { CompanionHouse } from './house.js';
import { lastWordsOf } from './session/companion-handover.js';
import type { ViewShown } from './session/companion-envelopes.js';
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
 * what is on his screen and the sounds she may make (the voice settings' sound-tag list).
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
 * A chat she can act on, named the way she calls it, or `null` for no chat or one she cannot resolve (a chat she could not
 * draft for, so naming it would only invite her to try).
 */
function chatShown(sessionId: string | null): ViewShown | null {
  if (sessionId === null) return null;
  const chat = resolveChat(sessionId);
  return chat.ok ? { kind: 'chat', sessionId: chat.chat.sessionId, label: chat.chat.name } : null;
}

/**
 * Her walkthrough's item under discussion, in her own words: the page only says "walk", so the place and the item come from the
 * walk she holds, and none held is nothing to show. `at` 0 is a walk set up and not begun, which has no item yet.
 */
function walkShown(label: string, walk: CompanionWalk | null): ViewShown | null {
  if (walk === null) return null;
  const item = walk.at < 1 ? 'not begun' : (walk.items[walk.at - 1] ?? '');
  return { kind: 'walk', label, at: walk.at, total: walk.items.length, item };
}

/**
 * What is on this account's screen, with the words she is to call it by, or `null` when nothing is shown or what is shown is not
 * something she can name. The page that speaks for his screen is the one that holds her floor (`viewTargetOf`): a page with no
 * view is a page of the workspace and its chat is what he sees; a station's view is its kind, a chat named through `resolveChat`
 * and a walk filled from her store. Read when a message is pushed, never earlier.
 */
function viewShown(userId: number, store: CompanionStore): ViewShown | null {
  const held = store.readState();
  const target = viewTargetOf(userId, held.floor);
  if (target === null) return null;
  const { view } = target;
  if (view === null) return chatShown(target.sessionId);
  if (view.kind === 'chat') return chatShown(view.sessionId);
  if (view.kind === 'walk') return walkShown(view.label, held.walk);
  return view;
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
    readView: () => viewShown(userId, store),
    // The voice settings hold the one sound-tag list: the parse of her turns and the register she is taught both read it from here.
    readSoundTags: () => readVoiceSettings(userId).gemini.soundTags,
    readProviderSession: () => {
      const { providerSessionId, sessionShape } = store.readState();
      return providerSessionId === null ? null : { id: providerSessionId, shape: sessionShape };
    },
    writeProviderSession: (session) => store.setProviderSession(session?.id ?? null, session?.shape ?? null),
    // The handover of a conversation her refused resume drops: on her row until the launch that was handed the first message after the fresh start (the one that carries it) reports `init`.
    readHandover: () => store.readHandover(),
    writeHandover: (text) => store.setHandover(text),
    dropHandover: () => store.setHandover(null),
    // The newest exchange of her log: the summarizer of the handover is not shown it. A window of the newest 80 lines holds her last turn and what it answered.
    readLastWords: () => lastWordsOf(store.readLog(80)),
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
