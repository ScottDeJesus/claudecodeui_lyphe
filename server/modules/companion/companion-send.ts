import { randomUUID } from 'node:crypto';

import { projectsDb, relayedSendsDb, sessionsDb } from '@/modules/database/index.js';
import { CLAUDE_MODEL_VALUE_BY_ALIAS, diagnoseProjectFolder, readAccountDefaultModelAlias, sessionsService } from '@/modules/providers/index.js';
import type { ClaudeModelAlias } from '@/modules/providers/index.js';
import { broadcastSessionUpserted, chatRunRegistry, runDetachedChatTurn, steerChatRun } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import type { CompanionDraft, CompanionOpenTarget, CompanionSessionRef } from '@/shared/companion-types.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import { oneLine } from '@/shared/tool-call-hint.js';

import type { CompanionStore } from './companion-store.js';
import { sendOptionsFor, type ChatSendOptions } from './tools/send-options.js';

/**
 * THE DRAFT IS THE ONLY THING SENT, and this is the one place it goes out: the panel's Send (`POST /draft/send`), her
 * `send_to_session` and her `create_session` all end here, so a brief reaches a chat the same way whoever pressed.
 *
 * WHAT IS CHECKED FIRST. A draft must be held. A caller that says what it is sending (a tool, which was told the words
 * by her) must say the draft's own words, trimmed, and must name the chat or the project the draft is for: a mismatch
 * is refused, and the refusal names the draft (its target and its first words), so nothing reaches a chat that was not
 * on his screen first.
 *
 * WHAT A SEND IS. It runs as if he had typed it in that chat's composer: the chat's own model, effort and permission
 * mode, his tool rules read now, the chat's name as the notification's summary (`sendOptionsFor`).
 *   - THE MODEL is hers to choose: `model` on the request (one of the house's names) replaces the chat's own for this turn,
 *     and the turn records it as the chat's from then on. Left out, an existing chat keeps its own and a NEW chat runs on the
 *     account's default model (`readAccountDefaultModelAlias`) — named outright, because a turn sent with no model runs on the
 *     runtime's own default (opus), not the account's. A new chat borrows nothing from the chat she was last on. A model
 *     cannot ride a brief folded into a running turn, so a send that names one to a working chat is refused before anything goes;
 *   - a chat that is IDLE gets a turn, through `runDetachedChatTurn` (the scheduled messages' door). Its `beforeRun`
 *     hook writes the echo onto the run's stream before the provider starts; this verb waits only for the run to have
 *     STARTED (the hook ran, or the door refused), never for the turn;
 *   - a chat that is WORKING gets the brief folded into the turn it is running (`steerChatRun`), whichever mode was
 *     asked — a new turn queued behind the one going the wrong way is the lag a steer exists to remove. The CLI takes a
 *     pushed message at a tool-result boundary, so a turn with no tool step left runs the brief as its own turn right
 *     after it finishes: the sentence says "sent", never that the turn was changed. A fold that finds no turn to fold
 *     into (it ended in the instant between) runs as a turn instead;
 *   - a steer to an idle chat starts a turn. The sentence says which of the two happened.
 * A STARTED ANSWER ALWAYS NAMES THE MODEL the turn was handed, so what she tells him is what ran: "…, on opus" when she gave it, "…, on
 * fable, the account default" for a new chat she left it to, "…, on sonnet, its own" for an existing chat that keeps the one it has. A chat
 * that records no model and was given none names none: the runtime's own default is not known here, and the sentence does not guess it.
 * Every send is recorded in `relayed_sends`, and its echo is a user text row `local_kaylee_<uuid>` marked
 * `spokenVia: 'kaylee'`, which the page swaps for the persisted row (marked again by the history read). A TURN
 * stamps its own uuid on its message (`runDetachedChatTurn`'s `messageUuid`), which the CLI keeps as the transcript
 * row's uuid, and records it: the history mark then follows that row, not its words. A steer cannot (its persisted
 * row is a queued-command attachment) and is recorded without one.
 *
 * AFTER A SEND the draft clears, the chat becomes her focus and the page that holds the floor opens it. A NEW chat is
 * made on the simple list as the page's New chat makes it, named with the title when one is given (through
 * `updateSessionCustomName` alone: her title is not a name he gave, so the namer may still replace it), announced to the
 * sidebars, and then sent to.
 *
 * Consumers: `tools/tool-deps.ts` (builds one per account for the tool files, whose `send_to_session` and
 * `create_session` call it) and, through the account, `companion.service.ts` (the panel's Send).
 */

/** What a caller asks of `sendDraft`. Consumed by `tools/draft-tools.ts` and `companion.service.ts`. */
export type DraftSendRequest = {
  /** The mode asked. A send to a working chat folds whatever this is; a steer to an idle chat starts a turn. */
  mode: 'turn' | 'steer';
  /** The words the caller says it is sending: when given they must equal the draft's, trimmed. */
  text?: string;
  /** The chat the caller says the draft is for (`send_to_session`): the draft must be for it. */
  chat?: CompanionSessionRef;
  /** The new chat the caller says the draft starts (`create_session`): the draft must be for a new chat in that project. */
  newChat?: { projectPath: string; title: string };
  /** The model she chose for the turn (`send_to_session`, `create_session`). Left out: an existing chat keeps its own, a new chat runs on the account's default. */
  model?: ClaudeModelAlias;
};

/** What `sendDraft` answers: `started` (a turn), `folded` (into the running turn) or `refused`, with the sentence to say or to show. Consumed by `tools/draft-tools.ts` and `companion.service.ts`. */
export type DraftSendOutcome = { outcome: 'started' | 'folded' | 'refused'; sentence: string };

/** Sends the account's held draft. Consumed by `tools/tool-deps.ts` and `companion-account.ts`. */
export type DraftSender = (request: DraftSendRequest) => Promise<DraftSendOutcome>;

const refused = (sentence: string): DraftSendOutcome => ({ outcome: 'refused', sentence });

/** Whose choice the model a turn was handed is: hers for this turn, the account's default (a new chat she left it to), or the chat's own stored one. */
type ModelSource = 'chosen' | 'account default' | 'own';

/**
 * The clause a started answer ends with, naming `handed` (the model value the run was given, `undefined` for none): the house's name for it
 * when the table has one (`opus[1m]` is "opus"), the value itself otherwise. Empty when the run was handed none.
 */
function modelClause(handed: string | undefined, source: ModelSource): string {
  if (!handed) return '';
  const name = Object.entries(CLAUDE_MODEL_VALUE_BY_ALIAS).find(([, value]) => value === handed)?.[0] ?? handed;
  return source === 'chosen' ? `, on ${name}` : `, on ${name}, ${source === 'own' ? 'its own' : 'the account default'}`;
}

/** How much of the draft a refusal quotes: enough to tell which draft it is, not the whole brief. */
const QUOTED_CHARACTERS = 160;

/** The draft as a refusal names it: where it is going and how it begins. */
function describeDraft(draft: CompanionDraft): string {
  const where = draft.target.kind === 'session' ? `"${draft.target.session.name}" (${draft.target.session.project})` : `a new chat in ${draft.target.projectName}`;
  const flat = oneLine(draft.text);
  const head = Array.from(flat).length > QUOTED_CHARACTERS ? `${Array.from(flat).slice(0, QUOTED_CHARACTERS).join('')}…` : flat;
  return `The draft is for ${where} and begins: "${head}"`;
}

/** Records a send for the history mark; `messageUuid` is the uuid a turn stamped on its message. The mark is cosmetic: a failed write is logged and never costs the send. */
function recordRelayed(sessionId: string, via: 'turn' | 'steer', words: string, messageUuid: string | null = null): void {
  try {
    relayedSendsDb.record(sessionId, via, words, messageUuid);
  } catch (error) {
    console.error('[Companion] a send could not be recorded for its "Through Kaylee" mark', { sessionId, error });
  }
}

type SenderDeps = {
  userId: number;
  store: CompanionStore;
  runtime: ProviderRuntimeGateway;
  setFocus(chat: CompanionSessionRef): void;
  openOnFloor(target: CompanionOpenTarget, label: string): void;
};

/** Consumed by `tools/tool-deps.ts`: one sender per account. */
export function createDraftSender(deps: SenderDeps): DraftSender {
  const { userId, store, runtime } = deps;

  /** The echo of a brief, as the chat's stream shows it until the persisted row replaces it. */
  const echoOf = (sessionId: string, provider: LLMProvider, words: string): NormalizedMessage =>
    createNormalizedMessage({ kind: 'text', role: 'user', content: words, id: `local_kaylee_${randomUUID()}`, sessionId, provider, spokenVia: 'kaylee' });

  /** Starts a turn and answers once the RUN has started (its hook ran) or the door refused; the turn itself runs on. */
  function startTurn(sessionId: string, provider: LLMProvider, words: string, options: ChatSendOptions): Promise<{ started: boolean; error: string | null }> {
    return new Promise((resolve) => {
      let hooked = false;
      // The uuid of the user row this turn writes: stamped on the message by the runtime, kept by the CLI, recorded with the send.
      // Only the Claude runtime stamps one (`options.messageUuid`); a chat of another provider records none, and its row is marked by the text rule.
      const messageUuid = provider === 'claude' ? randomUUID() : undefined;
      runDetachedChatTurn(
        {
          sessionId,
          userId,
          content: words,
          options: { ...options },
          messageUuid,
          beforeRun: (run) => {
            run.writer.send(echoOf(sessionId, provider, words));
            recordRelayed(sessionId, 'turn', words, messageUuid ?? null);
            hooked = true;
            resolve({ started: true, error: null });
          },
        },
        { runtime },
      )
        // A no-op once the hook has resolved; before it, the door's own refusal (or a hook that threw).
        .then((result) => {
          if (result.error) console.error('[Companion] a turn she sent ended in an error', { sessionId, error: result.error });
          resolve({ started: result.started && hooked, error: result.error });
        })
        .catch((error: unknown) => {
          console.error('[Companion] a turn she sent could not be started', { sessionId, error });
          resolve({ started: false, error: error instanceof Error ? error.message : String(error) });
        });
    });
  }

  /**
   * After a send: the draft is spent, the chat is the focus and the page that holds the floor opens it. The draft clears
   * only if it is still the one that went — he or she may have rewritten it while the send was out, and that rewrite is
   * the next brief, not this one.
   */
  function afterSend(chat: CompanionSessionRef, sent: CompanionDraft): void {
    if (store.readState().draft?.updatedAt === sent.updatedAt) store.setDraft(null);
    deps.setFocus(chat);
    deps.openOnFloor({ kind: 'chat', sessionId: chat.sessionId }, chat.name);
  }

  async function sendToChat(chat: CompanionSessionRef, draft: CompanionDraft, words: string, mode: 'turn' | 'steer', model: ClaudeModelAlias | undefined): Promise<DraftSendOutcome> {
    const row = sessionsDb.getSessionById(chat.sessionId);
    if (!row || row.isArchived) {
      return refused(`"${chat.name}" is no longer a chat he has (it was archived or deleted), so nothing was sent. Tell him, and ask which chat the brief is for.`);
    }
    const provider = row.provider as LLMProvider;
    const name = row.custom_name?.trim() || chat.name;
    const current: CompanionSessionRef = { ...chat, name };

    // The house's model names are Claude's: another provider's chat cannot run on one, and a send never goes out on another model than she named.
    if (model !== undefined && provider !== 'claude') {
      return refused(`"${name}" is a ${provider} chat, and the model names are Claude's, so nothing was sent. The draft is still on his screen; send it without model.`);
    }
    // A chat with a turn running takes the brief into it, whichever mode was asked.
    if (chatRunRegistry.isProcessing(chat.sessionId)) {
      // A brief folded into a running turn cannot carry a model, and sending it on the chat's own model while she believes it went on hers is the silent send this refuses.
      if (model !== undefined) {
        return refused(`"${name}" is mid-turn, so the brief would fold into that turn, and a running turn cannot change its model: it keeps the one it has. Nothing was sent and the draft is still on his screen. Send it again without model to fold it in, or wait for the turn to end and send it with the model.`);
      }
      const folded = await steerChatRun(chat.sessionId, words, echoOf(chat.sessionId, provider, words), { runtime });
      if (folded === 'folded') {
        recordRelayed(chat.sessionId, 'steer', words);
        afterSend(current, draft);
        // Pushed into the turn, not yet absorbed by it: the CLI takes a pushed message at a tool-result boundary, so a turn with
        // no tool step left runs the brief as its own turn right after it finishes. The sentence she tells him must not promise more.
        return { outcome: 'folded', sentence: `Sent to ${name} while it works. It takes the brief at its next tool step, or as its own turn right after it finishes; a turn with no tool step left will not change course.` };
      }
    }

    const options = sendOptionsFor(userId, chat.sessionId, provider, { model });
    const started = await startTurn(chat.sessionId, provider, words, options);
    if (!started.started) {
      return refused(`"${name}" did not take the brief${started.error ? `: ${started.error}` : ''} The draft is still on his screen; send it again in a moment.`);
    }
    afterSend(current, draft);
    const onModel = modelClause(options.model, model === undefined ? 'own' : 'chosen');
    return { outcome: 'started', sentence: mode === 'steer' ? `${name} was not working, so the brief started a new turn there${onModel}.` : `Started a new turn in ${name}${onModel}.` };
  }

  async function sendToNewChat(target: { projectPath: string; projectName: string }, draft: CompanionDraft, words: string, title: string | null, chosen: ClaudeModelAlias | undefined): Promise<DraftSendOutcome> {
    // A project whose folder is gone would take the first message and have the launch refused after the send's hook has run:
    // "started" for a chat that cannot. The test is the run's own pre-flight, skipped as it is skipped for a node's project
    // (its folder lives on the node), and it runs before anything is made so a refusal leaves no chat and keeps the draft.
    if (projectsDb.nodeForPath(target.projectPath) === null) {
      const problem = await diagnoseProjectFolder(target.projectPath);
      if (problem) {
        return refused(`The folder of ${target.projectName} (${target.projectPath}) ${problem === 'nothing' ? 'is gone from this machine' : 'is not a folder'}, so no chat was made. The draft is still on his screen; tell him, or aim it at another project.`);
      }
    }
    // Made as the page's New chat makes one (on the simple list), then named, then announced, then sent to.
    const created = sessionsService.createAppSession('claude', target.projectPath, words, true);
    if (title) sessionsDb.updateSessionCustomName(created.sessionId, title);
    await broadcastSessionUpserted(created.sessionId).catch((error: unknown) => {
      console.error('[Companion] a new chat was made but could not be announced', { sessionId: created.sessionId, error });
    });

    // A chat made just now has no choices of its own: the model she chose, else the account's default (named here, not left to the
    // runtime, whose own default is opus), and the latest permission mode. Nothing is borrowed from the chat she was last on.
    const model = chosen ?? (await readAccountDefaultModelAlias()) ?? undefined;
    const options = sendOptionsFor(userId, null, 'claude', { model, newChatName: title ?? created.sessionName });
    const started = await startTurn(created.sessionId, 'claude', words, options);
    if (!started.started) {
      return refused(`The chat was made in ${target.projectName} but its first message did not start${started.error ? `: ${started.error}` : '.'} The draft is still on his screen.`);
    }
    const name = title ?? created.sessionName;
    afterSend({ sessionId: created.sessionId, name, project: target.projectName }, draft);
    return { outcome: 'started', sentence: `Started a new chat "${name}" in ${target.projectName}${modelClause(options.model, chosen === undefined ? 'account default' : 'chosen')}.` };
  }

  // The draft goes out once: she calls tools in parallel and two pages can press Send, and a second call that read the
  // draft before the first had cleared it would put the same brief into the chat twice (the second as a steer).
  let sending = false;

  async function sendHeldDraft(request: DraftSendRequest): Promise<DraftSendOutcome> {
    const draft = store.readState().draft;
    if (draft === null) return refused('There is no draft to send. Write the brief with update_draft first, so he sees it on his screen, then send it.');
    const words = draft.text.trim();
    if (words === '') return refused('The draft has no words in it. Write the brief with update_draft, then send it.');

    if (request.text !== undefined && request.text.trim() !== words) {
      return refused(`The text is not the draft. ${describeDraft(draft)} Send exactly the draft's text, or call update_draft with the new words first, so he sees what will go.`);
    }
    const { target } = draft;
    if (request.chat && !(target.kind === 'session' && target.session.sessionId === request.chat.sessionId)) {
      return refused(`The draft is not for "${request.chat.name}". ${describeDraft(draft)} Call update_draft for "${request.chat.name}" first, so he sees it, then send.`);
    }
    if (request.newChat && !(target.kind === 'new' && target.projectPath === request.newChat.projectPath)) {
      return refused(`The draft is not for a new chat in that project. ${describeDraft(draft)} Call update_draft with that project first, so he sees it, then create the chat.`);
    }

    return target.kind === 'session'
      ? sendToChat(target.session, draft, words, request.mode, request.model)
      : sendToNewChat(target, draft, words, request.newChat?.title ?? null, request.model);
  }

  return async function sendDraft(request) {
    if (sending) return refused('The draft is already going out. Wait for that send to answer; nothing more is needed.');
    sending = true;
    try {
      return await sendHeldDraft(request);
    } finally {
      sending = false;
    }
  };
}
