import type { TFunction } from 'i18next';

import type { KanbanLanes } from '@/modules/kanban/hooks/useKanbanLanes';
import type { KanbanLaneSpec, KanbanRingSpec } from '@/modules/kanban/utils/lanePolicy';
import { kindWordKey, stageRunning, type KanbanWalk } from '@/modules/kanban/utils/walkModel';
import type { KanbanCardSummary } from '@/shared/kanban-types';
import type { AstrolabeRing, AstrolabeRingItem, AstrolabeRingState } from '@/shared/types';

/**
 * THE BOARD'S CARDS AS MARKS ON RINGS: what the instrument (`BugInstrument`) draws, worked out from the lanes the board already
 * holds. Each card says several things without a word, the design system's way:
 *
 * - WHERE IT IS by its ring (its lane) and its place round it (the lane's order).
 * - WHAT IT IS DOING by how its span moves: a card in hand works (dashes crawl ahead of a bead, one small bead behind for each
 *   sitting of the dispatcher's still out on it); a card waiting on an answer turns its mark the accent with a gate held open; a
 *   finished card rests fully lit; a sitting that failed stops its span in the danger dot.
 * - HOW FAR IT HAS GOT by how much of its span is lit: its checklist, done of total.
 * - HOW MUCH IT MATTERS by how tall its mark stands: high taller, low shorter.
 *
 * Its words wait for the plate: the ring's name, then the card's kind, its priority, what holds it and its open issues, over its
 * title.
 *
 * A RING HOLDS AT MOST `RING_MOST` MARKS (the design system reads a ring of two to twenty-four). A lane with more puts its first
 * ones on the ring and one more mark, `moreId`, whose Opening lists the rest.
 */

/** The most marks a ring carries, the "more" mark among them. */
const RING_MOST = 24;

/** The mark that stands for a lane's further cards, by its ring. */
export const moreId = (ringId: string) => `more:${ringId}`;
/** The ring a "more" mark stands for, or null for a card's own mark. */
export const ringOfMore = (itemId: string) => (itemId.startsWith('more:') ? itemId.slice('more:'.length) : null);

/** How much a priority weighs: the mark's height off its ring. */
const WEIGHT = { high: 1, medium: 0.5, low: 0.1 } as const;

/** The rings as the instrument draws them, and the cards each holds in full (its ring's marks and the ones past them). */
export type BugRings = {
  rings: AstrolabeRing[];
  /** Every card each ring holds, in its order, the ones past its marks included. */
  cardsOf: Record<string, string[]>;
  /** The ring a card stands on, or null for a card no ring holds. */
  ringOf: (cardId: string) => string | null;
  /** Whether a lane has more cards on the server than the board has read. */
  unread: Record<string, boolean>;
  /** A card the rings hold, by id, as this render's lanes have it; null for one they do not. */
  summaryOf: (cardId: string) => KanbanCardSummary | null;
};

type BugRingsInput = {
  specs: KanbanLaneSpec[];
  ringSpecs: KanbanRingSpec[];
  board: Pick<KanbanLanes, 'laneView' | 'laneSummaries'>;
  walkOf: (cardId: string) => KanbanWalk | null;
  /** The card that is open, kept facing on its ring. */
  selectedCardId: string | null;
  t: TFunction;
};

/** What a card on the board is doing, as a span state. */
function stateOf(summary: KanbanCardSummary, walk: KanbanWalk | null): AstrolabeRingState {
  if (summary.status === 'done') return 'done';
  if (summary.status === 'questions' || summary.openQuestions > 0) return 'waiting';
  if (walk?.stages.some((stage) => stage.status === 'failed') && summary.status === 'active' && !walk.stages.some(stageRunning)) return 'failed';
  if (summary.status === 'active') return 'working';
  return 'idle';
}

/** The words a card's plate carries over its title: its kind, its priority unless it is the ordinary one, and what holds it. */
function detailOf(summary: KanbanCardSummary, walk: KanbanWalk | null, state: AstrolabeRingState, t: TFunction): string {
  const kind = kindWordKey(summary.tags, walk);
  const words = [
    kind === null ? null : t(kind),
    summary.priority === 'medium' ? null : t(`kanban.priority.${summary.priority}`),
    state === 'waiting' ? t('kanban.ring.needsYou', { defaultValue: 'Needs you' }) : null,
    summary.openIssues > 0 ? t('kanban.ring.issues', { count: summary.openIssues, defaultValue: '{{count}} issues' }) : null,
    state === 'idle' && walk !== null && walk.hold.length > 0 ? t('kanban.ring.held', { defaultValue: 'Held' }) : null,
  ];
  return words.filter((word): word is string => word !== null).join(' · ');
}

/** What a card is doing as the open card's head says it: a word and its tone, or null for a card simply standing in its lane. */
export function bugStatusOf(summary: KanbanCardSummary, walk: KanbanWalk | null, t: TFunction): { word: string; tone: 'info' | 'positive' | 'warn' | 'danger' | 'neutral' } | null {
  const state = stateOf(summary, walk);
  if (state === 'waiting') return { word: t('kanban.ring.needsYou', { defaultValue: 'Needs you' }), tone: 'warn' };
  if (state === 'working') return { word: t('kanban.ring.inHand', { defaultValue: 'In hand' }), tone: 'info' };
  if (state === 'done') return { word: t('kanban.lanes.done'), tone: 'positive' };
  if (state === 'failed') return { word: t('kanban.ring.failed', { defaultValue: 'Failed' }), tone: 'danger' };
  if (walk !== null && walk.hold.length > 0) return { word: t('kanban.ring.held', { defaultValue: 'Held' }), tone: 'neutral' };
  return null;
}

/** One card's mark. */
function itemOf(summary: KanbanCardSummary, walk: KanbanWalk | null, t: TFunction): AstrolabeRingItem {
  const state = stateOf(summary, walk);
  return {
    id: summary.id,
    label: summary.title,
    detail: detailOf(summary, walk, state, t) || undefined,
    progress: summary.checklistTotal > 0 ? summary.checklistDone / summary.checklistTotal : 0,
    state,
    agents: walk === null ? 0 : walk.stages.filter(stageRunning).length,
    weight: WEIGHT[summary.priority],
  };
}

/** The board's rings, inside out, each absent while it holds nothing (the design system's "empty means absent"). */
export function bugRings({ specs, ringSpecs, board, walkOf, selectedCardId, t }: BugRingsInput): BugRings {
  const rings: AstrolabeRing[] = [];
  const cardsOf: Record<string, string[]> = {};
  const unread: Record<string, boolean> = {};
  const where = new Map<string, string>();
  const held = new Map<string, KanbanCardSummary>();
  for (const ringSpec of ringSpecs) {
    const lanes = ringSpec.laneIds.map((laneId) => specs.find((spec) => spec.id === laneId)).filter((spec): spec is KanbanLaneSpec => spec !== undefined);
    // Read from this render's lanes, never through the ref a press reads: the last lane to land would be a render behind.
    const summaries = lanes.flatMap((spec) => board.laneSummaries(spec));
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    const ids = summaries.map((summary) => summary.id);
    summaries.forEach((summary) => held.set(summary.id, summary));
    const total = lanes.reduce((sum, spec) => sum + (board.laneView(spec).count ?? 0), 0);
    unread[ringSpec.id] = lanes.some((spec) => board.laneView(spec).hasMore);
    cardsOf[ringSpec.id] = ids;
    ids.forEach((id) => where.set(id, ringSpec.id));
    if (ids.length === 0) continue;
    const overflows = Math.max(total, ids.length) > RING_MOST;
    const shown = overflows ? ids.slice(0, RING_MOST - 1) : ids;
    const items = shown.flatMap((id) => {
      const summary = byId.get(id);
      return summary === undefined ? [] : [itemOf(summary, walkOf(id), t)];
    });
    if (overflows) {
      const rest = Math.max(total, ids.length) - shown.length;
      items.push({ id: moreId(ringSpec.id), label: t('kanban.ring.more', { count: rest, defaultValue: '{{count}} more' }), weight: 0 });
    }
    if (items.length === 0) continue;
    const label = t(ringSpec.titleKey);
    // The open card faces you on its ring; one past the marks is said by the "more" mark.
    const open = selectedCardId === null ? undefined : shown.includes(selectedCardId) ? selectedCardId : ids.includes(selectedCardId) ? moreId(ringSpec.id) : undefined;
    rings.push({ id: ringSpec.id, label, items, value: open });
  }
  return { rings, cardsOf, unread, ringOf: (cardId) => where.get(cardId) ?? null, summaryOf: (cardId) => held.get(cardId) ?? null };
}
