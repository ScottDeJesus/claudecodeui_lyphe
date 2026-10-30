import type { DispatcherPicture } from '@/modules/dispatcher/index.js';
import { listOpenFollowupGroups } from '@/modules/followups/index.js';
import { buildClaudeToolPermissionEntry } from '@/modules/providers/index.js';
import { isRecord } from '@/shared/document-fields.js';
import type { RoadmapPicture } from '@/shared/roadmap-types.js';
import type { StationAskKind, StationNeed } from '@/shared/station-types.js';
import type { DispatcherAsk, DispatcherPlan } from '@/shared/types.js';
import { describeToolInput, oneLine } from '@/shared/tool-call-hint.js';

import { buildCardBook, type Card, type CardBook } from '../eyes/card-lines.js';
import { checkName, findChecks, withoutUsageChecks } from '../eyes/cerberus-lines.js';
import { clipLine } from '../eyes/line-words.js';
import { resolveCard } from '../eyes/roadmap-reads.js';
import { sayOf } from '../hands/action-prompts.js';
import { canBeNamed, holdsActionWord, namesTarget } from '../hands/action-word.js';
import type { CompanionHouse } from '../house.js';
import { oldestPendingAsk, questionsOf, type OldestAsk } from '../tools/ask-decision.js';
import { chatNameOf, chatRows, hiddenChatRows, pendingAsksOf, resolveChat, type ChatRow } from '../tools/house-reads.js';

/**
 * THE FOUR READERS of what needs him, one per family of `StationNeed`. Each reads the house through the door her own eyes and
 * hands read it through, so an item is what she would say of the same thing, and its `say` is built by the SAME `sayOf` her
 * check of his word is built from, and offered only when her resolver for that kind of thing takes it (the card's `resolveCard`,
 * the chat's `resolveChat`, the check's `findChecks`, and `checkHisWord`'s own `canBeNamed` for an action): the rail can never
 * teach him a phrase she would refuse, and an item she could not take by voice carries `say: null`. A reader answers its items in the
 * order the rail shows them and throws when its source cannot be read; `station-needs.ts` isolates each, so one that throws
 * costs its kind and never the rail.
 *
 *   - `planNeeds`: the dispatcher's open Accepts and questions rounds, in the lane's order, each once by its `asked` identity;
 *   - `chatAskNeeds`: each waiting chat's oldest ask, with how many wait behind it;
 *   - `followupNeeds`: the chats' open follow-ups, one item per chat, the chat with the newest one first;
 *   - `checkNeeds`: Cerberus' failing and refused checks, in the tab's own worst-first order.
 *
 * Consumer: `station-needs.ts` (`stationNeeds`).
 */

/** The longest a check's value runs on the rail; the Cerberus tab holds it whole. */
const CHECK_VALUE_MAX = 600;

/** The first line of a text with anything on it, trimmed; empty for a blank text. The dispatcher card's headline rule (`askHeadline`). */
const firstLineOf = (text: string): string => text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';

//----------------- ACCEPTS AND ROUNDS ------------

/** What an item names a card by: the dispatcher's bare name and the title it is drawn under. */
type CardWords = { name: string; title: string };

/** A card's words, or the dispatcher's own name for them when the book holds no such card (a plan the pictures name that neither holds is not a case the book makes today). */
function wordsOf(card: Card | null, fallbackName: string): CardWords {
  return card === null ? { name: fallbackName, title: fallbackName } : { name: card.name, title: card.title ?? card.spoken };
}

/** The two pictures a card is read from, and the book built from them: what the readers of Accepts and rounds share. */
type Pictures = { roadmap: RoadmapPicture | null; picture: DispatcherPicture; book: CardBook };

/**
 * What he says to `action` (`queue` an Accept, `answer` a round) on `card`, or `null` when her side would refuse it: the check of
 * his word cannot be fired by a name that is only filler or the action's own word (`canBeNamed`), the phrase must name the card and
 * hold the action's word (`namesTarget`, `holdsActionWord`), and her resolver must take the spoken name to THIS card (`resolveCard`
 * answers "fits N cards" for a name two cards share, and an epic's is often read off its dashes). The target is the one her hands
 * build for a card (`hands/action-targets.ts`, `findCard`).
 */
function cardSay(action: 'queue' | 'answer', card: Card | null, { roadmap, picture }: Pictures): string | null {
  if (card === null) return null;
  const target = { kind: 'card' as const, name: card.kind === 'arc' ? `${card.name}.arc` : card.name, spoken: card.spoken, arc: card.kind === 'plan' ? card.arc : null };
  if (!canBeNamed(target, action)) return null;
  const say = sayOf(action, card.spoken);
  if (!namesTarget(say, target, action) || !holdsActionWord(say, action)) return null;
  const found = resolveCard(card.spoken, roadmap, picture);
  return found.ok && found.card.kind === card.kind && found.card.name === card.name ? say : null;
}

/** The card of `kind` the book holds under the dispatcher's bare `name`; null when none. */
const cardNamed = (book: CardBook, kind: Card['kind'], name: string): Card | null => book.cards.find((card) => card.kind === kind && card.name === name) ?? null;

/**
 * The Accept on its card: the one feature it names, or — one lock over several features — their epic, which the lead plan's
 * `arc` names (the Inbox's rule, `WaitingAsks.tsx`, and `list_alerts`'). An epic the book does not hold falls back to the lead
 * plan's card, which carries the same lock.
 */
function acceptNeed(ask: Extract<DispatcherAsk, { kind: 'accept' }>, carrier: DispatcherPlan, pictures: Pictures): StationNeed {
  const { picture, book } = pictures;
  const features = ask.plans.length;
  const epicName = features > 1 ? (picture.plans.find((lead) => lead.name === ask.plan)?.arc ?? carrier.arc) : null;
  const epic = epicName === null ? null : cardNamed(book, 'arc', epicName);
  const card = epic ?? cardNamed(book, 'plan', ask.plan) ?? cardNamed(book, 'plan', carrier.name);
  const words = wordsOf(card, ask.plan);
  return {
    kind: 'accept',
    id: `accept:${ask.asked.id}-${ask.asked.at}`,
    card: words.name,
    epic: epic !== null,
    title: words.title,
    headline: firstLineOf(ask.question) || ask.header,
    features,
    say: cardSay('queue', card, pictures),
  };
}

/** A questions round, on the plan it asks about: its first question, and how many there are. */
function roundNeed(ask: Extract<DispatcherAsk, { kind: 'questions' }>, pictures: Pictures): StationNeed {
  const card = cardNamed(pictures.book, 'plan', ask.plan);
  const words = wordsOf(card, ask.plan);
  return {
    kind: 'questions',
    id: `questions:${ask.asked.id}-${ask.asked.at}`,
    card: words.name,
    title: words.title,
    headline: firstLineOf(ask.questions[0]?.text ?? ''),
    count: ask.questions.length,
    say: cardSay('answer', card, pictures),
  };
}

/**
 * The drawn plans' open asks as items, each once by its `asked` identity in the lane's order (a lock that names three cards is
 * one ask). A plan the operator hid draws no card, so its ask is not his to answer from one and is left out (`list_alerts`' rule).
 * Throws while the dispatcher lane has not landed its first reading: nothing is read yet, which is not "nothing waits".
 * Consumed by `station-needs.ts`.
 */
export async function planNeeds(house: CompanionHouse): Promise<StationNeed[]> {
  const [roadmap, picture] = await Promise.all([house.roadmap(), house.dispatcher()]);
  if (picture === null) throw new Error('the dispatcher has not landed its first reading this boot');
  const pictures: Pictures = { roadmap, picture, book: buildCardBook(roadmap, picture) };
  const seen = new Set<string>();
  const needs: StationNeed[] = [];
  for (const plan of picture.plans) {
    const ask = plan.asking;
    if (!ask || plan.hidden !== null) continue;
    const identity = `${ask.asked.id}-${ask.asked.at}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    needs.push(ask.kind === 'accept' ? acceptNeed(ask, plan, pictures) : roundNeed(ask, pictures));
  }
  return needs;
}

// ---------------------------

//----------------- CHATS' ASKS ------------

/** What kind of ask a tool is: `answerFor` gives `AskUserQuestion` and the plan tool (under both names) a shape of their own and every other tool is a permission. */
function askKindOf(toolName: string): StationAskKind {
  if (toolName === 'AskUserQuestion') return 'question';
  return toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode' ? 'plan' : 'permission';
}

/**
 * A text as an ask line holds a command: one line (a break shows as ` ↵ `), 600 characters at most, then a count of what was left
 * out — `describeToolInput`'s own rule, taken through its Bash case, whose body is a bare text. A question's or a plan's text that was
 * cut says so and how much, as a command does, so the stage never offers an Allow on a plan whose cut it cannot tell.
 */
const wholeLine = (text: string): string => describeToolInput('Bash', { command: text }).slice('Bash'.length).trimStart();

/** What the ask would do, whole: a permission is `describeToolInput` (a command whole to 600 characters), a question its first question's text, a plan its text, each cut with a count (`wholeLine`). */
function whatOf(kind: StationAskKind, toolName: string, input: unknown): string {
  if (kind === 'permission') return describeToolInput(toolName, input);
  if (kind === 'question') {
    const questions = questionsOf(input);
    const more = questions.length > 1 ? ` (and ${questions.length - 1} more)` : '';
    return `${wholeLine(questions[0]?.question ?? 'a question')}${more}`;
  }
  return wholeLine(isRecord(input) && typeof input.plan === 'string' ? input.plan : 'a plan is ready and waits for his approval');
}

/** One waiting chat's oldest ask as an item. A permission or a plan is answered by `Allow <chat>`; a question's words are its option, so it has none. */
function chatAskNeed(sessionId: string, chat: string, { ask, more }: OldestAsk): StationNeed {
  const kind = askKindOf(ask.toolName);
  const questions = kind === 'question' ? questionsOf(ask.input) : [];
  return {
    kind: 'ask',
    id: `ask:${ask.requestId}`,
    sessionId,
    requestId: ask.requestId,
    chat,
    ask: kind,
    tool: ask.toolName,
    what: whatOf(kind, ask.toolName, ask.input),
    rule: kind === 'permission' ? buildClaudeToolPermissionEntry(ask.toolName, ask.input) : null,
    options: questions.length === 1 ? questions[0].options.map(oneLine).filter(Boolean) : [],
    more,
    say: kind === 'question' ? null : `Allow ${chat}`,
  };
}

/** The oldest ask of every waiting chat among `rows`, in the order the rows come. A chat whose ask carries no request id cannot be answered and is left out. */
function waitingAsks(rows: ChatRow[]): StationNeed[] {
  return rows.flatMap(({ chat, state }) => {
    if (state !== 'waiting') return [];
    const waiting = oldestPendingAsk(pendingAsksOf(chat.sessionId));
    return waiting === null ? [] : [chatAskNeed(chat.sessionId, chat.name, waiting)];
  });
}

/**
 * Every waiting chat's oldest ask: his chats first, then the chats of hidden roots ("hidden is not gone": a probe's permission still
 * holds its chat, and no list of his chats shows it). Consumed by `station-needs.ts`.
 */
export function chatAskNeeds(): StationNeed[] {
  return [...waitingAsks(chatRows()), ...waitingAsks(hiddenChatRows())];
}

// ---------------------------

//----------------- FOLLOW-UPS ------------

/**
 * What he says to open `chat`'s follow-ups, or `null` when her `open` would not take it: the name must find THIS chat (`resolveChat`
 * answers "fits N chats" for a name two chats share — every unnamed chat is `Untitled Session` — and finds no archived chat at all).
 */
function chatSay(sessionId: string, chat: string): string | null {
  const found = resolveChat(chat);
  return found.ok && found.chat.sessionId === sessionId ? sayOf('open', chat) : null;
}

/**
 * The follow-ups the chats filed for him, one item per chat with its whole open count and its newest text. No tool of hers files one —
 * the chats do, and she carries them. The lane groups and counts over every open row of the account (`listOpenFollowupGroups`), so no
 * ceiling cuts a chat out or under-reads it, and answers the chat with the newest follow-up first. Consumed by `station-needs.ts`.
 */
export function followupNeeds(userId: number): StationNeed[] {
  return listOpenFollowupGroups(userId).map(({ sessionId, count, newest }) => {
    const chat = chatNameOf(sessionId);
    return { kind: 'followups', id: `followups:${sessionId}`, sessionId, chat, count, newest: newest.text, say: chatSay(sessionId, chat) };
  });
}

// ---------------------------

//----------------- RED CHECKS ------------

/**
 * Cerberus' failing and refused checks in the tab's own worst-first order (a yellow check is a warning, and his word is "red").
 * A check of the usage family is on the rail and has no spoken words: her eyes never see it and her `open` never finds it (ruling 17);
 * nor has a check whose label fits several checks, which her `open` refuses.
 * Consumed by `station-needs.ts`.
 */
export function checkNeeds(house: CompanionHouse): StationNeed[] {
  const overview = house.cerberus();
  const sayable = withoutUsageChecks(overview);
  const sayableChecks = new Set(sayable.needsYou.map(({ check }) => check));
  return overview.needsYou.flatMap(({ check }) => {
    if (check.status !== 'failing' && check.status !== 'denied') return [];
    const label = checkName(check);
    return [{
      kind: 'check',
      id: `check:${check.node}/${check.key}`,
      node: check.node,
      key: check.key,
      label,
      status: check.status,
      value: check.value === null ? null : clipLine(check.value, CHECK_VALUE_MAX),
      since: check.since,
      // Her `open` finds a check by `findChecks` over the overview without the usage family, and refuses a phrase that fits several.
      say: sayableChecks.has(check) && findChecks(sayable, label).length === 1 ? sayOf('open', label) : null,
    } satisfies StationNeed];
  });
}

// ---------------------------
