import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { DispatcherPicture } from '@/modules/dispatcher/index.js';
import type { RoadmapPicture } from '@/shared/roadmap-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { toolLine } from '../session/companion-prompt.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';
import { signalOf } from '../tools/read-tools.js';

import { buildCardBook, cardLine, holds, norm, type Card, type CardBook } from './card-lines.js';
import {
  designText,
  historyReading,
  paragraphsAround,
  phasesReading,
  promptReading,
  questionsReading,
  summaryReading,
  type Reading,
} from './card-scopes.js';
import { answerRead, toPanel } from './eyes-answer.js';
import { fitLines } from './line-words.js';

/**
 * Her eyes on the roadmap: `list_roadmap` lists its features and epics in the Roadmap tab's own words, and `read_card` reads one
 * card. Both read the panels' own pictures through the house (`house.roadmap()`, `house.dispatcher()`, and `house.cardText(name)` for
 * a design), both are read-only, and neither names a chat, so neither moves her focus or her activity: a read runs as `thinking`.
 * A picture that has not landed yet answers "The roadmap has not been read yet; ask again in a moment." (`read_card` reads the
 * dispatcher's too, and says "The dispatcher has not been read yet…" when only that one is missing).
 *
 * A CARD is a plan or an arc of the dispatcher's picture or a feature or an epic of the roadmap's (`card-lines.ts`), found by `resolveCard`.
 * `list_roadmap(scope, panel)` answers one line per card, the first 20 that fit 2,000 characters: `waiting` (what waits on him), `active`
 * (being designed or built), `recent` (shipped in the last 7 days, newest first), `epics` (In progress first, then Not started, then
 * the rest), or a phrase over names, titles and goals.
 * `read_card(card, scope, panel)` answers by scope: `summary`, `prompt`, `questions`, `phases` and `history` from the pictures'
 * rows (`card-scopes.ts`); `design` and a phrase from the dispatcher's `show` text, handed over whole when short and else digested by
 * a dactyl under a fixed brief. `panel: true` puts the whole answer on his panel as a note. No answer says a cost, a token count, a
 * paid vendor, a runtime or the pacer (ruling 1); every brief forbids it. Each description is her prompt's own line (`toolLine`).
 *
 * Consumers: `tools/companion-tools.ts` (`roadmapReads`, once per account) and the hands (`resolveCard`, which resolves every card an
 * action names).
 */

/** What both tools say while a lane has not landed its first reading this boot. */
const NOT_READ_YET = 'The roadmap has not been read yet; ask again in a moment.';

/** What `read_card` says when the roadmap has landed and the dispatcher's picture, which it also reads, has not. */
const DISPATCHER_NOT_READ_YET = 'The dispatcher has not been read yet; ask again in a moment.';

/** How far back `recent` looks, and how many names a several-fit refusal spells out. */
const RECENT_DAYS = 7;
const FITS_NAMED = 10;

/** The briefs a dactyl is handed for a design, each ending as every eyes brief does: where to cite from, and how short. */
const DESIGN_BRIEF = 'What does this design build, how is it shaped, what did it decide, and what is still open? At most 15 lines; cite L<n>.';
const phraseBrief = (phrase: string): string => `What does this design say about: ${phrase}? At most 12 lines; cite L<n>.`;

// ---------------------------

//----------------- FINDING A CARD ------------

/** A card found, or the sentence that refuses and says what to do. Consumed by `read_card` here and by every hands action that names a card. */
export type CardResolution = { ok: true; card: Card } | { ok: false; sentence: string };

/** `name`, spelled as `resolveCard` takes it back: an epic's with its `.arc`, so a plan and an epic of one name stay two. */
const refName = (card: Card): string => (card.kind === 'arc' ? `${card.name}.arc` : card.name);

/** One match as it is named in a refusal: `name (title)`. */
const fitName = (card: Card): string => (card.title === null ? refName(card) : `${refName(card)} (${card.title})`);

/** The one card of `found`, or the refusal naming each (the first ten) that `ref` fits. */
function oneOf(found: Card[], ref: string): CardResolution {
  if (found.length === 1) return { ok: true, card: found[0] };
  const named = found.slice(0, FITS_NAMED).map(fitName).join(', ');
  const rest = found.length > FITS_NAMED ? `, and ${found.length - FITS_NAMED} more` : '';
  return { ok: false, sentence: `"${ref}" fits ${found.length} cards: ${named}${rest}; name one.` };
}

/** `resolveCard` over a book already built. */
function resolveIn(book: CardBook, ref: string): CardResolution {
  const wanted = ref.trim();
  const wantsArc = /\.arc$/i.test(wanted);
  const bare = wanted.replace(/\.arc$/i, '').toLowerCase();
  const named = (kind: Card['kind']): Card[] => book.cards.filter((card) => card.kind === kind && card.name.toLowerCase() === bare);
  // The dispatcher's own order: a bare name is a plan's, and an epic's only when no plan has it; `.arc` is an epic's alone.
  const byName = wantsArc ? named('arc') : named('plan').length > 0 ? named('plan') : named('arc');
  if (byName.length > 0) return oneOf(byName, ref);

  const said = norm(wanted);
  if (said !== '') {
    const byTitle = book.cards.filter((card) => card.title !== null && norm(card.title) === said);
    if (byTitle.length > 0) return oneOf(byTitle, ref);
    if (said.length >= 3) {
      const holding = book.cards.filter((card) => norm(card.name).includes(said) || (card.title !== null && norm(card.title).includes(said)));
      if (holding.length > 0) return oneOf(holding, ref);
    }
  }
  return { ok: false, sentence: `No card is named ${ref}; list_roadmap with a phrase finds it.` };
}

/**
 * Resolves a feature or plan, or an epic or arc, from the two pictures: by its name (with or without `.arc`), then its exact title
 * (without regard to case or punctuation), then the one card whose name or title contains `ref` (3 characters or more). Several
 * fits are refused with each named, none with "No card is named <ref>; list_roadmap with a phrase finds it."; two pictures that
 * have not landed refuse with "The roadmap has not been read yet; ask again in a moment." One of the two may be null: the other
 * is then all there is. A found card carries `spoken` (its title when six words or fewer, else its name with dashes as spaces).
 * Consumed by `read_card` and by the hands (`hands/action-recipe.ts`), which resolve every card an action names.
 */
export function resolveCard(ref: string, roadmap: RoadmapPicture | null, dispatcher: DispatcherPicture | null): CardResolution {
  if (roadmap === null && dispatcher === null) return { ok: false, sentence: NOT_READ_YET };
  return resolveIn(buildCardBook(roadmap, dispatcher), ref);
}

// ---------------------------

//----------------- list_roadmap ------------

/** The word a roadmap card carries, for `active`. */
const wordOf = (card: Card): string | null => card.feature?.word ?? card.unplacedWord;

/** How live an epic is, for ordering `epics`: In progress 0, Not started 1, every other word 2. */
const epicRank = (card: Card): number => (card.epic?.word === 'in progress' ? 0 : card.epic?.word === 'not started' ? 1 : 2);

/** When a card shipped, in epoch ms (0 when it has not). */
const shippedAt = (card: Card): number => Date.parse(card.feature?.shipped_at ?? '') || 0;

/** The cards of a scope and the sentence that says the scope is empty. A phrase is matched over names, titles and goals, epics first. */
function scoped(book: CardBook, scope: string): { cards: Card[]; empty: string } {
  const features = book.cards.filter((card) => card.kind === 'plan');
  const epics = book.cards.filter((card) => card.kind === 'arc');
  switch (scope.toLowerCase()) {
    case 'waiting':
      return { cards: features.filter((card) => card.feature?.waiting_on_you), empty: 'Nothing on the roadmap is waiting on him.' };
    case 'active':
      return { cards: features.filter((card) => wordOf(card) === 'designing' || wordOf(card) === 'in flight'), empty: 'Nothing on the roadmap is being designed or built.' };
    case 'recent': {
      const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
      const shipped = features.filter((card) => shippedAt(card) >= since).sort((a, b) => shippedAt(b) - shippedAt(a));
      return { cards: shipped, empty: `Nothing shipped in the last ${RECENT_DAYS} days.` };
    }
    case 'epics':
      // Live epics first (In progress, then Not started, then the rest) so the cap hides finished ones, never the ones he is asking about.
      return { cards: [...epics].sort((a, b) => epicRank(a) - epicRank(b)), empty: 'The roadmap holds no epics.' };
    default: {
      const matching = [...epics, ...features].filter((card) => holds([card.name, card.title ?? '', card.feature?.goal ?? card.epic?.goal ?? ''].join('\n'), scope));
      return { cards: matching, empty: `Nothing on the roadmap matches "${scope}".` };
    }
  }
}

/**
 * `list_roadmap`: one line per card of the scope, the first lines that fit 20 lines and the inline limit (`fitLines`, as the panel
 * reads keep it), then how many were left out; `panel: true` puts every line on his panel (the note cuts it at its own length).
 * Moves neither her focus nor her activity.
 */
function listRoadmap(deps: CompanionToolDeps, args: { scope: string; panel?: boolean }): Promise<ToolTextResult> {
  return guardedToolResult('list_roadmap', 'read the roadmap', async () => {
    const roadmap = await deps.house.roadmap();
    if (roadmap === null) return deps.refuse(NOT_READ_YET);
    const scope = args.scope.replace(/\s+/g, ' ').trim();
    // The roadmap's rows alone: a plan only the dispatcher knows is not on the roadmap.
    const book = buildCardBook(roadmap, null);
    const { cards, empty } = scoped(book, scope);
    const lines = cards.map((card) => cardLine(card, book));
    const answer = textResult(lines.length === 0 ? empty : args.panel === true ? lines.join('\n') : fitLines(lines));
    return args.panel === true ? toPanel(deps, `Roadmap: ${scope}`, answer) : answer;
  });
}

// ---------------------------

//----------------- read_card ------------

/** The scope's reading from the pictures' rows alone, or null for a scope that needs the dispatcher's text (`design`, or a phrase). */
function rowsReading(keyword: string, card: Card, book: CardBook): Reading | null {
  switch (keyword) {
    case 'summary':
      return summaryReading(card, book);
    case 'prompt':
      return promptReading(card, book);
    case 'questions':
      return questionsReading(card, book);
    case 'phases':
      return phasesReading(card, book);
    case 'history':
      return historyReading(card);
    default:
      return null;
  }
}

/** A reading as the answer: whole (or digested under its brief when it has one and is long), or on his panel whole (the longer `panel` text when the scope cut its own to fit). */
function finish(deps: CompanionToolDeps, reading: Reading, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> | ToolTextResult {
  if (reading.brief === null) {
    const joined = (text: string): ToolTextResult => textResult([reading.intro, text].filter((part) => part !== '').join('\n'));
    return panel ? toPanel(deps, reading.title, joined(reading.panel ?? reading.text)) : joined(reading.text);
  }
  return answerRead(deps, { panel, title: reading.title, text: reading.text, label: reading.label, brief: reading.brief, intro: reading.intro }, signal);
}

/** `design` and a phrase: the dispatcher's `show` text, whole for a design, the paragraphs around the phrase for a phrase. */
async function designReading(deps: CompanionToolDeps, card: Card, scope: string, panel: boolean, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  const shown = await deps.house.cardText(refName(card));
  if (!shown.ok) return deps.refuse(`The dispatcher has no text for ${card.spoken}: ${shown.sentence}.`);
  const text = designText(shown.text);
  if (scope.toLowerCase() === 'design') {
    return finish(deps, { title: `${card.spoken}: design`, intro: `The design of ${card.spoken}:`, text, label: 'card-design', brief: DESIGN_BRIEF }, panel, signal);
  }
  const around = paragraphsAround(text, scope);
  if (around === null) return textResult(`The design of ${card.spoken} does not mention ${scope}.`);
  const reading = { title: `${card.spoken}: ${scope}`, intro: `The design of ${card.spoken}, around "${scope}":`, text: around, label: 'card-phrase', brief: phraseBrief(scope) };
  return finish(deps, reading, panel, signal);
}

/** `read_card`: resolves the card, then reads the scope. Moves neither her focus nor her activity. */
function readCard(deps: CompanionToolDeps, args: { card: string; scope: string; panel?: boolean }, signal: AbortSignal | undefined): Promise<ToolTextResult> {
  return guardedToolResult('read_card', 'read the card', async () => {
    const [roadmap, dispatcher] = await Promise.all([deps.house.roadmap(), deps.house.dispatcher()]);
    if (roadmap === null) return deps.refuse(NOT_READ_YET);
    if (dispatcher === null) return deps.refuse(DISPATCHER_NOT_READ_YET);
    const book = buildCardBook(roadmap, dispatcher);
    const found = resolveIn(book, args.card);
    if (!found.ok) return deps.refuse(found.sentence);
    const scope = args.scope.replace(/\s+/g, ' ').trim();
    const reading = rowsReading(scope.toLowerCase(), found.card, book);
    return reading === null ? designReading(deps, found.card, scope, args.panel === true, signal) : finish(deps, reading, args.panel === true, signal);
  });
}

// ---------------------------

/** The `panel` argument both tools take. */
const panelFlag = z.boolean().optional().describe('true puts the whole answer on his panel as a note instead of in your context; you are then told only that it is there.');

/**
 * The definitions of `list_roadmap` and `read_card` (the order her prompt lists them), built with the SDK's `tool()` and zod. Both
 * are marked read-only: they change nothing and the CLI never asks about them. Consumed by `tools/companion-tools.ts`
 * (`buildCompanionTools`), once per account.
 */
export function roadmapReads(deps: CompanionToolDeps): Array<SdkMcpToolDefinition<any>> {
  const readOnly = { annotations: { readOnlyHint: true } };
  return [
    tool(
      'list_roadmap',
      toolLine('list_roadmap'),
      {
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'waiting: the cards that wait on him for an Accept or for answers. active: what is being designed or built. recent: what shipped in the last 7 days. epics: one line per epic, In progress first, then Not started, then the rest. Anything else is a phrase: the features and epics whose name, title or goal holds it. One card in full (when it was approved, its tasks, what it waits on) is read_card, which takes its name.'
          ),
        panel: panelFlag,
      },
      (args) => listRoadmap(deps, args),
      readOnly
    ),
    tool(
      'read_card',
      toolLine('read_card'),
      {
        card: z.string().trim().min(1).max(300).describe('The feature or epic to read, by its name as list_roadmap prints it, or by its title as he says it.'),
        scope: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe(
            'summary: its state, what it waits on, when it was approved and by whom, and its tasks. prompt: the open Accept prompt. questions: the open questions with their options. phases: its tasks, one line each. history: what happened to it, newest first. design: its design, as a digest. Anything else is a phrase: what its design says about it, as a digest.'
          ),
        panel: panelFlag,
      },
      (args, extra) => readCard(deps, args, signalOf(extra)),
      readOnly
    ),
  ];
}
