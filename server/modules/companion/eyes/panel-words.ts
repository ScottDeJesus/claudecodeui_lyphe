import type { DispatcherPhase, DispatcherPlanStatus } from '@/shared/types.js';
import type { RoadmapEpicWord, RoadmapFeatureWord } from '@/shared/roadmap-types.js';

/**
 * THE WORDS ARE THE PANELS'. A card's state is said in the Roadmap tab's English, a plan's or a task's in the In flight
 * face's, so he can look at the panel and find what she said. The server cannot import the client's locale
 * (`src/modules/i18n/locales/en/common.json`), so the eyes keep this one table of those strings, each under its key,
 * and `.verify/companion-panel-words.mjs` compares it to the locale (the way the wire contract's two mirrors are). The two
 * are edited together. The words exist only in English.
 *
 * Copied verbatim from the locale: `roadmap.word.*`, `roadmap.step.*`, `roadmap.epicWord.*`, `dispatcher.status.*`,
 * `dispatcher.phase.*`, and `dispatcher.settling` (what the In flight face says of a run that has ended and is not yet
 * settled, which `phaseWord.ts` picks). `{{title}}` and `{{date}}` stay slots, filled by `fillWords`.
 *
 * Consumers: `roadmap-reads.ts` (a feature's word and step, an epic's word, a plan's status and a task's phase) and
 * `run-reads.ts` (a task's phase), in this folder; `.verify/companion-panel-words.mjs`, which keeps the table equal to the locale.
 */

//----------------- THE STRINGS, EACH UNDER ITS KEY ------------

/** The locale's strings by key. Consumed by `fillWords` and the word functions below, and by the probe that keeps them equal to the locale. */
export const PANEL_WORDS: Readonly<Record<string, string>> = {
  'roadmap.word.idea': 'Idea',
  'roadmap.word.proposed': 'Proposed',
  'roadmap.word.designing': 'Designing',
  'roadmap.word.inFlight': 'In flight',
  'roadmap.word.shipped': 'Shipped',

  'roadmap.step.idea': 'not proposed yet',
  'roadmap.step.proposed': 'lined up for design',
  'roadmap.step.designing': 'being designed',
  'roadmap.step.questions': 'waiting on you: answer its questions',
  'roadmap.step.cutting': 'being cut into tasks',
  'roadmap.step.accept': 'waiting on you: Accept',
  'roadmap.step.parked': 'set aside',
  'roadmap.step.building': 'building',
  'roadmap.step.waiting': 'waiting on {{title}}',
  'roadmap.step.waitingOnAnother': 'waiting on another feature',
  'roadmap.step.queued': 'held for its Start',
  'roadmap.step.paused': 'paused',
  'roadmap.step.stalled': 'stalled — its run ended',
  'roadmap.step.starting': 'starting',
  'roadmap.step.shipped': 'shipped {{date}}',
  'roadmap.step.shippedUndated': 'shipped',

  'roadmap.epicWord.empty': 'No features yet',
  'roadmap.epicWord.notStarted': 'Not started',
  'roadmap.epicWord.inProgress': 'In progress',
  'roadmap.epicWord.complete': 'Complete',

  'dispatcher.status.live': 'LIVE',
  'dispatcher.status.paused': 'PAUSED',
  'dispatcher.status.queued': 'HELD',
  'dispatcher.status.scheduled': 'SCHEDULED',
  'dispatcher.status.stalled': 'STALLED',
  'dispatcher.status.parked': 'PARKED',
  'dispatcher.status.idle': 'IDLE',
  'dispatcher.status.hidden': 'HIDDEN',
  'dispatcher.status.complete': 'COMPLETE',

  'dispatcher.phase.running': 'running',
  'dispatcher.phase.stalled': 'stalled',
  'dispatcher.phase.done': 'done',
  'dispatcher.phase.notStarted': 'not started',

  'dispatcher.settling': 'settling',
};

/** The string under `key`, or a thrown error naming it: a key this table lacks is a bug in the file that asked, never a word to guess. */
function wordsOf(key: string): string {
  const words = PANEL_WORDS[key];
  if (words === undefined) throw new Error(`panel-words has no string for "${key}".`);
  return words;
}

/**
 * `template` with each `{{slot}}` replaced by the slot's text (placed by a replacer function, so a `$&` in a title stays
 * text). A slot the template names and `slots` lacks throws: a `{{title}}` must never reach her. Consumed by `stepWords`,
 * and by any read that fills a string of the table.
 */
export function fillWords(template: string, slots: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const text = slots[name];
    if (text === undefined) throw new Error(`"${template}" needs the slot ${name}.`);
    return text;
  });
}

// ---------------------------

//----------------- THE DISPATCHER'S WORDS, MAPPED AS THE CLIENT MAPS THEM ------------

/**
 * Each feature word's key, which spells `in flight` as `inFlight`: `ROADMAP_FEATURE_WORD_KEYS` of `src/shared/constants.ts`.
 * Consumed by `featureWord` and the probe, which compares it to the client's table.
 */
export const FEATURE_WORD_KEYS: Readonly<Record<RoadmapFeatureWord, string>> = {
  idea: 'roadmap.word.idea',
  proposed: 'roadmap.word.proposed',
  designing: 'roadmap.word.designing',
  'in flight': 'roadmap.word.inFlight',
  shipped: 'roadmap.word.shipped',
};

/**
 * Each epic word's key, which spells `not started` and `in progress` as `notStarted` and `inProgress`:
 * `ROADMAP_EPIC_WORD_KEYS` of `src/shared/constants.ts`. Consumed by `epicWord` and the probe.
 */
export const EPIC_WORD_KEYS: Readonly<Record<RoadmapEpicWord, string>> = {
  empty: 'roadmap.epicWord.empty',
  'not started': 'roadmap.epicWord.notStarted',
  'in progress': 'roadmap.epicWord.inProgress',
  complete: 'roadmap.epicWord.complete',
};

/** A feature's word as the Roadmap tab says it: "Idea", "In flight", "Shipped". Consumed by the roadmap reads. */
export function featureWord(word: RoadmapFeatureWord): string {
  return wordsOf(FEATURE_WORD_KEYS[word]);
}

/** An epic's word as the Roadmap tab says it: "No features yet", "In progress", "Complete". Consumed by the roadmap reads. */
export function epicWord(word: RoadmapEpicWord): string {
  return wordsOf(EPIC_WORD_KEYS[word]);
}

/** The steps the locale has a phrase for as `roadmap.step.<step>`: `useStepPhrase.ts`'s `PLAIN_STEPS`. `waiting` and `shipped` are spelled apart, because each needs a value. */
const PLAIN_STEPS: ReadonlySet<string> = new Set(['idea', 'proposed', 'designing', 'questions', 'cutting', 'accept', 'parked', 'building', 'queued', 'paused', 'stalled', 'starting']);

/**
 * A feature's step in plain words, as `useStepPhrase.ts` says it: "being designed", "waiting on you: Accept",
 * "waiting on The day sheet", "shipped Oct 3". `slots.waitingOn` is the title of the first feature it waits on that has not
 * shipped (none known reads "waiting on another feature", never a slug); `slots.shippedOn` is the date as `shortDate` writes it
 * (none reads "shipped"). The client adds the time agents worked after the date; that is runtime, and never hers to say. A step the
 * table has no phrase for is the dispatcher's own word, as it is (`report_roadmap.feature_word` does the same, so a new state shows
 * itself). Consumed by the roadmap reads.
 */
export function stepWords(step: string, slots: { waitingOn?: string | null; shippedOn?: string | null } = {}): string {
  if (step === 'waiting') {
    return slots.waitingOn ? fillWords(wordsOf('roadmap.step.waiting'), { title: slots.waitingOn }) : wordsOf('roadmap.step.waitingOnAnother');
  }
  if (step === 'shipped') {
    return slots.shippedOn ? fillWords(wordsOf('roadmap.step.shipped'), { date: slots.shippedOn }) : wordsOf('roadmap.step.shippedUndated');
  }
  return PLAIN_STEPS.has(step) ? wordsOf(`roadmap.step.${step}`) : step;
}

/** A plan's status as the In flight face's badge says it: "LIVE", "HELD", "COMPLETE". A status this table lacks is said as the dispatcher has it. Consumed by the roadmap reads. */
export function planStatusWord(status: DispatcherPlanStatus | string): string {
  return PANEL_WORDS[`dispatcher.status.${status}`] ?? status;
}

/**
 * A task's phase as the In flight face says it (`phaseWord.ts`): a running task whose run has ended with nothing to record it is
 * "stalled"; a running one with its walker busy is "running", and with its walker idle "settling"; "done"; else "not started".
 * Consumed by the roadmap reads (the plan's tasks) and the run reads.
 */
export function phaseWords(phase: Pick<DispatcherPhase, 'status' | 'stalled' | 'busy'>): string {
  if (phase.status === 'running') {
    if (phase.stalled !== null) return wordsOf('dispatcher.phase.stalled');
    return phase.busy ? wordsOf('dispatcher.phase.running') : wordsOf('dispatcher.settling');
  }
  return phase.status === 'done' ? wordsOf('dispatcher.phase.done') : wordsOf('dispatcher.phase.notStarted');
}

// ---------------------------

//----------------- A DATE AS THE PANELS WRITE IT ------------

/** The one shape of stamp the house writes: a calendar day, optionally with a time and a zone (`2026-10-28T02:34:45Z`, `2026-10-28 02:34:45`). Anything else is not a stamp. */
const STAMP_SHAPE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A stamp as a moment, or `null` when it is not one: a string of the house's shape (`STAMP_SHAPE`) whose calendar day exists
 * (`2026-02-31` is not rolled into March) and whose time parses. A bare calendar day (`2026-10-27`) is that day on the box's own
 * clock, as the client reads it, not midnight UTC (which would be the evening before here). Epoch seconds, a bare number or a
 * month name are not stamps: a caller holding one converts it first. Consumed by `shortDate` here and by `whenWords` in `eyes-answer.ts`.
 */
export function parseStamp(stamp: string): Date | null {
  const text = typeof stamp === 'string' ? stamp.trim() : '';
  const shape = STAMP_SHAPE.exec(text);
  if (shape === null) return null;
  const [year, month, day] = [Number(shape[1]), Number(shape[2]), Number(shape[3])];
  // The date part must survive a round trip: the Date constructor rolls a day that does not exist into the next month.
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const moment = text.length === 10 ? new Date(year, month - 1, day) : new Date(text);
  return Number.isNaN(moment.getTime()) ? null : moment;
}

/**
 * A date as the panels write it (`formatShortDate`): "Oct 27", with the year ("Oct 27, 2025") when it is not `now`'s year, on the box's
 * local clock; `null` for a stamp that does not parse. Consumed by `whenWords` and by the reads that fill `stepWords`' `shippedOn`.
 */
export function shortDate(stamp: string, now: Date = new Date()): string | null {
  const moment = parseStamp(stamp);
  if (moment === null) return null;
  const thisYear = moment.getFullYear() === now.getFullYear();
  return moment.toLocaleDateString('en-US', thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
