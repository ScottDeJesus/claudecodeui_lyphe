import type { KanbanStatus } from '@/shared/kanban-types';

/**
 * WHICH STATUSES COMPOSE WHICH LANE, AND WHAT EACH LANE OFFERS. The one place on the client where
 * a card status is named at all.
 *
 * The server stores five statuses and counts them five ways; it never learns that a board has
 * lanes. The kit renders a title, a count and an array of cards; it never learns what a status
 * is. Everything between those two — that To Do carries the questions cards while autonomy is
 * off, that Done is the muted lane, that only the two intake lanes offer a `+` — is decided here
 * and read by the panel, the drawer and the drag hook alike. A second copy of any of it is where
 * the three would drift apart.
 */

export type KanbanLaneSpec = {
  /** The opaque laneId handed to the kit. Only this file may read it as a status name. */
  id: string;
  /** An i18n key. The panel resolves it; a lane title is never a literal. */
  titleKey: string;
  /** What `listLaneCards` is asked for, and what `laneCounts` is summed over. A lane is a SET. */
  statuses: KanbanStatus[];
  /** Decides whether the panel passes `onAddCard`, which is what draws the lane's `+`. */
  canAdd: boolean;
  /** Decides whether the panel passes `muted` — a weight change on the lane and its cards. */
  muted: boolean;
  /**
   * Which end of the lane new work arrives at: `true` pages newest-first, `false` follows the
   * server's `sort_order` ascending.
   *
   * The server owns the ORDER (a lane's page is `ORDER BY sort_order` or, for finished work,
   * `updated_at DESC`); this is the same fact, stated where the lanes are composed, because the
   * lanes hook has to place a card a websocket frame carried in without refetching the lane —
   * and placing it at the wrong end of the lane is a card that jumps the moment the reader
   * reloads. The kit never reads it.
   */
  newestFirst: boolean;
};

/**
 * The lane that holds finished work, by id.
 *
 * Exported for the ONE decision the spec above cannot carry: "Clear done" belongs in that lane's
 * overflow menu and nowhere else. The panel compares against this constant rather than spelling
 * the status itself, so the board still names its statuses in exactly one file.
 */
export const DONE_LANE_ID = 'done';

/**
 * The board's lanes, left to right, for a given autonomy setting.
 *
 * AUTONOMY OFF — four lanes, and To Do carries TWO statuses. A card waiting on an answer is not
 * hidden and its status is never rewritten to make the board simpler: it sits in To Do wearing
 * its own chip, which is the whole reason a lane is a set of statuses rather than one.
 *
 * AUTONOMY ON — five. To Do narrows to `todo` alone and Open questions becomes a lane of its own,
 * placed DIRECTLY AFTER To Do: those are the cards that just left it, and a card that splits out
 * should land next door rather than two columns away. It is also the lane that wants a person,
 * so it sits early in the left-to-right scan rather than behind the backlog.
 *
 * THE PLAN SAYS ONLY "between To Do and In Progress", which `[todo, backlog, questions, active]`
 * would also satisfy, so this file is where that is settled — and it is settled on more than
 * taste. This order IS the keyboard's: `Ctrl/Cmd + →` moves the focused card to the ADJACENT
 * lane, so from a To Do card the easiest key on the board asks a question about it, which is the
 * move a reader makes there. With Backlog second, that same key would demote a ready card to the
 * backlog — a rarer move, and a colder one, to have sitting under the easiest keystroke. Phase 10
 * inherits this ruling from here rather than re-deciding it in the drag hook.
 */
export function kanbanLanes(autonomy: boolean): KanbanLaneSpec[] {
  const todo: KanbanLaneSpec = {
    id: 'todo',
    titleKey: 'kanban.lanes.todo',
    statuses: autonomy ? ['todo'] : ['todo', 'questions'],
    canAdd: true,
    muted: false,
    newestFirst: false,
  };

  const questions: KanbanLaneSpec = {
    id: 'questions',
    titleKey: 'kanban.lanes.questions',
    statuses: ['questions'],
    canAdd: false,
    muted: false,
    newestFirst: false,
  };

  const backlog: KanbanLaneSpec = {
    id: 'not_ready',
    titleKey: 'kanban.lanes.backlog',
    statuses: ['not_ready'],
    canAdd: true,
    muted: false,
    newestFirst: false,
  };

  const inProgress: KanbanLaneSpec = {
    id: 'active',
    titleKey: 'kanban.lanes.active',
    statuses: ['active'],
    canAdd: false,
    muted: false,
    newestFirst: false,
  };

  // Muted, not hidden and not coloured: finished work stays readable and stops competing for the
  // eye with the three lanes that still want something.
  const done: KanbanLaneSpec = {
    id: DONE_LANE_ID,
    titleKey: 'kanban.lanes.done',
    statuses: ['done'],
    canAdd: false,
    muted: true,
    newestFirst: true,
  };

  return autonomy
    ? [todo, questions, backlog, inProgress, done]
    : [todo, backlog, inProgress, done];
}

/**
 * The statuses a lane absorbs only while autonomy is OFF — the cards that wait on an answer,
 * which have a lane of their own when it is on. The board says so once, over the rail.
 *
 * DERIVED, never restated: it is the difference between the statuses the board gives a lane of
 * their own and the statuses it shows, so a third lane that folds a status in with autonomy off
 * lands in this answer without anyone remembering to come back here.
 */
export function foldedStatuses(autonomy: boolean): KanbanStatus[] {
  if (autonomy) return [];

  const withOwnLane = new Set(kanbanLanes(true).flatMap((spec) => spec.statuses));
  return kanbanLanes(false)
    .flatMap((spec) => spec.statuses)
    .filter((status) => !withOwnLane.has(status));
}
