import type { DispatcherCard, DispatcherCardCase, DispatcherCardStage, DispatcherCardState } from '@/shared/types.js';

import { countOrNullSince, countSince, each, field, isCount, isCountOrNull, isRecord, isText, isTextOrNull, need, oneOf } from './dispatcher-state.transport.js';

/**
 * One card walk of the dispatcher's document (`hooks/dispatcher/report_cards.py`), read field by field into the type the board draws.
 *
 * It is the planner reader's sibling and follows its every rule: this document is printed whole by a process that has exited, so a field
 * that does not match is a DIFFERENT BUILD of the dispatcher rather than a torn write, and it is refused BY NAME. THE KEYS IT USES, named
 * as the planner reader names its own: `board`, `card`, `title`, `state`, `flow`, `part`, `sorted_by`, `confidence`, `hold`, `waits_on`, `waited_days`, `rides_as`,
 * `chain_id`, `cases` (`suite`, `name`, `word`) and `stages` (`name`, `soul`, `launch_id`, `status`, `verdict`, `cost_usd`, `tokens_in`, `tokens_out`). Every one is
 * derived by the dispatcher at its read and never stored (INV-172); this server only carries them. A key that is there and does not read is
 * refused by name; the `cards` list absent is a build older than it and reads as no cards. `waited_days` and `rides_as` are read as optional, so an older dispatcher build that writes neither key reads without them.
 */

/** The eight states of a card (`store_cards.STATES`), read against a list so the board's tone and word switch on a closed set. */
const CARD_STATES: readonly DispatcherCardState[] = ['told', 'queued', 'walking', 'asking', 'done', 'handed-back', 'stopped', 'withdrawn'];

/** The four flows a card may run (`store_cards.FLOWS`), `cure` being the night's cure walk of a regression; a card with no flow carries `null`, not a fifth word. */
const CARD_FLOWS: readonly ('bug' | 'change' | 'tweak' | 'cure')[] = ['bug', 'change', 'tweak', 'cure'];

/** The three parts a card may be cut into (`store_cards.PARTS`). */
const CARD_PARTS: readonly DispatcherCard['part'][] = ['whole', 'fix', 'change'];

/** The ranks a queued card is taken at (`card_age.rides_as`). */
const RIDES_AS: readonly ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];

/** One suite case of a card, read whole. `where` names the entry for every refusal beneath it. */
function caseOf(raw: unknown, where: string): DispatcherCardCase {
  const entry = need(raw, isRecord, where);
  return {
    suite: need(field(entry, 'suite'), isText, `${where}.suite`),
    name: need(field(entry, 'name'), isText, `${where}.name`),
    word: need(field(entry, 'word'), isText, `${where}.word`),
  };
}

/** One stage of a card, read whole. The launch's dollars and tokens are counts, the tokens 0 from a build older than them; its soul, launch id, status and verdict may be unset. */
function stageOf(raw: unknown, where: string): DispatcherCardStage {
  const stage = need(raw, isRecord, where);
  return {
    name: need(field(stage, 'name'), isText, `${where}.name`),
    soul: need(field(stage, 'soul'), isTextOrNull, `${where}.soul`),
    launch_id: need(field(stage, 'launch_id'), isTextOrNull, `${where}.launch_id`),
    status: need(field(stage, 'status'), isTextOrNull, `${where}.status`),
    verdict: need(field(stage, 'verdict'), isTextOrNull, `${where}.verdict`),
    cost_usd: need(field(stage, 'cost_usd'), isCount, `${where}.cost_usd`),
    tokens_in: countSince(field(stage, 'tokens_in'), `${where}.tokens_in`),
    tokens_out: countSince(field(stage, 'tokens_out'), `${where}.tokens_out`),
  };
}

/** The rank a queued card rides at, or null when it waits at none or the build is older than the key; a value that is not a rank is refused by name. */
function ridesAsOf(value: unknown, where: string): 'high' | 'medium' | 'low' | null {
  return value === undefined || value === null ? null : oneOf(value, RIDES_AS, where);
}

/** One card whole. `board` and `card` are read first, so every later refusal names the card it came from. */
export function cardOf(raw: unknown): DispatcherCard {
  const card = need(raw, isRecord, 'card');
  const board = need(field(card, 'board'), isText, 'card.board');
  const cardId = need(field(card, 'card'), isText, 'card.card');
  const where = `card ${board}/${cardId}`;
  const flow = field(card, 'flow');
  return {
    board,
    card: cardId,
    title: need(field(card, 'title'), isText, `${where}.title`),
    state: oneOf(field(card, 'state'), CARD_STATES, `${where}.state`),
    flow: flow === null ? null : oneOf(flow, CARD_FLOWS, `${where}.flow`),
    part: oneOf(field(card, 'part'), CARD_PARTS, `${where}.part`),
    sorted_by: need(field(card, 'sorted_by'), isTextOrNull, `${where}.sorted_by`),
    confidence: need(field(card, 'confidence'), isCountOrNull, `${where}.confidence`),
    hold: need(field(card, 'hold'), isTextOrNull, `${where}.hold`),
    waits_on: need(field(card, 'waits_on'), isCountOrNull, `${where}.waits_on`),
    waited_days: countOrNullSince(field(card, 'waited_days'), `${where}.waited_days`),
    rides_as: ridesAsOf(field(card, 'rides_as'), `${where}.rides_as`),
    chain_id: need(field(card, 'chain_id'), isTextOrNull, `${where}.chain_id`),
    cases: each(field(card, 'cases'), `${where}.cases`, (entry) => caseOf(entry, `${where}.cases[]`)),
    stages: each(field(card, 'stages'), `${where}.stages`, (entry) => stageOf(entry, `${where}.stages[]`)),
  };
}

/** Every card walk of the document, the dispatcher's own order (oldest first), or `[]` for a build older than the key. */
export function cardsOf(value: unknown): DispatcherCard[] {
  return value === undefined ? [] : each(value, 'cards', cardOf);
}
