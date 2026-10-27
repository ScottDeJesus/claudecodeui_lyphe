import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { userPreferencesDb } from '@/modules/database/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import { abortChatRun, answerChatPermission, broadcastSessionUpserted } from '@/modules/websocket/index.js';
import type { CompanionSessionRef } from '@/shared/companion-types.js';
import { isRecord } from '@/shared/document-fields.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';

import { answerFor, oldestPendingAsk } from './ask-decision.js';
import type { CompanionToolDeps } from './companion-tools.js';
import { listHisChats, resolveChat } from './house-reads.js';

/**
 * The three tools that ACT on a chat: `stop_session`, `rename_session` and `answer_session`. Each does what its
 * page door does, through the house's own verb, so a stop, a name or an answer from her is the same act as from
 * his hand and leaves the same marks:
 *   - `stop_session` is the page's `chat.abort` (`abortChatRun`). The turn ends aborted and the sidebar's
 *     spinner drops; the chat itself stays alive, and "was not running" is an answer, not a failure;
 *   - `rename_session` is the sidebar's rename (`sessionsService.renameSessionById`, the door that marks a name as
 *     given by a person, so the namer never replaces it) plus the `session_upserted` delta the sidebar draws the
 *     new name from without a reload;
 *   - `answer_session` answers the OLDEST ask the chat is waiting on through the runtime's own resolver
 *     (`answerChatPermission`); what an answer means to each kind of ask is `ask-decision.ts`'s. Only the "always"
 *     answer does more: it writes the rule into his `claudePermissions` preference first (`rememberAllowedTool`),
 *     the way the page's "Allow and remember" does before it answers, so a failed write leaves the ask unanswered
 *     and the call can simply be made again.
 *
 * Each names a chat, so each makes it her focus (`setFocus`), after the act, so a renamed chat is the focus under
 * its new name. None sets an activity: each is over in a moment, and no phase says "acting". A refusal is `isError`
 * text that says what to do next (`deps.refuse`); a verb that throws is logged and answered the same way
 * (`guardedToolResult`).
 *
 * Each description is her prompt's own line for the tool (`toolLine`).
 *
 * Consumer: `tools/companion-tools.ts`, which adds these three to the thirteen it builds.
 */

/** The longest name she may give a chat: the sidebar shows a title, not a sentence. */
const CHAT_NAME_MAX = 60;

/** The longest free answer to a question: an answer, not a brief. */
const ANSWER_MAX = 2_000;

/** The key his tool permissions are stored under (`UserPreferences.claudePermissions`), the one the page's Settings reads and writes. */
const CLAUDE_PERMISSIONS_KEY = 'claudePermissions';

/** What one handler hands back: its text, and the chat as it stands afterwards when that changed (a rename changes the name the focus carries). */
type Acted = { result: ToolTextResult; chat?: CompanionSessionRef };

/**
 * The common course of the three: resolve the chat she named, do `act` on it, and make it her focus. A name that
 * fits no chat (or several) is the resolver's own sentence.
 */
function onNamedChat(
  deps: CompanionToolDeps,
  toolName: string,
  doing: string,
  session: string,
  act: (chat: CompanionSessionRef) => Promise<Acted>
): Promise<ToolTextResult> {
  return guardedToolResult(toolName, doing, async () => {
    const found = resolveChat(session);
    if (!found.ok) return deps.refuse(found.sentence);
    const acted = await act(found.chat);
    deps.setFocus(acted.chat ?? found.chat);
    return acted.result;
  });
}

/** The strings of a stored list; anything else in it is not a rule and is dropped. */
const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);

/**
 * Writes `entry` into the account's `claudePermissions`: added to `allowedTools` when it is not there, removed from
 * `disallowedTools` when it is (an entry he once denied and now allows is allowed, not both), every other key of the
 * preference left as it was. The page's `grantClaudeToolPermission` does the same merge on its own copy. Synchronous
 * on purpose: read and write share no `await`, so two chats answered "always" in parallel cannot both read the list
 * before either writes it and lose an entry.
 */
function rememberAllowedTool(userId: number, entry: string): void {
  const stored = userPreferencesDb.getPreferences(userId)[CLAUDE_PERMISSIONS_KEY];
  const current = isRecord(stored) ? stored : {};
  const allowedTools = stringsOf(current.allowedTools);
  const disallowedTools = stringsOf(current.disallowedTools);
  if (allowedTools.includes(entry) && !disallowedTools.includes(entry)) return;
  userPreferencesDb.savePreferences(userId, {
    [CLAUDE_PERMISSIONS_KEY]: {
      ...current,
      allowedTools: allowedTools.includes(entry) ? allowedTools : [...allowedTools, entry],
      disallowedTools: disallowedTools.filter((tool) => tool !== entry),
    },
  });
}

/** `stop_session`: the page's stop, now, on the chat she names. */
function stopSession(deps: CompanionToolDeps, args: { session: string }): Promise<ToolTextResult> {
  return onNamedChat(deps, 'stop_session', 'stop the chat', args.session, async (chat) => {
    const outcome = await abortChatRun(chat.sessionId, { runtime: deps.runtime });
    return { result: textResult(outcome === 'stopped' ? `Stopped ${chat.name}; it is still there.` : `${chat.name} was not running.`) };
  });
}

/**
 * What she holds of the chat besides her focus follows its new name: the draft's target and the walkthrough each carry the
 * chat as a ref with the name it had, and the panel's draft card and `<state>` after a compaction would go on naming a chat
 * that `resolveChat` no longer finds by that name.
 */
function carryRename(deps: CompanionToolDeps, renamed: CompanionSessionRef): void {
  const { draft, walk } = deps.store.readState();
  if (draft?.target.kind === 'session' && draft.target.session.sessionId === renamed.sessionId) {
    deps.store.setDraft({ target: { kind: 'session', session: renamed }, text: draft.text });
  }
  if (walk?.session.sessionId === renamed.sessionId) deps.store.setWalk({ session: renamed, items: walk.items, at: walk.at });
}

/** `rename_session`: the sidebar's rename, then the delta that draws the new name on every open page. */
function renameSession(deps: CompanionToolDeps, args: { session: string; name: string }): Promise<ToolTextResult> {
  return onNamedChat(deps, 'rename_session', 'rename the chat', args.session, async (chat) => {
    sessionsService.renameSessionById(chat.sessionId, args.name);
    // The name is stored; a delta that fails to go out leaves the sidebar on the old name until its next one, which is no reason to say the rename failed.
    await broadcastSessionUpserted(chat.sessionId).catch((error: unknown) => {
      console.error('[Companion] rename_session stored the name but could not announce it', { sessionId: chat.sessionId, error });
    });
    const renamed = { ...chat, name: args.name };
    carryRename(deps, renamed);
    // A name two chats carry is a name `resolveChat` refuses for both ("fits 2 chats"): the rename stands, and she is told to use ids.
    const alike = listHisChats().filter((other) => other.sessionId !== chat.sessionId && other.name.toLowerCase() === args.name.toLowerCase());
    const clash = alike.length === 0
      ? ''
      : ` Another chat of his is also called "${args.name}" (${alike.map((other) => `${other.project}, id ${other.sessionId}`).join('; ')}), so that name no longer picks one: name either by its id, or give one of them another name.`;
    return { result: textResult(`Renamed ${chat.name} to "${args.name}".${clash}`), chat: renamed };
  });
}

/** `answer_session`: the oldest ask of the chat, answered through the runtime's own resolver. */
function answerSession(deps: CompanionToolDeps, args: { session: string; answer: string }): Promise<ToolTextResult> {
  return onNamedChat(deps, 'answer_session', 'answer the chat', args.session, async (chat) => {
    const waiting = oldestPendingAsk(deps.runtime.getPendingApprovalsForSession(chat.sessionId));
    if (waiting === null) {
      return { result: deps.refuse(`${chat.name} has no question or permission request waiting, so there is nothing to answer. list_sessions shows which chats are waiting.`) };
    }
    const verdict = answerFor(waiting.ask, args.answer, chat.name);
    if (!verdict.ok) return { result: deps.refuse(verdict.sentence) };

    if (verdict.remember !== null) rememberAllowedTool(deps.userId, verdict.remember);
    answerChatPermission(waiting.ask.requestId, verdict.decision, { runtime: deps.runtime });
    const behind = waiting.more === 0 ? '' : ` ${waiting.more} more ${waiting.more === 1 ? 'ask is' : 'asks are'} still waiting there.`;
    return { result: textResult(verdict.told + behind) };
  });
}

/** One chat, by its name or id: the argument all three tools open with. */
const sessionArgument = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('The chat, by its id or its whole name as he says it. When he says "it" or "that one", it is the focus chat: never ask him which.');

/**
 * The definitions of `stop_session`, `rename_session` and `answer_session` (the order her prompt lists them), built
 * with the SDK's `tool()` and zod. None is read-only: each changes a chat, so none carries `readOnlyHint`; the CLI
 * asks no permission for them regardless, because `allowedTools` names every tool of hers.
 * Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function actTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool('stop_session', toolLine('stop_session'), { session: sessionArgument }, (args) => stopSession(deps, args)),
    tool(
      'rename_session',
      toolLine('rename_session'),
      {
        session: sessionArgument,
        name: z
          .string()
          .trim()
          .min(1)
          .max(CHAT_NAME_MAX)
          .regex(/^[^\r\n\u2028\u2029]+$/, 'A name is one line: no line break.')
          .describe(`The name he calls the chat by, as he says it: one line, up to ${CHAT_NAME_MAX} characters.`),
      },
      (args) => renameSession(deps, args)
    ),
    tool(
      'answer_session',
      toolLine('answer_session'),
      {
        session: sessionArgument,
        answer: z
          .string()
          .trim()
          .min(1)
          .max(ANSWER_MAX)
          .describe(
            'For a permission request: allow, deny or always. always allows AND stores the rule for every later chat of his account, so say it only when he asked to remember it; read_session pending_ask names the rule it would store. For a question with options: the option\'s label, or his own words when none fits (allow, deny and always are not answers to a question). For a plan: allow approves it, deny sends it back for revision.'
          ),
      },
      (args) => answerSession(deps, args)
    ),
  ];
}
