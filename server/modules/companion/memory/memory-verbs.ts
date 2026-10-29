import { companionDb, userDb } from '@/modules/database/index.js';
import { isSayableName } from '@/shared/sayable-name.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { characterCount } from '../companion-input.js';
import { toPanel, whenWords } from '../eyes/eyes-answer.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { onBank } from './bank-chain.js';
import { bankDoor, isUnanswered, type BankAnswer, type BankRow } from './bank-door.js';
import { findHisLine, firstQuote, memoryBody, MEMORY_BODY_MAX, quoteLine, quotesAlike, quotesOf, SAME_SUBJECT_LOGIT, type HisLine, type KeptWhy } from './memory-words.js';

/**
 * HER THREE VERBS ON HER BANK, and the one clear: `recall`, `remember`, `forget` and `clearMemory`. Every read and every write goes
 * through her door (`bank-door.ts`), and every write runs inside `onBank` (`bank-chain.ts`), so one bank write runs at a time whichever
 * account asked. The words of a memory are `memory-words.ts`'s: the SERVER writes a memory's body from his spoken log lines (ruling 4),
 * and she writes only its title and one line of context. CloudCLI stores no memory (ruling 1): the only thing kept here is the forget
 * guard's log id, in `companion_state.memory_forget_line`.
 *
 * WHAT EACH VERB DOES NOT DO. Nothing here sets an activity (a read of her bank runs as `thinking`, as an eyes read does), pushes a
 * memory into her context (ruling 3: she recalls, or nothing of it is there) or carries usage or spend (ruling 2). A verb never throws
 * on the door: every door call answers a sentence, which is handed to her as a refusal.
 *
 * THE FORGET GUARD. One word of his forgets at most five memories: a forget names one to five tokens and needs a line of his with an id
 * greater than the one the last forget used (`memory_forget_line`). "Forget everything" therefore cannot empty the bank five at a time.
 * Only `clearMemory` empties it, and it has two callers: the Settings route and the hands' `clear_memory`.
 *
 * Consumers: `memory/memory-tools.ts` (the three tools), `memory/memory-settings.ts` (`clearMemory`, `accountName`, for the Settings route) and
 * `hands/action-doors.ts` (`clearMemory`, on his word).
 */

/** The whole of the log her store keeps for an account (`COMPANION_LOG_KEEP` in the repository), which is where a line of his is looked for. */
const WHOLE_LOG = 400;

/** A token of the docstore's two tables, which is what `recall` reads whole. */
const TOKEN = /^(INV|MAN)-\d+$/;

/** How many lines a recall shows, how many of the closest memories a twin check looks at, and how many words of a quote a recall line carries. */
const RECALL_LIMIT = 8;
const TWIN_LOOK = 3;
const QUOTE_CUT = 100;

/** The most memories one word of his forgets. */
const FORGET_MOST = 5;

/** What `remember` is handed: the shape of the tool's zod schema (`memory-tools.ts`). Consumed by `memory-tools.ts`. */
export type RememberInput = {
  kind: 'rule' | 'gotcha' | 'landmine' | 'manual';
  title: string;
  said: string[];
  why: KeptWhy;
  context?: string;
  corrects?: string;
  also?: boolean;
};

/** A sentence closed with a full stop, whatever the door ended its own with. */
const closed = (sentence: string): string => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);

/** What `clearMemory` is told: whose act clears her bank, and when or on which line of his. */
type ClearCause = { kind: 'settings'; account: string; at: string } | { kind: 'word'; account: string; line: HisLine };

/** What `clearMemory` answers: how many memories were forgotten, or the sentence saying why it stopped. */
type ClearAnswer = { ok: true; forgotten: number } | { ok: false; sentence: string };

/**
 * The name of the account a memory is said through: the CloudCLI username (`scott`, `verve`). Both accounts are his, so her bank is
 * one and each memory names the account it came through. Consumed by `memory-settings.ts` (the reason of a clear in Settings), by
 * `hands/action-doors.ts` (the reason of a clear on his word) and here.
 */
export function accountName(userId: number): string {
  return userDb.getUserById(userId)?.username ?? `account ${userId}`;
}

/** A memory as a recall line: `<title> · <token> · said <when> · “<first quote>”`, or its title and token alone when its body quotes no one. */
function recallLine(row: BankRow): string {
  const first = quotesOf(row.body)[0];
  if (first === undefined) return `${row.title} · ${row.token}`;
  return `${row.title} · ${row.token} · said ${whenWords(first.at)} · “${firstQuote(row.body, QUOTE_CUT)}”`;
}

/** What a recall answers before `panel` is considered: a memory whole by its token, or the lines the closest memories make. Refusals are `isError` and nothing is put on the panel for them. */
async function recalled(deps: CompanionToolDeps, about: string): Promise<{ answer: ToolTextResult; carded: boolean }> {
  const unreachable = (sentence: string) => ({ answer: deps.refuse(`Your memory can't be reached just now: ${sentence.replace(/[.!?]+$/, '')}. Go on without it.`), carded: false });
  if (TOKEN.test(about)) {
    const got = await bankDoor.get(about);
    if (!got.ok) {
      if (isUnanswered(got.sentence)) return unreachable(got.sentence);
      // A token the door answers 404 for (a forgotten one) is refused with the door's own sentence; a door that cannot read at all cannot list either.
      const listed = await bankDoor.list();
      return listed.ok ? { answer: deps.refuse(closed(got.sentence)), carded: false } : unreachable(listed.sentence);
    }
    if (!got.value.mine) return { answer: deps.refuse('That is not one of your memories.'), carded: false };
    return { answer: textResult(`${got.value.title} · ${got.value.kind} · ${got.value.token}\n${got.value.body}`), carded: true };
  }

  const found = await bankDoor.search(about, RECALL_LIMIT);
  if (!found.ok) return unreachable(found.sentence);
  if (found.value.length > 0) return { answer: textResult(found.value.map(recallLine).join('\n')), carded: true };

  // An empty search is not proof of an empty bank (the door's search fails open), so the bank is asked for its list before "nothing" is said.
  const listed = await bankDoor.list();
  if (!listed.ok) return unreachable(listed.sentence);
  return { answer: textResult(listed.value.length === 0 ? 'You keep nothing yet.' : 'You keep nothing about that.'), carded: false };
}

/**
 * `recall`: her memory by meaning, or one memory whole by its token. A token that is not hers (a house row) is refused, so her
 * recall never reads the house. With `panel` the answer goes on his panel as a card titled "From her memory" and she is told only that
 * it is there (`toPanel`); a refusal and a "nothing kept" answer are hers to read and are never carded. Reads only, and no activity.
 * Consumed by `memory-tools.ts`.
 */
export async function recall(deps: CompanionToolDeps, input: { about: string; panel?: boolean }): Promise<ToolTextResult> {
  const { answer, carded } = await recalled(deps, input.about.trim());
  return input.panel === true && carded ? toPanel(deps, 'From her memory', answer) : answer;
}

/** `remember`'s refusal of a door's sentence, for a call that read the bank (nothing was written). */
const notKept = (sentence: string): ToolTextResult => textResult(`Not kept: ${closed(sentence)}`, true);

/**
 * `remember`'s refusal of a WRITE the door would not take. "Did not answer" is this side giving up, not the door's word that it wrote
 * nothing, so for it the outcome is unknown and she is told to recall before asking again (an at-once retry would keep a second copy).
 */
const writeFailed = (sentence: string): ToolTextResult =>
  isUnanswered(sentence) ? textResult(`Not confirmed: ${closed(sentence)} It may have been kept: recall before asking again.`, true) : notKept(sentence);

/** The first quote of a body, cut for an answer, or `null` when it quotes no one. */
const quoted = (body: string): string | null => firstQuote(body, QUOTE_CUT);

/** The rewrite of the memory `corrects` names: it must be hers, and its first quote before and after is the answer. */
async function correction(deps: CompanionToolDeps, input: RememberInput, corrects: string, body: string): Promise<ToolTextResult> {
  const held = await bankDoor.get(corrects);
  if (!held.ok) return notKept(held.sentence);
  if (!held.value.mine) return deps.refuse(`${corrects} is not one of your memories.`);

  const written = await bankDoor.write({ token: corrects, kind: input.kind, title: input.title, body });
  if (!written.ok) return writeFailed(written.sentence);
  const before = quoted(held.value.body);
  const after = quoted(body);
  const change = before === null ? `Now it says “${after}”.` : `It said “${before}”; now it says “${after}”.`;
  return textResult(`Corrected ${written.value.token} (${input.title}). ${change}`);
}

/** The refusal of a new memory that is about the same thing as a held one: how it was said, and the two ways forward. */
function sameSubjectSentence(held: BankRow): string {
  const first = quotesOf(held.body)[0];
  const said = first === undefined ? '' : ` He said, ${whenWords(first.at)}: “${firstQuote(held.body, QUOTE_CUT)}”.`;
  return `Not kept yet: ${held.token} (${held.title}) is about the same thing.${said} If this corrects it, remember again with corrects ${held.token}. If both stand, remember again with also.`;
}

/**
 * A held memory that quotes the same words, found by READING the bank. The door's `search` fails open (a statement past its cap answers an
 * empty 200 while `list` and `get` still work) and answers nothing for an unrelated memory as well, so an empty search cannot be taken for
 * "no twin": the check that must hold asks `list` and reads each row. Her bank is small by design (a few lines a memory), so this is a few
 * loopback calls.
 */
async function twinByReading(body: string): Promise<BankAnswer<{ token: string; title: string } | null>> {
  const listed = await bankDoor.list();
  if (!listed.ok) return listed;
  for (const memory of listed.value) {
    const held = await bankDoor.get(memory.token);
    if (!held.ok) return held;
    if (quotesAlike(held.value.body, body)) return { ok: true, value: memory };
  }
  return { ok: true, value: null };
}

/** A new memory: refused when a held one quotes the same words (always), or is about the same thing (unless `also`); otherwise written. */
async function newMemory(deps: CompanionToolDeps, input: RememberInput, lines: HisLine[], body: string): Promise<ToolTextResult> {
  const near = await bankDoor.search(`${input.title}\n${lines.map((line) => line.text).join('\n')}`, TWIN_LOOK);
  if (!near.ok) return notKept(near.sentence);

  let twin: { token: string; title: string } | undefined = near.value.find((row) => quotesAlike(row.body, body));
  if (twin === undefined && near.value.length === 0) {
    const read = await twinByReading(body);
    if (!read.ok) return notKept(read.sentence);
    twin = read.value ?? undefined;
  }
  if (twin !== undefined) return deps.refuse(`That is already kept as ${twin.token} (${twin.title}).`);
  const same = near.value.find((row) => row.score !== null && row.score >= SAME_SUBJECT_LOGIT);
  if (same !== undefined && input.also !== true) return deps.refuse(sameSubjectSentence(same));

  const written = await bankDoor.write({ kind: input.kind, title: input.title, body });
  return written.ok ? textResult(`Kept as ${written.value.token}: ${input.title}.`) : writeFailed(written.sentence);
}

/** Every `said` as his spoken log line, in the order given and each once, or the sentence refusing the first that is not. */
function hisLines(deps: CompanionToolDeps, said: string[]): { ok: true; lines: HisLine[] } | { ok: false; sentence: string } {
  const rows = deps.store.readLog(WHOLE_LOG);
  const lines: HisLine[] = [];
  for (const text of said) {
    const found = findHisLine(text, rows);
    if (!found.ok) return found;
    if (!lines.some((line) => line.id === found.line.id)) lines.push(found.line);
  }
  return { ok: true, lines };
}

/** `remember`, in order: the title, his lines, the body's size, then the correction or the new memory. */
async function rememberInOrder(deps: CompanionToolDeps, input: RememberInput): Promise<ToolTextResult> {
  if (input.corrects !== undefined && input.also === true) return deps.refuse('Say one: corrects rewrites that memory, also keeps both.');
  if (!isSayableName(input.title)) return deps.refuse('A title is a few words you can say aloud.');
  const his = hisLines(deps, input.said);
  if (!his.ok) return deps.refuse(his.sentence);

  const body = memoryBody({ account: accountName(deps.userId), lines: his.lines, why: input.why, context: input.context ?? null });
  if (characterCount(body) > MEMORY_BODY_MAX) return deps.refuse('Too long to keep whole: carry only the lines that say it.');

  return input.corrects === undefined ? newMemory(deps, input, his.lines, body) : correction(deps, input, input.corrects, body);
}

/**
 * `remember`: keeps one thing he said, in his own words. The body is written here from his SPOKEN log lines (a typed line is refused),
 * so a memory is never her paraphrase of him. A new memory is refused when a held one quotes the same words (read off the bank itself when
 * the search finds no row, `twinByReading`), and, unless she says
 * `also`, when a held one scores at or over `SAME_SUBJECT_LOGIT` against it: she then says it `corrects` that memory or stands `also`.
 * The two together are refused. The whole of it runs inside `onBank`. Consumed by `memory-tools.ts`.
 */
export function remember(deps: CompanionToolDeps, input: RememberInput): Promise<ToolTextResult> {
  return onBank(() => rememberInOrder(deps, input));
}

/** `forget`, in order: his line (new since the last forget), every token read before any is retired, then the retires one by one. */
async function forgetInOrder(deps: CompanionToolDeps, input: { memories: string[]; said: string }): Promise<ToolTextResult> {
  const tokens = [...new Set(input.memories)];
  if (tokens.length === 0 || tokens.length > FORGET_MOST) return deps.refuse(`A forget names one to ${FORGET_MOST} memories.`);
  const his = hisLines(deps, [input.said]);
  if (!his.ok) return deps.refuse(his.sentence);
  const [line] = his.lines;
  const used = companionDb.readState(deps.userId)?.memory_forget_line ?? null;
  if (used !== null && line.id <= used) return deps.refuse('That word of his already forgot something. Each forget needs a new word of his.');

  // Every token is read before any is retired, so one that is not hers retires nothing.
  const held: Array<{ token: string; title: string }> = [];
  for (const token of tokens) {
    const got = await bankDoor.get(token);
    if (!got.ok) return deps.refuse(`Not forgotten: ${closed(got.sentence)}`);
    if (!got.value.mine) return deps.refuse(`${token} is not one of your memories.`);
    held.push({ token, title: got.value.title });
  }

  const reason = quoteLine(accountName(deps.userId), line);
  const gone: string[] = [];
  for (const memory of held) {
    const retired = await bankDoor.retire(memory.token, reason);
    if (!retired.ok) {
      const stopped = closed(retired.sentence);
      // "Did not answer" leaves the outcome unknown (the door may still retire it), so it is never told as "nothing was forgotten".
      const unknown = isUnanswered(retired.sentence);
      if (gone.length === 0) return deps.refuse(unknown ? `Not confirmed: ${stopped} It may have been forgotten: recall before asking again.` : `Nothing was forgotten: ${stopped}`);
      companionDb.writeState(deps.userId, { memory_forget_line: line.id });
      return deps.refuse(`Forgot ${gone.length}: ${gone.join(', ')}. Then ${memory.token} (${memory.title}) stopped it: ${stopped}${unknown ? ' It may have been forgotten too.' : ''} Ask again with a new word of his for the rest.`);
    }
    gone.push(memory.title);
  }
  companionDb.writeState(deps.userId, { memory_forget_line: line.id });
  return textResult(`Forgot ${gone.length}: ${gone.join(', ')}. The docstore's history keeps them.`);
}

/**
 * `forget`: stops keeping one to five memories on his word. `said` is his spoken line; it must be newer than the one the last forget
 * used. Every token must be hers, and none is retired until all are read. The docstore's history keeps what was forgotten, with his
 * words as the reason. The whole of it runs inside `onBank`. Consumed by `memory-tools.ts`.
 */
export function forget(deps: CompanionToolDeps, input: { memories: string[]; said: string }): Promise<ToolTextResult> {
  return onBank(() => forgetInOrder(deps, input));
}

/** `clearMemory`, inside `onBank`: her bank listed once and every row retired with the cause as its reason. */
async function clearInOrder(cause: ClearCause): Promise<ClearAnswer> {
  const listed = await bankDoor.list();
  if (!listed.ok) return { ok: false, sentence: `Your memory can't be reached just now: ${listed.sentence.replace(/[.!?]+$/, '')}.` };

  const reason = cause.kind === 'settings' ? `${cause.account} cleared her memory in Settings, ${cause.at}.` : quoteLine(cause.account, cause.line);
  let forgotten = 0;
  for (const memory of listed.value) {
    const retired = await bankDoor.retire(memory.token, reason);
    if (!retired.ok) {
      const before = forgotten === 0 ? '' : `${forgotten} of ${listed.value.length} were forgotten before it: `;
      const unknown = isUnanswered(retired.sentence) ? ' That one may have been forgotten too.' : '';
      return { ok: false, sentence: `${before}${closed(retired.sentence)}${unknown}` };
    }
    forgotten += 1;
  }
  return { ok: true, forgotten };
}

/**
 * Every memory of her bank retired through her door, the cause as each reason. HAS TWO CALLERS ONLY, both his own act: the Settings
 * route (through `memory-settings.ts`, `kind: 'settings'`) and the hands' `clear_memory` (`hands/action-doors.ts`, `kind: 'word'` with the
 * firing line); no tool of hers reaches it. A refusal part way answers `{ ok: false, sentence }`, the sentence saying how many were
 * forgotten before it. The docstore's history keeps every row.
 */
export function clearMemory(cause: ClearCause): Promise<ClearAnswer> {
  return onBank(() => clearInOrder(cause));
}
