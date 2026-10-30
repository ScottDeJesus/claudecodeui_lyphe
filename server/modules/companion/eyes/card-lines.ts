import type { DispatcherPicture } from '@/modules/dispatcher/index.js';
import type { RoadmapEpic, RoadmapFeature, RoadmapFeatureWord, RoadmapPicture } from '@/shared/roadmap-types.js';
import type { DispatcherArc, DispatcherAsk, DispatcherPlan, DispatcherStall } from '@/shared/types.js';

import { doorWords, whenWords } from './eyes-answer.js';
import { clipLine } from './line-words.js';
import { epicWord, featureWord, phaseWords, planStatusWord, shortDate, stepWords } from './panel-words.js';

/**
 * THE CARD BOOK: every card the house knows, as the Roadmap tab and the In flight face say it, and the lines they make.
 *
 * A CARD is a plan or an arc of the dispatcher's picture, or a feature or an epic of the roadmap's: the two pictures name the
 * same things, so a card is found once under its name and carries whichever rows the two pictures hold for it. The roadmap holds
 * every feature the house ever cut (a shipped one stays on it for good) while the dispatcher drops a finished plan a day after it
 * ends, so a card shipped last week is a roadmap row alone; a scratch store's plan is a dispatcher row alone, or an `unplaced`
 * roadmap row (a name, a title and a word). Nothing here reads a cost, a token count, a paid vendor or a runtime: those fields of
 * the rows are never touched (ruling 1). Every word is the panels' (`panel-words.ts`). Strings and rows in, strings out, no I/O.
 *
 * Consumers: `roadmap-reads.ts` (the lists and the card's resolution), `card-scopes.ts` (the card's scopes) and
 * `tools/followup-plans.ts` (the step beside a follow-up that names a plan).
 */

//----------------- THE BOOK ------------

/** One feature as the roadmap holds it: its row (null for an unplaced one, which has only a title and a word) and the epic it sits under (null when none). */
type FeatureRow = { title: string; word: RoadmapFeatureWord; feature: RoadmapFeature | null; epic: RoadmapEpic | null };

/** One epic as the roadmap holds it: its row (null for an unplaced one, which has only a name and a title). */
type EpicRow = { title: string; epic: RoadmapEpic | null };

/**
 * One card. `kind` is `plan` (a feature) or `arc` (an epic); `name` the dispatcher's bare name, with no `.arc`; `title` the
 * roadmap's title or null when the roadmap holds none; `spoken` the name he says it by (a title of six words or fewer, else the
 * name with its dashes read as spaces). `arc` is the bare name of the epic a plan sits in (null for an arc and for a plan of no
 * epic), `epicTitle` that epic's title. `feature` is the roadmap's full row of a plan and `unplacedWord` the word of an unplaced
 * one; `epic` is the epic row an arc IS, or the epic a plan sits under; `plan` and `dispatcherArc` are the dispatcher's rows.
 * Consumed by this file's readers, `card-scopes.ts`, `roadmap-reads.ts` and the hands' `resolveCard` calls.
 */
export type Card = {
  kind: 'plan' | 'arc';
  name: string;
  title: string | null;
  spoken: string;
  arc: string | null;
  epicTitle: string | null;
  feature: RoadmapFeature | null;
  unplacedWord: RoadmapFeatureWord | null;
  epic: RoadmapEpic | null;
  plan: DispatcherPlan | null;
  dispatcherArc: DispatcherArc | null;
};

/** The cards and the two lookups a line needs: the dispatcher's plans by name and the roadmap's features by name. Consumed by this file, `card-scopes.ts` and `roadmap-reads.ts`. */
export type CardBook = { cards: Card[]; plans: ReadonlyMap<string, DispatcherPlan>; rows: ReadonlyMap<string, FeatureRow> };

/**
 * The name he says a card by: its title when that is six words or fewer, else its name with the dashes read as spaces
 * ("kaylee--eyes" is "kaylee eyes"). Private to `buildCardBook`, whose `Card.spoken` carries it to every other reader.
 */
function spokenOf(title: string | null, name: string): string {
  const said = title?.trim() ?? '';
  if (said !== '' && said.split(/\s+/).length <= 6) return said;
  return name.split('-').filter((part) => part !== '').join(' ');
}

/**
 * Every card of the two pictures, once each. Either picture may be null (a lane that has not landed): the book then holds what
 * the other picture knows. Cards come roadmap first, in the roadmap's own order, then the dispatcher's alone. Consumed by the
 * card reads and by `tools/followup-plans.ts`.
 */
export function buildCardBook(roadmap: RoadmapPicture | null, dispatcher: DispatcherPicture | null): CardBook {
  const rows = new Map<string, FeatureRow>();
  const epics = new Map<string, EpicRow>();
  for (const placed of roadmap?.roadmaps ?? []) {
    for (const milestone of placed.milestones) {
      for (const epic of milestone.epics) {
        epics.set(epic.name, { title: epic.title, epic });
        for (const feature of epic.features) rows.set(feature.name, { title: feature.title, word: feature.word, feature, epic });
      }
    }
  }
  for (const item of roadmap?.unplaced.features ?? []) if (!rows.has(item.name)) rows.set(item.name, { title: item.title, word: item.word, feature: null, epic: null });
  for (const item of roadmap?.unplaced.epics ?? []) if (!epics.has(item.name)) epics.set(item.name, { title: item.title, epic: null });

  const plans = new Map((dispatcher?.plans ?? []).map((plan) => [plan.name, plan] as const));
  const arcs = new Map((dispatcher?.arcs ?? []).map((arc) => [arc.name, arc] as const));
  const cards: Card[] = [];
  for (const name of new Set([...rows.keys(), ...plans.keys()])) {
    const row = rows.get(name);
    const plan = plans.get(name) ?? null;
    const arc = plan?.arc ?? row?.epic?.name ?? null;
    const title = row?.title ?? null;
    cards.push({
      kind: 'plan',
      name,
      title,
      spoken: spokenOf(title, name),
      arc,
      epicTitle: arc === null ? null : (epics.get(arc)?.title ?? arc),
      feature: row?.feature ?? null,
      unplacedWord: row !== undefined && row.feature === null ? row.word : null,
      epic: row?.epic ?? (arc === null ? null : (epics.get(arc)?.epic ?? null)),
      plan,
      dispatcherArc: null,
    });
  }
  for (const name of new Set([...epics.keys(), ...arcs.keys()])) {
    const row = epics.get(name);
    const title = row?.title ?? null;
    cards.push({
      kind: 'arc',
      name,
      title,
      spoken: spokenOf(title, name),
      arc: null,
      epicTitle: null,
      feature: null,
      unplacedWord: null,
      epic: row?.epic ?? null,
      plan: null,
      dispatcherArc: arcs.get(name) ?? null,
    });
  }
  return { cards, plans, rows };
}

// ---------------------------

//----------------- MATCHING A PHRASE ------------

/** Text as it is compared when he says a card rather than types it: lower case, apostrophes dropped, every other run of non-letters and non-digits one space. Consumed by `holds` and `resolveCard`. */
export const norm = (text: string): string => text.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether `text` holds `phrase`, without regard to case, and with punctuation set aside ("kaylee eyes" is found in "kaylee--eyes"). An empty phrase holds nothing. Consumed by the roadmap and card reads. */
export function holds(text: string, phrase: string): boolean {
  if (phrase.trim() === '') return false;
  if (text.toLowerCase().includes(phrase.toLowerCase())) return true;
  const wanted = norm(phrase);
  return wanted !== '' && norm(text).includes(wanted);
}

// ---------------------------

//----------------- A CARD'S STATE, IN THE PANELS' WORDS ------------

/** The title of the first card in `names` that has not shipped, which is what a `waiting` step names (`useStepPhrase.ts`); null when the roadmap cannot name one. */
function firstUnshipped(names: readonly string[], book: CardBook): string | null {
  for (const name of names) {
    const row = book.rows.get(name);
    if (row !== undefined && row.word !== 'shipped') return row.title;
  }
  return null;
}

/** A feature's step in the Roadmap tab's words: "being designed", "waiting on you: Accept", "waiting on The day sheet", "shipped Oct 27". Private to the state words below. */
function stepWordsOf(feature: RoadmapFeature, book: CardBook): string {
  return stepWords(feature.step, {
    waitingOn: feature.step === 'waiting' ? firstUnshipped(feature.waits_on, book) : null,
    shippedOn: feature.step === 'shipped' ? shortDate(feature.shipped_at ?? '') : null,
  });
}

/**
 * A card's state as one phrase: a feature `<Word>: <step words>` ("Shipped: shipped Oct 27"), an unplaced one its word alone, a plan the
 * roadmap does not hold its In flight badge ("LIVE"), an epic its word ("In progress"). Consumed by the lines and the summary.
 */
export function stateWords(card: Card, book: CardBook): string {
  if (card.kind === 'arc') {
    if (card.epic !== null) return epicWord(card.epic.word);
    return card.dispatcherArc === null ? 'not on a roadmap' : planStatusWord(card.dispatcherArc.status);
  }
  if (card.feature !== null) return `${featureWord(card.feature.word)}: ${stepWordsOf(card.feature, book)}`;
  if (card.unplacedWord !== null) return featureWord(card.unplacedWord);
  return card.plan === null ? 'not on a roadmap' : planStatusWord(card.plan.status);
}

/** The step of the plan named `name` alone, for a follow-up that names it: a feature's step words, an unplaced one's word, a plan's badge; null for a name the book does not hold. Consumed by `tools/followup-plans.ts`. */
export function planStepWords(name: string, book: CardBook): string | null {
  const row = book.rows.get(name);
  if (row?.feature) return stepWordsOf(row.feature, book);
  if (row !== undefined) return featureWord(row.word);
  const plan = book.plans.get(name);
  return plan === undefined ? null : planStatusWord(plan.status);
}

/** The words of a stall's cause: why a run that has ended is not recorded as ended. Consumed by the plan summary in `card-scopes.ts`. */
export function stallWords(cause: DispatcherStall): string {
  return cause === 'dispatcher_down' ? 'the dispatcher is not running' : 'its run ended with nothing recorded';
}

/** The plans a card waits on that are not complete, each with its step words: `The day sheet (building)`. A plan that is complete on the In flight face or shipped on the roadmap is no longer waited on. Consumed by the plan summary in `card-scopes.ts`. */
export function waitsOnWords(card: Card, book: CardBook): string[] {
  const names = card.plan?.waits_on ?? card.feature?.waits_on ?? [];
  return names.flatMap((name) => {
    if (book.plans.get(name)?.status === 'complete' || book.rows.get(name)?.word === 'shipped') return [];
    const step = planStepWords(name, book);
    const label = book.rows.get(name)?.title ?? name;
    return [step === null ? label : `${label} (${step})`];
  });
}

/** When it was approved and by whom, in words ("approved today 14:02 on the card"); the roadmap's row alone knows when but not by whom. Null before an approval. Consumed by the summary and the prompt scope in `card-scopes.ts`. */
export function approvedWords(card: Card): string | null {
  if (card.plan?.approved) return `approved ${whenWords(card.plan.approved.at)} ${doorWords(card.plan.approved.by)}`;
  return card.feature?.approved_at ? `approved ${whenWords(card.feature.approved_at)}` : null;
}

// ---------------------------

//----------------- A CARD'S TASKS AND ITS PROMPT ------------

/** One task: its place, its title (cut to one line), its state as the In flight face says it and its chain once launched. Consumed by `taskRows`' callers in `card-scopes.ts`. */
type CardTask = { position: number; title: string; status: 'not started' | 'running' | 'done'; words: string; chainId: string | null };

/** The longest a task's title runs in a line: titles in this house are sentences. */
const TASK_TITLE_MAX = 140;

/** A card's tasks in order: the dispatcher's phases when it holds the plan (they carry the chain and the stall), else the roadmap's tasks. An epic has none of its own. Consumed by `cardLine` here and by the summary, phases and history scopes in `card-scopes.ts`. */
export function taskRows(card: Card): CardTask[] {
  if (card.plan !== null && card.plan.phases.length > 0) {
    return card.plan.phases.map((phase) => ({ position: phase.position, title: clipLine(phase.title, TASK_TITLE_MAX), status: phase.status, words: phaseWords(phase), chainId: phase.chain_id }));
  }
  return (card.feature?.tasks ?? []).map((task, index) => ({
    position: index + 1,
    title: clipLine(task.title, TASK_TITLE_MAX),
    status: task.status,
    words: phaseWords({ status: task.status, stalled: null, busy: true }),
    chainId: null,
  }));
}


/**
 * The prompt that is up on a card: a plan's own, or for an epic its lead plan's: the plan of the epic whose ask names that plan
 * as the one asking. Null when nothing is asked. Consumed by the summary, the prompt and the questions scopes.
 */
export function openAsk(card: Card, book: CardBook): DispatcherAsk | null {
  if (card.kind === 'plan') return card.plan?.asking ?? null;
  const names = card.dispatcherArc?.plans ?? card.epic?.features.map((feature) => feature.name) ?? [];
  for (const name of names) {
    const ask = book.plans.get(name)?.asking;
    if (ask && ask.plan === name) return ask;
  }
  return null;
}

/** An open prompt in one line: "it is waiting on your Accept", "it has 3 questions open". Consumed by the summaries in `card-scopes.ts`. */
export function askWords(ask: DispatcherAsk): string {
  if (ask.kind === 'accept') return 'it is waiting on your Accept';
  return `it has ${ask.questions.length} ${ask.questions.length === 1 ? 'question' : 'questions'} open`;
}

// ---------------------------

//----------------- THE LINES ------------

/** Whether a plan's work is in flight: the roadmap's word where it holds one, else a dispatcher plan that has not completed or idled. */
function inFlight(card: Card): boolean {
  if (card.feature !== null) return card.feature.word === 'in flight';
  if (card.unplacedWord !== null) return card.unplacedWord === 'in flight';
  return card.plan !== null && !['complete', 'idle', 'parked'].includes(card.plan.status);
}

/** What a card is called at the head of a line: its title, or the name he says it by, then its dispatcher name (once, when they are the same word). Consumed by the lines here and the plan summary. */
export function headOf(card: Card): string[] {
  const said = card.title ?? card.spoken;
  return said === card.name ? [card.name] : [said, card.name];
}

/** An epic's line: `<title> · <name> · <epic word> · <shipped> of <n> features shipped`, plus ` · <k> waiting on you` when any feature is. Consumed by `cardLine` here and by the epic's summary in `card-scopes.ts`. */
export function epicLine(card: Card): string {
  const { epic, dispatcherArc } = card;
  const head = headOf(card);
  if (epic !== null) {
    const waiting = epic.features.filter((feature) => feature.waiting_on_you !== null).length;
    const parts = [...head, epicWord(epic.word), `${epic.standing.shipped} of ${epic.standing.features} features shipped`];
    return (waiting > 0 ? [...parts, `${waiting} waiting on you`] : parts).join(' · ');
  }
  return [...head, dispatcherArc === null ? 'not placed on a roadmap yet' : planStatusWord(dispatcherArc.status)].join(' · ');
}

/**
 * A card's line. A feature: `<title> · <name> · <Word>: <step words> · epic <epic title>`, plus ` · <done> of <n> tasks` while in
 * flight. An epic: `epicLine`. A card with no roadmap row says what the dispatcher says of it. Consumed by `list_roadmap`, the
 * epic's summary and the phrase search.
 */
export function cardLine(card: Card, book: CardBook): string {
  if (card.kind === 'arc') return epicLine(card);
  const parts = [...headOf(card), stateWords(card, book)];
  if (card.epicTitle !== null) parts.push(`epic ${card.epicTitle}`);
  const tasks = taskRows(card);
  if (inFlight(card) && tasks.length > 0) parts.push(`${tasks.filter((task) => task.status === 'done').length} of ${tasks.length} tasks`);
  return parts.join(' · ');
}

// ---------------------------
