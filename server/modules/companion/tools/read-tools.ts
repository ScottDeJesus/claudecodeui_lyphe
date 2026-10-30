import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { sessionsDb } from '@/modules/database/index.js';
import { listOpenFollowups } from '@/modules/followups/index.js';
import { sessionsService } from '@/modules/providers/index.js';
import type { CompanionSessionRef } from '@/shared/companion-types.js';
import { isRecord } from '@/shared/document-fields.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { characterCount } from '../companion-input.js';
import { toolLine } from '../session/companion-prompt.js';

import type { CompanionToolDeps } from './companion-tools.js';
import { resolveDactylFiles } from './dactyl-paths.js';
import { stepBrackets } from './followup-plans.js';
import { askLine, chatNameOf, chatState, pendingAsksOf, resolveChat } from './house-reads.js';
import {
  companionScratchDir,
  LAST_TURN_DIGEST_BRIEF,
  nextScratchFile,
  phraseDigestBrief,
  pruneScratch,
  RECENT_DIGEST_BRIEF,
  renderTurnWindow,
  runDactylRead,
} from './transcript-render.js';
import { groupTurns, newestThatFit, numberTurns, RECENT_TURN_COUNT, replyText, turnsAround, type Turn } from './transcript-turns.js';

/**
 * The three tools she reads with: `read_session` (what a chat said and did), `list_followups` (what chats left for
 * him) and `ask_dactyl` (a small reader per file, for anything too long to read herself).
 *
 * A SESSION'S TRANSCRIPT IS SHARED GROUND. When the conversation is about what a chat did, she reads it before she
 * speaks, so her account is true. `read_session` answers by SCOPE:
 *   - `last_turn`: his last message, the reply after it and the count of its tool calls — in full when the reply is
 *     6,000 characters or fewer, else the turn is rendered to a file and a dactyl's digest answers;
 *   - `recent`: the last 10 turns, rendered to a file, then a dactyl's digest;
 *   - `pending_ask`: the asks the chat is blocked on, one line each;
 *   - any other string is a PHRASE: the turns whose text holds it (case-insensitive) with one turn either side,
 *     rendered, then a digest — or "the transcript does not mention it".
 * A rendered file is numbered, lives in her scratch folder (the newest 20 are kept) and is named in the answer, so she
 * can put a sharper question about it to a dactyl. Its turns carry the chat's own numbers, a gap between windows is marked,
 * and a window too long for one dactyl keeps its newest turns that fit, with the answer saying how many were left out. The chat she reads becomes her focus, and her activity is
 * `reading_session` with that chat while the tool runs.
 *
 * `ask_dactyl` runs one dactyl per file (up to eight at once) with her brief. A dactyl's answer lands in her context
 * and may be spoken aloud, so every file is held to the path rules of `dactyl-paths.ts` first: a secret never
 * reaches one, a refusal names the file, and no dactyl starts. Her activity is `reading_code` with the files.
 *
 * Every result is text; a refusal is `isError` with a sentence that says what to do next. No usage or spend appears in
 * any answer (ruling 17). Each description is her prompt's own line for the tool (`toolLine`).
 *
 * Consumer: `tools/companion-tools.ts`, which puts these three after `list_sessions` and `list_projects`.
 */

/** A reply longer than this many characters is digested by a dactyl instead of being handed over whole. */
const LONG_REPLY_CHARACTERS = 6_000;

/** The longest brief a dactyl is sent, the most files one call names, and the longest path she may type: limits of the tool's schema. */
const BRIEF_MAX = 4_000;
const FILES_MAX = 8;
const PATH_MAX = 1_000;

/** How many follow-ups an all-chats `list_followups` shows: the service is asked for one more, to know whether it cut the list. */
const FOLLOWUPS_SHOWN = 20;

/** The most open follow-ups the service answers for one chat (its own ceiling): a named chat is shown whole, as the widget shows it. */
const CHAT_FOLLOWUPS_MAX = 200;

/** The last line of every digest: where the rendered turns are, so a sharper question can go to a dactyl. */
const readableAt = (file: string): string => `The turns are rendered at ${file}; ask_dactyl can read that file for a sharper question.`;

/**
 * The call's own AbortSignal, when the SDK hands one in the handler's second argument (it does for a tool call that is cancelled, as when she is stopped).
 * Consumed by this file's tools and by the eyes' reads (`eyes/*-reads.ts`), which stop a dactyl with the call.
 */
export function signalOf(extra: unknown): AbortSignal | undefined {
  const signal = isRecord(extra) ? extra.signal : undefined;
  return signal instanceof AbortSignal ? signal : undefined;
}

/**
 * What to say of a chat whose history holds no turn: a chat that has never run a turn has said nothing, but one with a
 * conversation of its own whose transcript reads as empty (the file is gone, or holds no message) has said something
 * that cannot be read — and she must not claim it said nothing.
 */
function silentTranscript(chat: CompanionSessionRef): string {
  if (sessionsDb.getSessionById(chat.sessionId)?.provider_session_id) {
    return `"${chat.name}" has a conversation, but no turn can be read from its transcript (the file may be missing or empty). Say nothing about what it did.`;
  }
  return `"${chat.name}" has no transcript yet: nothing has been said in it.`;
}

/**
 * Renders the turns of `picked` (a subset of the chat's `all`, in order) to the next numbered file of her scratch folder,
 * under the chat's own turn numbers, and answers a dactyl's digest of it under `brief`, after `intro`. What one dactyl
 * can take is bounded (`newestThatFit`): when the window is too long the newest turns that fit are rendered and the
 * answer says how many older ones were left out and how to reach them (`narrow`); a turn too long ALONE is left out
 * by number and the rest still digested; when every turn is too long there is no digest to give and she is told so.
 * A chat still running adds that the reply may grow. The render is synchronous and the folder is pruned right after it
 * (the file just written is the newest). A digest that fails is told with its own sentence, and the file is still
 * named: the render is not lost. `signal` stops the dactyl with the call.
 */
async function digestOf(
  deps: CompanionToolDeps,
  chat: CompanionSessionRef,
  window: { all: Turn[]; picked: Turn[] },
  digest: { label: string; brief: string; intro: string; narrow: string },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> {
  const { fitted, tooLong } = newestThatFit(numberTurns(window.all, window.picked));
  if (fitted.length === 0) {
    return deps.refuse(`"${chat.name}": ${window.picked.length === 1 ? 'that turn is' : 'every turn in that window is'} more than one reader takes, so there is nothing to digest. Tell him it is too long to go through aloud.`);
  }
  const folder = companionScratchDir(deps.userId);
  const file = nextScratchFile(folder, digest.label);
  renderTurnWindow(chat.sessionId, fitted, window.all.length, file);
  pruneScratch(folder);
  const left = window.picked.length - fitted.length - tooLong.length;
  const cut = left > 0 ? `Only the newest ${fitted.length} of those ${window.picked.length} turns fit one reader; the ${left} older ${left === 1 ? 'one is' : 'ones are'} left out — ${digest.narrow}.` : '';
  const long = tooLong.length > 0 ? `${tooLong.length === 1 ? `Turn ${tooLong[0].number} is` : `Turns ${tooLong.map((turn) => turn.number).join(', ')} are each`} more than one reader takes and ${tooLong.length === 1 ? 'is' : 'are'} left out.` : '';
  const working = chatState(chat.sessionId) === 'working' ? 'It is still working, so what it has written may grow.' : '';
  const answer = await runDactylRead([file], digest.brief, undefined, signal);
  if (!answer.ok) return deps.refuse(`${answer.error} ${readableAt(file)}`);
  return textResult([digest.intro, cut, long, working, answer.text, readableAt(file)].filter((part) => part !== '').join('\n'));
}

/** `last_turn`: the last turn whole when its reply is short, else a digest of the turn. */
function lastTurn(deps: CompanionToolDeps, chat: CompanionSessionRef, turns: Turn[], signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  const turn = turns.at(-1);
  if (turn === undefined) return textResult(silentTranscript(chat));
  const reply = replyText(turn);
  const length = characterCount(reply);
  if (length > LONG_REPLY_CHARACTERS) {
    const intro = `"${chat.name}": its last reply is long (${length} characters); a dactyl's digest of the turn:`;
    return digestOf(deps, chat, { all: turns, picked: [turn] }, { label: 'last-turn', brief: LAST_TURN_DIGEST_BRIEF, intro, narrow: 'it is one turn' }, signal);
  }
  const said = turn.said === null ? '(the transcript begins with the reply)' : turn.said || '(no text — attachments only)';
  const working = chatState(chat.sessionId) === 'working' ? '\nIt is still working on this turn, so the reply may grow.' : '';
  return textResult(
    `"${chat.name}", its last turn${turn.at ? ` (${turn.at})` : ''}:\nHe said:\n${said}\n\nIts reply:\n${reply || '(none yet)'}\n\nTool calls in this turn: ${turn.calls}${working}`
  );
}

/** `pending_ask`: the waiting asks, oldest first, one line each. */
function pendingAsks(chat: CompanionSessionRef): ToolTextResult {
  const asks = pendingAsksOf(chat.sessionId);
  if (asks.length === 0) return textResult(`Nothing is waiting on him in "${chat.name}".`);
  const lines = asks.map((ask, index) => `${index + 1}. ${askLine(ask, true)}`);
  return textResult(`"${chat.name}" is waiting on him (${asks.length === 1 ? 'one ask' : `${asks.length} asks, oldest first`}):\n${lines.join('\n')}`);
}

/** The text of one `read_session` call, after the chat is resolved and her activity set. */
async function readScope(deps: CompanionToolDeps, chat: CompanionSessionRef, scope: string, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  // The three keywords are matched without regard to case; anything else is a phrase, searched as she typed it.
  const keyword = scope.toLowerCase();
  if (keyword === 'pending_ask') return pendingAsks(chat);

  const history = await sessionsService.fetchHistory(chat.sessionId, { limit: null });
  const turns = groupTurns(history.messages);
  if (keyword === 'last_turn') return lastTurn(deps, chat, turns, signal);
  if (turns.length === 0) return textResult(silentTranscript(chat));
  if (keyword === 'recent') {
    const picked = turns.slice(-RECENT_TURN_COUNT);
    const intro = `"${chat.name}": its last ${picked.length} ${picked.length === 1 ? 'turn' : 'turns'}, as a dactyl's digest:`;
    return digestOf(deps, chat, { all: turns, picked }, { label: 'recent', brief: RECENT_DIGEST_BRIEF, intro, narrow: 'ask about a phrase to reach them' }, signal);
  }

  const picked = turnsAround(turns, scope);
  if (picked.length === 0) return textResult(`The transcript of "${chat.name}" does not mention "${scope}".`);
  const intro = `"${chat.name}": ${picked.length} ${picked.length === 1 ? 'turn' : 'turns'} around "${scope}" (the ones that mention it, one either side), as a dactyl's digest:`;
  return digestOf(deps, chat, { all: turns, picked }, { label: 'phrase', brief: phraseDigestBrief(scope), intro, narrow: 'a narrower phrase reaches them' }, signal);
}

/** `read_session`: names a chat, so the chat becomes the focus; her activity is `reading_session` about it while the read runs. */
function readSession(deps: CompanionToolDeps, args: { session: string; scope: string }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  return guardedToolResult('read_session', 'read the transcript', async () => {
    const found = resolveChat(args.session);
    if (!found.ok) return deps.refuse(found.sentence);
    return deps.withActivity('reading_session', found.chat, null, async () => {
      deps.setFocus(found.chat);
      return readScope(deps, found.chat, args.scope.trim(), signal);
    });
  });
}

/**
 * `list_followups`: the open follow-ups of one chat, or of every chat (newest first), one line each:
 * `chat name · next|gap · text [<plan>: <step>] · #<id>`. The text is the widget's own (`Followup.text`, one plain line by
 * construction), untouched; the id is what `close_followup` takes; and each plan the text names as a whole word is followed
 * by its current step (`followup-plans.ts`), once per plan, so a follow-up that waits on a plan which has since shipped reads
 * stale at a glance. A named chat is listed whole, as the widget shows it (up to the service's 200); every chat together are cut
 * at 20, and the last line says so. It names a chat when one is given, but moves neither her focus nor her activity:
 * she looks at what a chat left for him in passing, while the conversation may be about another.
 */
function listFollowups(deps: CompanionToolDeps, args: { session?: string }): Promise<ToolTextResult> {
  return guardedToolResult('list_followups', 'read the follow-ups', async () => {
    const wanted = args.session?.trim() ?? '';
    let chat: CompanionSessionRef | null = null;
    if (wanted !== '') {
      const found = resolveChat(wanted);
      if (!found.ok) return deps.refuse(found.sentence);
      chat = found.chat;
    }
    const open = listOpenFollowups(deps.userId, chat?.sessionId ?? null, chat ? CHAT_FOLLOWUPS_MAX : FOLLOWUPS_SHOWN + 1);
    if (open.length === 0) return textResult(chat ? `"${chat.name}" has no open follow-ups.` : 'No chat has an open follow-up.');
    const shown = chat ? open : open.slice(0, FOLLOWUPS_SHOWN);
    const steps = await stepBrackets(deps.house, shown.map(({ followup }) => followup.text));
    const lines = shown.map(({ sessionId, followup }, index) => `${chat?.name ?? chatNameOf(sessionId)} · ${followup.kind} · ${followup.text}${steps[index]} · #${followup.id}`);
    const cutNote = chat
      ? open.length >= CHAT_FOLLOWUPS_MAX ? `\nThese are the newest ${CHAT_FOLLOWUPS_MAX}; older open ones are not listed.` : ''
      : open.length > FOLLOWUPS_SHOWN ? `\nMore are open than these ${FOLLOWUPS_SHOWN}; name one chat to see its own.` : '';
    return textResult(lines.join('\n') + cutNote);
  });
}

/**
 * `ask_dactyl`: every file and the context are held to the path rules BEFORE any dactyl starts — one refusal sentence
 * naming every file refused, and nothing runs. Her activity is `reading_code` with the real paths of the files while
 * the dactyls read. A dactyl that refuses on its own (exit 2 or 3) answers its own line as the error. `signal` is the
 * call's: when she is stopped the dactyls are stopped with it.
 */
function askDactyl(deps: CompanionToolDeps, args: { files: string[]; brief: string; context?: string }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  return guardedToolResult('ask_dactyl', 'start the readers', async () => {
    const files = resolveDactylFiles(deps.userId, args.files);
    const wantedContext = args.context?.trim() ?? '';
    const context = wantedContext === '' ? null : resolveDactylFiles(deps.userId, [wantedContext]);
    const refusals = [files, context].flatMap((judged) => (judged !== null && !judged.ok ? [judged.sentence] : []));
    if (!files.ok || (context !== null && !context.ok)) return deps.refuse(refusals.join(' '));

    return deps.withActivity('reading_code', null, files.files, async () => {
      const answer = await runDactylRead(files.files, args.brief, context?.files[0], signal);
      if (!answer.ok) return deps.refuse(answer.error);
      return answer.text === '' ? deps.refuse('The reader printed nothing. Ask again, or ask about a smaller file.') : textResult(answer.text);
    });
  });
}

/**
 * The definitions of `read_session`, `list_followups` and `ask_dactyl` (the order her prompt lists them), built with the
 * SDK's `tool()` and zod. All three are marked read-only: they change nothing of his and the CLI never asks about them.
 * Consumed by `tools/companion-tools.ts` (`buildCompanionTools`), once per account.
 */
export function readTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'read_session',
      toolLine('read_session'),
      {
        session: z.string().trim().min(1).max(200).describe('The chat to read, by its id or its whole name as he says it.'),
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'last_turn: his last message and the reply after it (a long reply comes as a digest). recent: a digest of the last 10 turns. pending_ask: what the chat is waiting on him for. Anything else is a phrase: a digest of the turns that mention it, or the sentence that the transcript does not.'
          ),
      },
      (args, extra) => readSession(deps, args, signalOf(extra)),
      readOnly
    ),
    tool(
      'list_followups',
      toolLine('list_followups'),
      {
        session: z.string().trim().max(200).optional().describe('The chat whose open follow-ups to list, by its id or its whole name. Leave out for every chat.'),
      },
      (args) => listFollowups(deps, args),
      readOnly
    ),
    tool(
      'ask_dactyl',
      toolLine('ask_dactyl'),
      {
        files: z
          .array(z.string().trim().min(1).max(PATH_MAX))
          .min(1)
          .max(FILES_MAX)
          .describe('The files to read, one dactyl each: full paths, or a path inside a project as the project holds it.'),
        brief: z.string().trim().min(1).max(BRIEF_MAX).describe('What you want to know and how short the answer should be, as you would ask a colleague. The same brief goes to every file.'),
        context: z.string().trim().min(1).max(PATH_MAX).optional().describe('One file every dactyl is handed as well, for what the question depends on. Leave out when the files stand alone.'),
      },
      (args, extra) => askDactyl(deps, args, signalOf(extra)),
      readOnly
    ),
  ];
}
