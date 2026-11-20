import type { TFunction } from 'i18next';

import type { CardPriority, KanbanCardLink, KanbanCardModel } from '@/shared/ui';

/**
 * A CARD'S WALK AS THE BOARD READS IT, and the two things a walk writes into a card's TAGS: which
 * flow it is on, and which other cards it is tied to.
 *
 * The dispatcher walks a card of a self-running board through a flow (a bug, a change on a screen,
 * a tweak) and says how that stands in its feed: why a card in To Do is held, the stages it has
 * run and the scenarios it left. It writes two more things as plain tags on the card, because a tag
 * is what every board write already carries: the flow's tag, and one tag per linked card.
 *
 * THIS FILE IS THE ONE PLACE A TAG IS READ AS ANYTHING BUT A NAME. The face, the drawer's tag
 * chips and the drawer's links all ask it, so a link can never be a title on the face and a bare
 * id in the drawer.
 *
 * THE ID IS A KEY AND NEVER A WORD (INV-76). A link tag carries the other card's id because a tag
 * has to; everything a reader is shown is that card's title.
 */

/** The three flows a card is walked through. */
export type KanbanFlow = 'bug' | 'change' | 'tweak';

/** One stage of a card's walk, as the dispatcher's feed names it: a soul's one sitting. The keys
 *  are the feed's own, as a walking phase's stages are read. */
export type KanbanWalkStage = {
  /** The stage's name in the walk: `diagnose`, `scenarios`, `builder`, `athena-1`, `tweak`. */
  name: string;
  soul: string;
  /** The launch whose transcript is this stage's, or `null` before it was launched. */
  launch_id: string | null;
  status: string;
  /** The soul's own closing word. Free text, drawn as written. */
  verdict: string | null;
  /** Paid dollars: `0` for a sitting on the Claude subscription, whose spend is its tokens. */
  cost_usd: number;
  paid_vendor?: string | null;
  tokens?: number;
  tokens_in?: number;
  tokens_out?: number;
};

/** One scenario the walk left, with the word its newest run reads. */
export type KanbanWalkCase = { suite: string; name: string; word: string };

/** The feed's card object, cut to what the board draws. */
export type KanbanWalk = {
  /** Why the dispatcher is holding the card in To Do, or `''` when nothing holds it. */
  hold: string;
  stages: KanbanWalkStage[];
  cases: KanbanWalkCase[];
  /** True when the walk is the night's cure of a regression (the feed's flow `cure`): the card then
   *  reads `Regression` where a flow's word is drawn. */
  cure: boolean;
  /** How a waiting card rides once ageing has moved it up: the whole days it has waited and the
   *  priority it is taken at. `null` for a card that rides at its own priority, or is not waiting. */
  aged: { waitedDays: number; ridesAs: CardPriority } | null;
};

/** A soul's name as a name: the feed spells it lower case. */
export function soulName(soul: string): string {
  return soul.length === 0 ? soul : soul.charAt(0).toUpperCase() + soul.slice(1);
}

/** Whether a sitting is still out. */
export function stageRunning(stage: KanbanWalkStage): boolean {
  // `waiting` is what the plan runner stamps on a stage entry at its launch (`chain_state.py`), until the stage's ending replaces it.
  return stage.status === 'waiting';
}

/** The tag each flow writes on its card, and the i18n key of the word a reader is shown for it. */
const FLOW_TAGS: Record<string, { flow: KanbanFlow; wordKey: string }> = {
  bug: { flow: 'bug', wordKey: 'kanban.flow.bug' },
  'ui-change': { flow: 'change', wordKey: 'kanban.flow.change' },
  tweak: { flow: 'tweak', wordKey: 'kanban.flow.tweak' },
};

/** The four ties a walk records between two cards: the tag's prefix, and the i18n key of its word. */
const LINK_PREFIXES: Array<{ prefix: string; wordKey: string }> = [
  { prefix: 'duplicate-of:', wordKey: 'kanban.links.duplicateOf' },
  { prefix: 'regression-of:', wordKey: 'kanban.links.regressionOf' },
  { prefix: 'from:', wordKey: 'kanban.links.from' },
  { prefix: 'related:', wordKey: 'kanban.links.related' },
];

/** One link tag, read: the card it names and the key of the word that says how. */
export type KanbanLinkTag = { tag: string; cardId: string; wordKey: string };

/** The link a tag states, or `null` for a tag that is only a name. */
function linkOf(tag: string): KanbanLinkTag | null {
  const kind = LINK_PREFIXES.find((candidate) => tag.startsWith(candidate.prefix));
  if (!kind) return null;
  const cardId = tag.slice(kind.prefix.length).trim();
  return cardId.length > 0 ? { tag, cardId, wordKey: kind.wordKey } : null;
}

/** Every link a card's tags state, in the order of `LINK_PREFIXES`: the tie that says the most
 *  about what to do with this card (it is a duplicate, it is a regression) is read first. */
export function linkTagsOf(tags: string[]): KanbanLinkTag[] {
  const links = tags.map(linkOf).filter((link): link is KanbanLinkTag => link !== null);
  const rank = (link: KanbanLinkTag) => LINK_PREFIXES.findIndex((kind) => kind.wordKey === link.wordKey);
  return links.sort((left, right) => rank(left) - rank(right));
}

/** The flow a card's tags put it on and the key of its word, or `null` for a card no walk has sorted. */
export function flowOf(tags: string[]): { flow: KanbanFlow; tag: string; wordKey: string } | null {
  const tag = tags.find((candidate) => candidate in FLOW_TAGS);
  return tag ? { ...FLOW_TAGS[tag], tag } : null;
}

/** The word a card whose walk is the night's cure reads, and the tag the night's ticket put on it:
 *  the tag says the same thing, so it is not drawn beside the word. */
const CURE_WORD_KEY = 'kanban.flow.cure';
const CURE_TAG = 'regression';

/**
 * The key of the word that says what kind of card this is, or `null` for a card no walk has sorted:
 * `Regression` while its walk is the night's cure, else its flow's word. THE ONE READER OF IT: the
 * face and the drawer's head both ask here, so a cure card is never a Regression on the board and
 * a Bug in its sheet.
 */
export function kindWordKey(tags: string[], walk: KanbanWalk | null): string | null {
  return walk?.cure ? CURE_WORD_KEY : (flowOf(tags)?.wordKey ?? null);
}

/** A card's tags that are only names: what is left once the flow's tag and the links are read out. */
export function plainTagsOf(tags: string[]): string[] {
  return tags.filter((tag) => !(tag in FLOW_TAGS) && linkOf(tag) === null);
}

/**
 * What the board knows of a linked card, in the three answers there are: its title; `unread`, while
 * the board has not read it yet; `gone`, when it cannot be read at all — the card was deleted.
 *
 * `gone` IS ITS OWN ANSWER because it is its own drawing. An unread card is still a place to go,
 * and its link stays a press. A gone one is not: a press on it would open a sheet that can only
 * say the card could not be read, with a Try again that cannot succeed. So its link is said in
 * words and offers nothing to press.
 */
export type KanbanLinkedTitle = { title: string } | 'unread' | 'gone';

/** What the face and the drawer need to turn a card's tags and walk into words. */
export type KanbanWalkWords = {
  t: TFunction;
  /** What the board knows of another of its cards: what a link to that card is drawn as. */
  titleOf: (cardId: string) => KanbanLinkedTitle;
};

/** A card's links as the reader is shown them: the word, and the linked card's TITLE. A card the
 *  board has not read, or one that is gone, is named as exactly that, never by its id — and a
 *  gone one carries no id at all, which is what makes its row words and not a press. */
export function linksOf(tags: string[], { t, titleOf }: KanbanWalkWords): KanbanCardLink[] {
  return linkTagsOf(tags).map((link) => {
    const known = titleOf(link.cardId);
    const word = t(link.wordKey);
    if (known === 'gone') return { id: null, word, title: t('kanban.links.gone') };
    return { id: link.cardId, word, title: known === 'unread' ? t('kanban.links.unread') : known.title };
  });
}

/**
 * The walk's half of a card's face, laid over the model `toCardModel` made.
 *
 * THE KIND'S WORD LEADS THE TAGS, as a word ("Bug", "UI change", "Tweak", and "Regression" for a
 * card the night's cure is walking) and never a colour: it is the first thing that says what kind of
 * card this is. THE HOLD'S SENTENCE IS PRINTED, and only where the lane says so
 * (`KanbanLaneSpec.showsHold`): a card is held only while it waits in To Do. HOW AN AGED CARD RIDES
 * is printed in that same lane and line, after the hold: `waiting 4 days · rides as medium`, and
 * only when ageing has moved the card, because a card riding at its own priority has nothing to
 * add to the priority it already shows. THE LINKS leave the tag row, where they would read as
 * `duplicate-of:c-12`, and become rows.
 */
export function withWalkFace(
  card: KanbanCardModel,
  options: KanbanWalkWords & { walk: KanbanWalk | null; showsHold: boolean },
): KanbanCardModel {
  const { t, walk, showsHold } = options;
  const kind = kindWordKey(card.tags, walk);
  const links = linksOf(card.tags, options);
  const hold = showsHold ? (walk?.hold ?? '').trim() : '';
  const aged = showsHold ? (walk?.aged ?? null) : null;

  if (kind === null && links.length === 0 && hold.length === 0 && aged === null) return card;

  const names = plainTagsOf(card.tags).filter((tag) => !(walk?.cure && tag === CURE_TAG));
  const waiting = [
    ...(hold.length > 0 ? [t('kanban.card.held', { why: hold })] : []),
    ...(aged ? [t('kanban.card.aged', { count: aged.waitedDays, priority: t(`kanban.priority.${aged.ridesAs}`).toLocaleLowerCase() })] : []),
  ];

  return {
    ...card,
    tags: [...(kind ? [t(kind)] : []), ...names],
    note: waiting.length > 0 ? waiting.join(' · ') : undefined,
    links: links.length > 0 ? links : undefined,
  };
}
