import type { DispatcherEvent } from '@/shared/types.js';

import { characterCount } from '../companion-input.js';
import { NOTE_TEXT_MAX } from '../tools/draft-tools.js';

import { approvedWords, askWords, cardLine, epicLine, headOf, holds, openAsk, stallWords, stateWords, taskRows, waitsOnWords, type Card, type CardBook } from './card-lines.js';
import { cappedLines, doorWords, INLINE_MAX_CHARACTERS, whenWords } from './eyes-answer.js';
import { clipLine, fitLines } from './line-words.js';
import { planStatusWord } from './panel-words.js';

/**
 * THE SCOPES OF `read_card` THAT NEED NO TEXT FROM THE DISPATCHER: a card's summary, open Accept prompt, open questions, tasks and
 * history, each rendered from the two pictures' rows (`card-lines.ts`) in the panels' own words; and the two helpers the design
 * scopes use on the dispatcher's `show` text (cutting the spend its header may carry, and finding the paragraphs that hold a phrase).
 * Nothing here says a cost, a token count, a paid vendor, a runtime or the pacer (ruling 1): the rows' spend fields are never read.
 * Consumer: `roadmap-reads.ts`.
 */

/**
 * What a scope answers: `text` (after `intro`), the `title` it takes on his panel, the scratch `label` and the `brief` a dactyl
 * digests it under (null: always whole); `panel` is the longer text his panel holds when `text` is cut to the inline limit.
 * Consumed by the scope functions below and by `roadmap-reads.ts`, which turns a reading into the answer.
 */
export type Reading = { title: string; intro: string; text: string; label: string; brief: string | null; panel?: string };

/** The brief for an Accept prompt whose census is past what is handed over whole. */
const PROMPT_BRIEF = 'What does this prompt ask him to approve: what it delivers, how many tasks, and anything it says he should know first? At most 10 lines; cite L<n>.';

/** The most task lines `phases` shows, and the most history lines. */
const TASKS_MAX = 30;
const EVENTS_MAX = 20;

const whole = (card: Card, scope: string, text: string): Reading => ({ title: `${card.spoken}: ${scope}`, intro: '', text, label: `card-${scope}`, brief: null });

/** The plan cards named `names`, in that order, from the book. */
function plansNamed(names: readonly string[], book: CardBook): Card[] {
  const byName = new Map(book.cards.filter((card) => card.kind === 'plan').map((card) => [card.name, card] as const));
  return names.flatMap((name) => byName.get(name) ?? []);
}

/** The names of an epic's features: the roadmap's, else the plans the dispatcher says it holds. */
const featureNames = (card: Card): string[] => card.epic?.features.map((feature) => feature.name) ?? card.dispatcherArc?.plans ?? [];

// ---------------------------

//----------------- SUMMARY ------------

/** A plan's summary lines after its heading: state, epic, what it waits on, the In flight face's badge, a stall, the running task, the open prompt. */
function planSummary(card: Card, book: CardBook): string[] {
  const tasks = taskRows(card);
  const { plan } = card;
  const facts = [stateWords(card, book)];
  const approved = approvedWords(card);
  if (approved !== null) facts.push(approved);
  if (card.feature === null && plan?.completed_at) facts.push(`completed ${whenWords(plan.completed_at)}`);
  if (tasks.length > 0) facts.push(`${tasks.filter((task) => task.status === 'done').length} of ${tasks.length} tasks`);
  const lines = [facts.join(' · ')];
  if (card.epicTitle !== null) lines.push(`Epic: ${card.epicTitle}`);
  const waits = waitsOnWords(card, book);
  if (waits.length > 0) lines.push(`Waits on: ${waits.join('; ')}`);
  if (plan !== null) {
    const clauses = [planStatusWord(plan.status)];
    if (plan.hidden) clauses.push(`hidden since ${whenWords(plan.hidden.at)}`);
    else if (plan.status === 'queued') clauses.push('held for its Start');
    lines.push(`In flight face: ${clauses.join(' · ')}`);
  }
  const stalled = plan?.stalled ?? plan?.phases.find((phase) => phase.stalled !== null)?.stalled ?? null;
  if (stalled !== null) lines.push(`Stalled: ${stallWords(stalled)}.`);
  const running = tasks.filter((task) => task.status === 'running');
  if (running.length > 0) lines.push(`Running: ${running.map((task) => `${task.position}. ${task.title}`).join('; ')}`);
  const ask = openAsk(card, book);
  if (ask !== null) lines.push(`Open: ${askWords(ask)}.`);
  return lines;
}

/**
 * `summary`, handed over whole. A plan: its heading, then `<Word>: <step words> · approved <when> <door> · <done> of <n> tasks` and
 * the lines of `planSummary`. An epic: its line (word and features shipped) and each feature's line. Consumed by `read_card`.
 */
export function summaryReading(card: Card, book: CardBook): Reading {
  if (card.kind === 'plan') return whole(card, 'summary', [headOf(card).join(' · '), ...planSummary(card, book)].join('\n'));
  const lines = [epicLine(card)];
  if (card.dispatcherArc !== null) lines.push(`In flight face: ${planStatusWord(card.dispatcherArc.status)}`);
  const ask = openAsk(card, book);
  if (ask !== null) lines.push(`Open: ${askWords(ask)}.`);
  const features = plansNamed(featureNames(card), book).map((feature) => cardLine(feature, book));
  lines.push(features.length === 0 ? 'No features yet.' : `Features:\n${cappedLines(features)}`);
  return whole(card, 'summary', lines.join('\n'));
}

// ---------------------------

//----------------- PROMPT AND QUESTIONS ------------

/** The sentence after "No Accept prompt is open": when it was approved, or that it has not been. An epic counts its approved features. */
function approvalLine(card: Card, book: CardBook): string {
  if (card.kind === 'plan') {
    const approved = approvedWords(card);
    return approved === null ? 'It has not been approved.' : `It was ${approved}.`;
  }
  const features = plansNamed(featureNames(card), book);
  return `${features.filter((feature) => approvedWords(feature) !== null).length} of its ${features.length} features are approved.`;
}

/**
 * `prompt`: the open Accept prompt as the card draws it (`header`, `question`, the three answers' labels), else "No Accept
 * prompt is open on <card>." with its approval line. A census past 2,000 characters carries the brief a dactyl digests it under.
 * Consumed by `read_card`.
 */
export function promptReading(card: Card, book: CardBook): Reading {
  const ask = openAsk(card, book);
  if (ask?.kind === 'accept') {
    const answers = `Answers: ${ask.options.map((option) => option.label).join(' / ')}`;
    const title = `${card.spoken}: the Accept prompt`;
    const intro = `The Accept prompt on ${card.spoken}:`;
    if (characterCount(ask.question) <= INLINE_MAX_CHARACTERS) {
      return { title, intro, text: [ask.header, ask.question, answers].filter((part) => part !== '').join('\n'), label: 'card-prompt', brief: null };
    }
    // A long census is digested ALONE: the card's header and its three answers stay in the answer, not inside the file a dactyl may quote or drop.
    return { title, intro: [intro, ask.header, answers, 'Its census:'].filter((part) => part !== '').join('\n'), text: ask.question, label: 'card-prompt', brief: PROMPT_BRIEF };
  }
  const other = ask === null ? '' : ' Its questions are open instead; read_card with scope questions shows them.';
  return whole(card, 'prompt', `No Accept prompt is open on ${card.spoken}.${other} ${approvalLine(card, book)}`);
}

/** `questions`: the open round, each question and its options verbatim, numbered; else "No questions are open on <card>." Consumed by `read_card`. */
export function questionsReading(card: Card, book: CardBook): Reading {
  const ask = openAsk(card, book);
  if (ask?.kind !== 'questions') return whole(card, 'questions', `No questions are open on ${card.spoken}.`);
  const lines = ask.questions.map((question, index) => [`${index + 1}. ${question.text}`, ...question.options.map((option) => `   - ${option}`)].join('\n'));
  return whole(card, 'questions', `${ask.questions.length} ${ask.questions.length === 1 ? 'question is' : 'questions are'} open on ${card.spoken}:\n${lines.join('\n')}`);
}

// ---------------------------

//----------------- TASKS ------------

/** `phases`: one line per task, `<k>. <title> — <phase words>`, plus ` · run <chain id>` once launched; the first 30. An epic has none of its own. Consumed by `read_card`. */
export function phasesReading(card: Card, book: CardBook): Reading {
  if (card.kind === 'arc') {
    const names = featureNames(card);
    return whole(card, 'phases', `${card.spoken} is an epic and has no tasks of its own; read one of its features: ${names.slice(0, 10).join(', ')}${names.length > 10 ? `, and ${names.length - 10} more` : ''}.`);
  }
  const tasks = taskRows(card);
  if (tasks.length === 0) return whole(card, 'phases', `${card.spoken} has no tasks yet.`);
  const lines = tasks.map((task, index) => `${index + 1}. ${task.title} — ${task.words}${task.chainId === null ? '' : ` · run ${task.chainId}`}`);
  const heading = `${card.spoken}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}:`;
  const fitted = fitLines(lines, { max: TASKS_MAX }).split('\n');
  // A list cut to the inline limit closes on a line that points where the rest can be had: fitLines' "give a phrase" would send
  // her to a phrase on `read_card`, which searches the design and cannot list tasks.
  const cut = /^And \d+ more/.test(fitted.at(-1) ?? '');
  // His note holds NOTE_TEXT_MAX characters: fit the lines to it, so the closing lines say how many the note holds.
  const room = NOTE_TEXT_MAX - Array.from(heading).length - 80;
  const onPanel: string[] = [];
  let used = 0;
  for (const line of lines.slice(0, TASKS_MAX)) {
    const next = used + Array.from(line).length + 1;
    if (onPanel.length > 0 && next > room) break;
    onPanel.push(line);
    used = next;
  }
  const panelLeft = lines.length - onPanel.length;
  const holding = panelLeft === 0 ? 'the list' : `the first ${onPanel.length}`;
  const text = cut ? [...fitted.slice(0, -1), `And ${lines.length - (fitted.length - 1)} more tasks; panel: true puts ${holding} on his panel.`].join('\n') : fitted.join('\n');
  const panel = `${heading}\n${[...onPanel, ...(panelLeft > 0 ? [`And ${panelLeft} more tasks.`] : [])].join('\n')}`;
  return { ...whole(card, 'phases', `${heading}\n${text}`), panel };
}

// ---------------------------

//----------------- HISTORY ------------

/** The lifecycle events said in words; every other kind (settling, planner outings, the pacer, moves, edits) is left unsaid. A `relayed` event is the sentence the dispatcher prints for it. */
function eventWords(event: DispatcherEvent): string | null {
  switch (event.kind) {
    case 'added':
    case 'promoted':
    case 'hidden':
    case 'shown':
    case 'paused':
    case 'resumed':
    case 'complete':
      return event.kind;
    case 'design-loaded':
      return 'design loaded';
    case 'phases-loaded':
      return 'tasks loaded';
    case 'asked':
      return event.detail === 'questions' ? 'asked for his answers' : 'asked for his Accept';
    case 'approved':
      return `approved ${doorWords(event.detail ?? '')}`;
    case 'relayed':
      return event.detail === null ? 'carried on his word by Kaylee' : clipLine(event.detail, 400);
    default:
      return null;
  }
}

/** The tasks' launches, finishes and declines counted, never listed: "Its tasks so far: 14 launched, 14 done."; null when none. */
function taskCounts(events: readonly DispatcherEvent[]): string | null {
  const counts = (['launched', 'done', 'declined'] as const).map((kind) => [kind, events.filter((event) => event.kind === kind).length] as const);
  const said = counts.filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${kind}`);
  return said.length === 0 ? null : `Its tasks so far: ${said.join(', ')}.`;
}

/**
 * The dates the roadmap holds for a card with no log of the dispatcher's, newest first: `[iso, words]`. A plan has its four dates; an
 * epic has no log at all and is `complete` only while its word says so (an epic keeps a completion stamp from when its first
 * features finished, and a live one must never read as finished).
 */
function datedWords(card: Card): Array<[string, string]> {
  const { feature, epic, dispatcherArc } = card;
  let stamps: Array<[string | null | undefined, string]> = [];
  if (card.kind === 'plan' && feature !== null) {
    stamps = [[feature.created_at, 'added'], [feature.promoted_at, 'promoted'], [feature.approved_at, 'approved'], [feature.shipped_at, 'complete']];
  } else if (card.kind === 'arc') {
    const finished = epic !== null ? epic.word === 'complete' : dispatcherArc?.status === 'complete';
    stamps = [[(epic ?? dispatcherArc)?.created_at, 'added'], [finished ? (epic?.completed_at ?? dispatcherArc?.completed_at) : null, 'complete']];
  }
  return stamps.flatMap(([stamp, words]) => (stamp ? [[stamp, words] as [string, string]] : [])).sort((a, b) => b[0].localeCompare(a[0]));
}

/**
 * `history`: the card's events, newest first, the first 20, each `<when> · <what>`, then its tasks counted. A plan the dispatcher no
 * longer holds (shipped more than a day ago) is told from the dates the roadmap keeps, and says so; an epic never has a log, and
 * says that. Consumed by `read_card`.
 */
export function historyReading(card: Card): Reading {
  const events = card.plan?.events;
  if (events === undefined) {
    const dated = datedWords(card);
    if (dated.length === 0) return whole(card, 'history', `No history is held for ${card.spoken}.`);
    const lines = dated.map(([stamp, words]) => `${whenWords(stamp)} · ${words}`);
    const done = taskRows(card).filter((task) => task.status === 'done').length;
    const counted = done > 0 ? [`Its tasks so far: ${done} done.`] : [];
    // An epic, an idea and a proposal never had a log; only a plan the lane dropped a day after it ended "no longer" has one.
    const word = card.feature?.word ?? card.unplacedWord;
    const never = card.kind === 'arc' ? 'An epic keeps no log of its own' : word === 'idea' || word === 'proposed' ? `${card.spoken} is not a plan yet and has no log` : null;
    const why = never === null ? `The dispatcher no longer keeps a log for ${card.spoken}; these are the dates the roadmap holds:` : `${never}; the roadmap holds for ${card.spoken}:`;
    return whole(card, 'history', [why, ...lines, ...counted].join('\n'));
  }
  const said = [...events].reverse().flatMap((event) => {
    const words = eventWords(event);
    return words === null ? [] : [`${whenWords(event.at)} · ${words}`];
  });
  const shown = said.slice(0, EVENTS_MAX);
  const left = said.length - shown.length;
  const counted = taskCounts(events);
  const lines = [...(shown.length === 0 ? [`${card.spoken} has no history yet.`] : shown), ...(left > 0 ? [`And ${left} earlier ${left === 1 ? 'event' : 'events'}.`] : []), ...(counted === null ? [] : [counted])];
  return whole(card, 'history', lines.join('\n'));
}

// ---------------------------

//----------------- THE DESIGN'S TEXT ------------

/** What a header segment says that is spend: dollars, a token count ("1998.9M in", "15.5M out"), the cache share, or the time agents worked. */
const SPEND_SEGMENT = /\$\s?\d|\b\d[\d.,]*\s*[KMBG]?\s+(?:in|out)\b|cache\)|\bworking\b|\btokens?\b|\bcost\b/i;

/** How far down the text the header block reaches (title, `repo:`, `waits on:`, `model:`, `goal:`). */
const HEADER_LINES = 8;

/**
 * The dispatcher's `show` text with the spend its header may carry cut out: an epic's first line reads
 * `kaylee.arc — live — 11 plans — 1998.9M in (98% cache) · 15.5M out · 1d 6h working` (its spend segments go), and the header's
 * `model: deepseek` line names the paid vendor (it goes, in the first eight lines only). A design's prose can still name a price,
 * which the digest's brief forbids saying. Consumed by `read_card`'s design and phrase scopes.
 */
export function designText(text: string): string {
  const [header, ...rest] = text.split('\n');
  // The first segment is the card's own name, which may hold a word like `cost-report`: only the segments after it are tested.
  const kept = header.split(' — ').filter((segment, index) => index === 0 || !SPEND_SEGMENT.test(segment));
  return [kept.join(' — '), ...rest.filter((line, index) => index >= HEADER_LINES || !/^model:/i.test(line))].join('\n');
}

/**
 * The paragraphs of `text` that hold `phrase`, each with the paragraph either side, windows that touch made one and a gap marked
 * "[…]"; null when none holds it. A paragraph is a run of lines between blank lines. Consumed by `read_card`'s phrase scope.
 */
export function paragraphsAround(text: string, phrase: string): string | null {
  const paragraphs = text.split(/\n[ \t]*\n/);
  const keep = new Set<number>();
  paragraphs.forEach((paragraph, index) => {
    if (!holds(paragraph, phrase)) return;
    for (const near of [index - 1, index, index + 1]) if (near >= 0 && near < paragraphs.length) keep.add(near);
  });
  if (keep.size === 0) return null;
  const picked = [...keep].sort((a, b) => a - b);
  return picked.map((index, at) => (at > 0 && index !== picked[at - 1] + 1 ? `[…]\n\n${paragraphs[index]}` : paragraphs[index])).join('\n\n');
}

// ---------------------------
