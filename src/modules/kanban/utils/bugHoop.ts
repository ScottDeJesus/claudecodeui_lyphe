import type { TFunction } from 'i18next';

import type { KanbanLanes } from '@/modules/kanban/hooks/useKanbanLanes';
import type { KanbanGroupSpec, KanbanLaneSpec } from '@/modules/kanban/utils/lanePolicy';
import { kindWordKey, stageRunning, type KanbanWalk } from '@/modules/kanban/utils/walkModel';
import type { KanbanCardSummary } from '@/shared/kanban-types';
import type { HoopSlot, HoopSlotState, SubagentDot } from '@/shared/types';

/**
 * THE BOARD'S CARDS AS SLOTS ON A HOOP: what the instrument (`BugInstrument`) draws round the board's core, worked out from the lanes
 * the board already holds. Each card says several things without a word, in the hoop's own places:
 *
 * - WHERE IT IS by its run (its lane, named along the ground) and its place in it (the lane's order).
 * - WHAT IT IS DOING by its square: lit for a card waiting to be taken up; the frame alone for one parked in the backlog; dashes
 *   turning while it is in hand; the accent, breathing, while it waits on an answer; green once done; red when a sitting failed.
 * - HOW FAR IT HAS GOT by how much of its top edge is lit: its checklist, done of total.
 * - HOW MUCH IT MATTERS by how tall it stands: high the band's full height, low the shortest.
 * - WHO IS AT IT by the beads at its foot: one for each sitting of the dispatcher's still out on it.
 *
 * Its words are read out under the hoop when it faces you: its lane and its title, then how it stands, its kind, its priority unless it
 * is the ordinary one, and its open issues.
 *
 * A LANE SHOWS AT MOST `LANE_MOST` SLOTS. A lane with more puts its first ones on the hoop and one more slot, `moreId`, whose Opening
 * lists the rest. The board shown as a list (`HoopList`) asks for every card it has read (`most`: no end), and says how many each run
 * holds on the server (`counts`).
 */

/** The most slots one lane stands on the hoop, the "more" slot among them. */
const LANE_MOST = 24;

/** The run whose cards are parked: a card there that is doing nothing is drawn asleep, the frame alone. */
const PARKED_GROUP = 'not_ready';

/** How tall a card stands by its priority, as a share of the band. */
const HEIGHT = { high: 1, medium: 0.8, low: 0.62 } as const;

/** The most beads a slot shows: the hoop draws no more than three. */
const MOST_BEADS = 3;

/** The slot that stands for a lane's further cards, by its run. */
export const moreId = (groupId: string) => `more:${groupId}`;
/** The run a "more" slot stands for, or null for a card's own slot. */
export const groupOfMore = (slotId: string) => (slotId.startsWith('more:') ? slotId.slice('more:'.length) : null);

/** The board as the instrument draws it, and the cards each run holds in full (its slots and the ones past them). */
export type BugHoop = {
  slots: HoopSlot[];
  /** Every card each run holds, in its order, the ones past its slots included. */
  cardsOf: Record<string, string[]>;
  /** The run a card stands in, or null for a card no run holds. */
  groupOf: (cardId: string) => string | null;
  /** Whether a run's lanes have more cards on the server than the board has read. */
  unread: Record<string, boolean>;
  /** How many cards each run holds on the server, or as many as the board has read where that is more. */
  counts: Record<string, number>;
  /** A card the runs hold, by id, as this render's lanes have it; null for one they do not. */
  summaryOf: (cardId: string) => KanbanCardSummary | null;
};

type BugHoopInput = {
  specs: KanbanLaneSpec[];
  groupSpecs: KanbanGroupSpec[];
  board: Pick<KanbanLanes, 'laneView' | 'laneSummaries'>;
  walkOf: (cardId: string) => KanbanWalk | null;
  t: TFunction;
  /** The most slots one lane stands, its "more" slot among them: `LANE_MOST` when absent, and no end for the board as a list. */
  most?: number;
};

/** What a card on the board is doing. */
type CardDoing = 'idle' | 'working' | 'waiting' | 'done' | 'failed';

function doingOf(summary: KanbanCardSummary, walk: KanbanWalk | null): CardDoing {
  if (summary.status === 'done') return 'done';
  if (summary.status === 'questions' || summary.openQuestions > 0) return 'waiting';
  if (walk?.stages.some((stage) => stage.status === 'failed') && summary.status === 'active' && !walk.stages.some(stageRunning)) return 'failed';
  if (summary.status === 'active') return 'working';
  return 'idle';
}

/** What a card is doing as the open card's head says it: a word and its tone, or null for a card simply standing in its lane. */
export function bugStatusOf(summary: KanbanCardSummary, walk: KanbanWalk | null, t: TFunction): { word: string; tone: 'info' | 'positive' | 'warn' | 'danger' | 'neutral' } | null {
  const doing = doingOf(summary, walk);
  if (doing === 'waiting') return { word: t('kanban.ring.needsYou', { defaultValue: 'Needs you' }), tone: 'warn' };
  if (doing === 'working') return { word: t('kanban.ring.inHand', { defaultValue: 'In hand' }), tone: 'info' };
  if (doing === 'done') return { word: t('kanban.lanes.done'), tone: 'positive' };
  if (doing === 'failed') return { word: t('kanban.ring.failed', { defaultValue: 'Failed' }), tone: 'danger' };
  if (walk !== null && walk.hold.length > 0) return { word: t('kanban.ring.held', { defaultValue: 'Held' }), tone: 'neutral' };
  return null;
}

/** How a card stands, in words: what it is doing unless it is only standing in its lane, its kind, its priority, its open issues. */
function wordsOf(summary: KanbanCardSummary, walk: KanbanWalk | null, doing: CardDoing, t: TFunction): string {
  const kind = kindWordKey(summary.tags, walk);
  const status = doing === 'done' ? null : bugStatusOf(summary, walk, t)?.word ?? null;
  return [
    status,
    kind === null ? null : t(kind),
    summary.priority === 'medium' ? null : t(`kanban.priority.${summary.priority}`),
    summary.openIssues > 0 ? t('kanban.ring.issues', { count: summary.openIssues, defaultValue: '{{count}} issues' }) : null,
  ].filter((word): word is string => word !== null).join(' · ');
}

/** One card's slot. */
function slotOf(summary: KanbanCardSummary, walk: KanbanWalk | null, group: string, groupName: string, t: TFunction): HoopSlot {
  const doing = doingOf(summary, walk);
  const state: HoopSlotState = doing === 'idle' ? (group === PARKED_GROUP ? 'asleep' : 'idle') : doing;
  const sittings = walk === null ? 0 : walk.stages.filter(stageRunning).length;
  return {
    id: summary.id,
    group,
    groupName,
    title: summary.title,
    words: wordsOf(summary, walk, doing, t),
    state,
    edge: summary.checklistTotal > 0 ? summary.checklistDone / summary.checklistTotal : 0,
    // A sitting's model is not on the card's walk: its bead is the bright ink.
    beads: Array.from({ length: Math.min(MOST_BEADS, sittings) }, (): SubagentDot => 'mercury'),
    height: HEIGHT[summary.priority],
  };
}

/** The board as slots, its runs in their order, each absent while it holds nothing (the design system's "empty means absent"). */
export function bugHoop({ specs, groupSpecs, board, walkOf, t, most = LANE_MOST }: BugHoopInput): BugHoop {
  const slots: HoopSlot[] = [];
  const cardsOf: Record<string, string[]> = {};
  const unread: Record<string, boolean> = {};
  const counts: Record<string, number> = {};
  const where = new Map<string, string>();
  const held = new Map<string, KanbanCardSummary>();
  for (const groupSpec of groupSpecs) {
    const lanes = groupSpec.laneIds.map((laneId) => specs.find((spec) => spec.id === laneId)).filter((spec): spec is KanbanLaneSpec => spec !== undefined);
    // Read from this render's lanes, never through the ref a press reads: the last lane to land would be a render behind.
    const summaries = lanes.flatMap((spec) => board.laneSummaries(spec));
    const ids = summaries.map((summary) => summary.id);
    summaries.forEach((summary) => held.set(summary.id, summary));
    const total = lanes.reduce((sum, spec) => sum + (board.laneView(spec).count ?? 0), 0);
    unread[groupSpec.id] = lanes.some((spec) => board.laneView(spec).hasMore);
    counts[groupSpec.id] = Math.max(total, ids.length);
    cardsOf[groupSpec.id] = ids;
    ids.forEach((id) => where.set(id, groupSpec.id));
    if (ids.length === 0) continue;
    const groupName = t(groupSpec.titleKey);
    const overflows = Math.max(total, ids.length) > most;
    const shown = overflows ? summaries.slice(0, most - 1) : summaries;
    for (const summary of shown) slots.push(slotOf(summary, walkOf(summary.id), groupSpec.id, groupName, t));
    if (overflows) {
      const rest = Math.max(total, ids.length) - shown.length;
      slots.push({
        id: moreId(groupSpec.id),
        group: groupSpec.id,
        groupName,
        title: t('kanban.ring.more', { count: rest, defaultValue: '{{count}} more' }),
        words: '',
        state: 'more',
        edge: 0,
        beads: [],
        height: HEIGHT.low,
      });
    }
  }
  return { slots, cardsOf, unread, counts, groupOf: (cardId) => where.get(cardId) ?? null, summaryOf: (cardId) => held.get(cardId) ?? null };
}
