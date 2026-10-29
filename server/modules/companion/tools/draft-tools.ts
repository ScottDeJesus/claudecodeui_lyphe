import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { CompanionDraftTarget, CompanionNote, CompanionSessionRef, CompanionWalk } from '@/shared/companion-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { characterCount, DRAFT_TEXT_MAX } from '../companion-input.js';
import { escapeText } from '../session/companion-envelopes.js';
import { toolLine } from '../session/companion-prompt.js';

import type { CompanionToolDeps } from './companion-tools.js';
import { resolveChat, resolveProject } from './house-reads.js';

/**
 * The six tools that put her work on his screen and send it: `update_draft` (the one brief she keeps, with its
 * target; an empty text clears both), `show_note` (a card, for what is better seen than heard) and `dismiss_note`
 * (takes one down), `walk` (the walkthrough's cursor), and `send_to_session` / `create_session` (the draft going
 * out). The first four write through the account's store, so the matching frame (`companion_draft`, `companion_note`,
 * `companion_note_removed`, `companion_walk`) reaches his panel the moment she calls it, and the answer is one plain
 * sentence.
 *
 * THE DRAFT IS THE ONLY THING SENT. There is one draft at a time, addressed to a chat or to a new chat in a
 * project; `send_to_session` and `create_session` send it as it stands, and their text must equal it, trimmed.
 * So the draft is replaced whole, never patched, and he sees the very words that will go. The sending itself is
 * `deps.sendDraft` (`companion-send.ts`), the same verb as the panel's Send: these two tools only name what they
 * mean to send and say what happened. A mismatch is refused, and the refusal names the draft.
 *
 * THE WALK'S CURSOR lives in the store, because her conversation's hold on it does not survive her own compaction or a turn
 * to another chat: `walk` carries the cursor, the store holds it, and `<state>` restates it after a compaction.
 * One walk per account; a call that would MOVE it by naming another chat without `items` is refused rather
 * than guessed at, while `at` 0 ends the held walk whichever chat is named (its own chat may be gone).
 *
 * A tool that names a chat makes it her focus (`update_draft` for a chat, `walk`, and a send once it has gone), and
 * sets her activity while it runs (`drafting`, `walking`) through the harness's `withActivity`. A refusal is `isError` text that
 * says what to do next (`deps.refuse`); a write that throws is logged and answered the same way
 * (`guardedToolResult`).
 *
 * Each description is her prompt's own line for the tool (`toolLine`), so what the tool list says and what her
 * system prompt says are one text; the arguments' own descriptions say what the prompt's shorthand leaves out
 * (the prompt's `update_draft(target, …)` is the pair `session` / `project` here).
 *
 * Consumer: `tools/companion-tools.ts`, which adds these six to the tools it builds.
 */

/** A note card's longest title, in characters. Consumed by `show_note` below and by `eyes/eyes-answer.ts` (`toPanel`), so an eyes answer put on his panel is cut where `show_note` refuses. */
export const NOTE_TITLE_MAX = 80;
/** A note card's longest text, in characters. Consumed by `show_note` below and by `eyes/eyes-answer.ts` (`toPanel`). */
export const NOTE_TEXT_MAX = 4_000;

/**
 * The limits of the table: a draft is a full brief, a note a card (above), a walk a list of short titles. The draft's own
 * (`DRAFT_TEXT_MAX`, counted in characters as a person counts them) is the one `PUT /draft` uses, imported so the
 * route and this tool cannot disagree.
 */
const WALK_ITEMS_MAX = 60;
const WALK_ITEM_MAX = 120;
const CHAT_TITLE_MAX = 60;

/** The words of a send, which must be the draft's own: counted in characters as `PUT /draft` counts them. */
const sentText = z
  .string()
  .min(1)
  .refine((text) => characterCount(text) <= DRAFT_TEXT_MAX, `The text is over ${DRAFT_TEXT_MAX} characters; the draft cannot be that long.`)
  .describe('The draft\'s text exactly as update_draft last stored it. A text that differs from the draft is refused, and the refusal shows the draft.');

/** Where `update_draft` was asked to aim, resolved: the target to store, the chat it names (none for a new chat) and how the answer names it. */
type DraftAim = { target: CompanionDraftTarget; chat: CompanionSessionRef | null; label: string };

/** The aim of one `update_draft` call, or the sentence that refuses it. Exactly one of `session` and `project` is given; a blank one counts as absent. */
function aimOf(session: string, project: string): { ok: true; aim: DraftAim } | { ok: false; sentence: string } {
  if ((session === '') === (project === '')) {
    return { ok: false, sentence: 'Give exactly one of session (the chat the brief is for) or project (a new chat in that project): not both, and not neither.' };
  }
  if (session !== '') {
    const found = resolveChat(session);
    if (!found.ok) return found;
    return { ok: true, aim: { target: { kind: 'session', session: found.chat }, chat: found.chat, label: found.chat.name } };
  }
  const found = resolveProject(project);
  if (!found.ok) return found;
  return {
    ok: true,
    aim: { target: { kind: 'new', projectPath: found.project.path, projectName: found.project.name }, chat: null, label: `a new chat in ${found.project.name}` },
  };
}

/**
 * An empty `update_draft`: clears the draft and its target, the verb the panel's own button has (`DELETE /draft`). A clear
 * names no chat, so her focus stays where it was and no activity is set; with no draft held there is nothing to write,
 * and the answer is plain text, not a refusal.
 */
function clearDraft(deps: CompanionToolDeps): ToolTextResult {
  if (deps.store.readState().draft === null) return textResult('There was no draft to clear.');
  deps.store.setDraft(null);
  return textResult('Draft cleared.');
}

/**
 * `update_draft`: replaces the draft and its target, or, given an empty text (blank after trim), clears them (`clearDraft`).
 * The empty text is tested FIRST: a clear needs no target, so `session` / `project` are not looked at. A non-empty text is
 * stored exactly as given (no trim): `send_to_session` compares what it is handed with it, so the draft must be the words
 * she will pass again.
 */
function updateDraft(deps: CompanionToolDeps, args: { session?: string; project?: string; text: string }): Promise<ToolTextResult> {
  return guardedToolResult('update_draft', 'keep the draft', async () => {
    if (args.text.trim() === '') return clearDraft(deps);
    const aimed = aimOf(args.session?.trim() ?? '', args.project?.trim() ?? '');
    if (!aimed.ok) return deps.refuse(aimed.sentence);
    const { target, chat, label } = aimed.aim;
    return deps.withActivity('drafting', chat, null, async () => {
      // The write first: a write that fails must not leave the panel on a chat she was told the draft is not for.
      deps.store.setDraft({ target, text: args.text });
      if (chat !== null) deps.setFocus(chat);
      return textResult(`Draft for ${label}: ${characterCount(args.text)} characters.`);
    });
  });
}

/** `show_note`: one card on his panel; it stays until he dismisses it or she does (`dismiss_note`). The answer names the card's number, which is how she can take it down. */
function showNote(deps: CompanionToolDeps, args: { title: string; text: string }): Promise<ToolTextResult> {
  return guardedToolResult('show_note', 'put the note on his panel', () => {
    const note = deps.store.addNote({ title: args.title, text: args.text });
    return textResult(`On his panel as card ${note.id}.`);
  });
}

/**
 * A card as her answers name it: its number and its title on one line (`2 "Lane diff"`), so she can say which card went
 * and choose between old ones. The title is stored text, escaped as an envelope escapes it (`escapeText`).
 */
const cardLabel = (card: CompanionNote): string => `${card.id} "${escapeText(card.title.replace(/\s+/g, ' ').trim())}"`;

/**
 * `dismiss_note`: takes one card off his panel, the one by its number or, with none given, the newest (the highest
 * number). It goes through the store's `removeNote`, as the panel's ✕ does (`DELETE /notes/:id`), so only this account's
 * cards can be named. A number that is not up is refused naming the ones that are, each with its title, so she can correct
 * herself. A card he dismissed in the same instant is not a refusal: the store answers `false` and the card is gone either way.
 */
function dismissNote(deps: CompanionToolDeps, args: { note?: number }): Promise<ToolTextResult> {
  return guardedToolResult('dismiss_note', 'take the card down', () => {
    const cards = [...deps.store.listNotes()].sort((a, b) => a.id - b.id);
    if (cards.length === 0) return deps.refuse('There is no card on his panel.');
    const card = args.note === undefined ? cards[cards.length - 1] : cards.find((candidate) => candidate.id === args.note);
    if (card === undefined) return deps.refuse(`No card ${args.note} is on his panel; up now: ${cards.map(cardLabel).join(', ')}.`);
    return textResult(`Card ${cardLabel(card)} ${deps.store.removeNote(card.id) ? 'taken down' : 'was already gone'}.`);
  });
}

/** The sentence a move that cannot go on answers with, when the chat named is not the held walk's own. */
const otherWalkSentence = (held: string, wanted: string): string =>
  `The walkthrough held is of "${held}", not "${wanted}". Name "${held}" to move it, give items to start one for "${wanted}" in its place, or use at 0 to end it.`;

/**
 * The walk's activity and its answer: `walking` (with the walk's place, which is why callers write the walk first)
 * around the focus following `chat`, when there is a chat that can still be named.
 */
function announceWalk(deps: CompanionToolDeps, chat: CompanionSessionRef | null, sentence: string): Promise<ToolTextResult> {
  return deps.withActivity('walking', chat, null, async () => {
    if (chat !== null) deps.setFocus(chat);
    return textResult(sentence);
  });
}

/**
 * `at` 0: ends the held walk, WHICHEVER chat is named and before any chat is resolved. There is one walk per account
 * and the chat it was of can be archived or deleted afterwards, after which it can no longer be named, so ending
 * must never depend on resolving it. The focus follows the chat named only when it can still be named.
 */
function endWalk(deps: CompanionToolDeps, held: CompanionWalk | null, session: string): Promise<ToolTextResult> {
  if (held === null) return Promise.resolve(textResult('There is no walkthrough open, so there is nothing to end.'));
  deps.store.setWalk(null);
  const named = resolveChat(session);
  return announceWalk(deps, named.ok ? named.chat : null, `Walkthrough of ${held.session.name} ended.`);
}

/**
 * `walk`: starts, moves or ends the walkthrough. `items` is how one is started or its list replaced; without it the
 * held list is used, and only the held walk's own chat may be moved that way. `at` 1..n moves the cursor, beyond n
 * is refused with the count, 0 ends the walk (`endWalk`; it says nothing of `items`).
 *
 * The walk is WRITTEN BEFORE the activity is set: the activity states the place the walk has reached (`at` of
 * `total`), and `withActivity` reads it from the store at the moment it sets the activity.
 */
function walk(deps: CompanionToolDeps, args: { session: string; items?: string[]; at: number }): Promise<ToolTextResult> {
  return guardedToolResult('walk', 'move the walkthrough', async () => {
    const held = deps.store.readState().walk;
    if (args.at === 0) return endWalk(deps, held, args.session);
    const found = resolveChat(args.session);
    if (!found.ok) return deps.refuse(found.sentence);
    const chat = found.chat;
    const heldHere = held !== null && held.session.sessionId === chat.sessionId;

    const items = args.items ?? (heldHere ? held.items : null);
    if (items === null) {
      return deps.refuse(
        held === null
          ? `There is no walkthrough yet: give items (the short titles, up to ${WALK_ITEMS_MAX}) to start one for "${chat.name}", with at 1 for the first.`
          : otherWalkSentence(held.session.name, chat.name)
      );
    }
    if (args.at > items.length) {
      return deps.refuse(`at is ${args.at}, but the walkthrough has ${items.length} ${items.length === 1 ? 'item' : 'items'}: use 1 to ${items.length}, or 0 to end it.`);
    }
    deps.store.setWalk({ session: chat, items, at: args.at });
    return announceWalk(deps, chat, `Item ${args.at} of ${items.length}: ${items[args.at - 1]}.`);
  });
}

/** What a send answers: the sentence of a send that went, or the refusal that says what to do next. */
const answerSend = (deps: CompanionToolDeps, sent: { outcome: string; sentence: string }): ToolTextResult =>
  sent.outcome === 'refused' ? deps.refuse(sent.sentence) : textResult(sent.sentence);

/**
 * `send_to_session`: sends the draft to the chat she names, as `mode` asks. The draft must be for that chat and the
 * text must equal it; a chat that is working takes the brief into its running turn whichever mode was asked.
 */
function sendToSession(deps: CompanionToolDeps, args: { session: string; text: string; mode: 'turn' | 'steer' }): Promise<ToolTextResult> {
  return guardedToolResult('send_to_session', 'send the brief', async () => {
    const found = resolveChat(args.session);
    if (!found.ok) return deps.refuse(found.sentence);
    const { chat } = found;
    return deps.withActivity('drafting', chat, null, async () => answerSend(deps, await deps.sendDraft({ mode: args.mode, text: args.text, chat })));
  });
}

/**
 * `create_session`: starts a new chat in `project` with the draft as its first message, named `title`. The draft must be
 * for a new chat in that project and the text must equal it. The new chat becomes her focus and opens on his screen.
 */
function createSession(deps: CompanionToolDeps, args: { project: string; text: string; title: string }): Promise<ToolTextResult> {
  return guardedToolResult('create_session', 'start the chat', async () => {
    const found = resolveProject(args.project);
    if (!found.ok) return deps.refuse(found.sentence);
    const newChat = { projectPath: found.project.path, title: args.title };
    return deps.withActivity('drafting', null, null, async () => answerSend(deps, await deps.sendDraft({ mode: 'turn', text: args.text, newChat })));
  });
}

/**
 * The definitions of `show_note`, `dismiss_note`, `update_draft`, `walk`, `send_to_session` and `create_session` (this file's order, not the prompt's: `walk` stands before the two sends here and last in the prompt), built with the SDK's
 * `tool()` and zod. None is read-only (each writes what he sees), so none carries `readOnlyHint`; the CLI asks no
 * permission for them regardless, because `allowedTools` names every tool of hers.
 */
export function draftTools(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  return [
    tool(
      'show_note',
      toolLine('show_note'),
      {
        title: z.string().trim().min(1).max(NOTE_TITLE_MAX).describe('The card\'s heading: a few words.'),
        text: z.string().trim().min(1).max(NOTE_TEXT_MAX).describe('What goes on the card: the list, the path, the diff or the numbers, as plain text.'),
      },
      (args) => showNote(deps, args)
    ),
    tool(
      'dismiss_note',
      toolLine('dismiss_note'),
      {
        note: z.number().int().min(1).optional().describe('The card\'s number, as show_note answered it. Leave out to take down the newest card.'),
      },
      (args) => dismissNote(deps, args)
    ),
    tool(
      'update_draft',
      toolLine('update_draft'),
      {
        session: z.string().trim().max(200).optional().describe('The chat the brief is for, by its id or its whole name as he says it, never a part of it. Give this or project, never both.'),
        project: z.string().trim().max(1000).optional().describe('The project a NEW chat would start in, by its display name or path. Give this or session, never both.'),
        // Counted in characters as `PUT /draft` counts them (a refinement, not `.max`, which counts UTF-16 units and would refuse text the route accepts).
        text: z
          .string()
          .refine((text) => characterCount(text) <= DRAFT_TEXT_MAX, `The draft is over ${DRAFT_TEXT_MAX} characters: keep the brief to what the chat needs.`)
          .describe(`The whole brief as it now stands, up to ${DRAFT_TEXT_MAX} characters: it replaces the draft on his screen, and it is the text that is sent. An empty text clears the draft and its target; give neither session nor project then.`),
      },
      (args) => updateDraft(deps, args)
    ),
    tool(
      'walk',
      toolLine('walk'),
      {
        session: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('The chat the walkthrough is attached to, by its name or id: the one whose result is being walked. When he named the items himself, it is the chat this conversation has been about, the last one you drafted for or named; never ask him which.'),
        items: z
          .array(z.string().trim().min(1).max(WALK_ITEM_MAX).regex(/^[^\r\n\u2028\u2029]+$/, 'An item is a short title on one line: no line break.'))
          .min(1)
          .max(WALK_ITEMS_MAX)
          .optional()
          .describe('The short titles of the items, in order: read out of a chat\'s result, or named by him himself ("walk me through these three: …"). Required to start a walkthrough or to replace its list; leave out to keep the list held.'),
        at: z.number().int().min(0).describe('The item now under discussion, counted from 1; 0 ends the walkthrough.'),
      },
      (args) => walk(deps, args)
    ),
    tool(
      'send_to_session',
      toolLine('send_to_session'),
      {
        session: z.string().trim().min(1).max(200).describe('The chat the draft is for, by its id or its whole name. The draft must be addressed to it.'),
        text: sentText,
        mode: z.enum(['turn', 'steer']).describe('turn starts a turn; steer folds the brief into the turn the chat is running now. A chat that is working takes it as a steer whichever you say; a steer to an idle chat starts a turn.'),
      },
      (args) => sendToSession(deps, args)
    ),
    tool(
      'create_session',
      toolLine('create_session'),
      {
        project: z.string().trim().min(1).max(1000).describe('The project the new chat starts in, by its display name or path. The draft must be addressed to a new chat in it.'),
        text: sentText,
        title: z
          .string()
          .trim()
          .min(1)
          .max(CHAT_TITLE_MAX)
          .regex(/^[^\r\n\u2028\u2029]+$/, 'A title is one line: no line break.')
          .describe(`The new chat's name in his list: a few words, up to ${CHAT_TITLE_MAX} characters.`),
      },
      (args) => createSession(deps, args)
    ),
  ];
}
