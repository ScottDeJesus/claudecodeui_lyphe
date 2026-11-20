import type { KanbanStatus } from '@/shared/kanban-types';

/**
 * WHICH STATUSES COMPOSE WHICH LANE, AND WHAT EACH LANE OFFERS. The one place on the client where
 * a card status is named at all.
 *
 * The server stores five statuses and counts them five ways; it never learns that a board has
 * lanes. The kit renders a title, a count and an array of cards; it never learns what a status
 * is. Everything between those two — that To Do carries the questions cards while autonomy is
 * off, that Done is the muted lane, that only the intake lanes offer a `+` — Backlog and To Do
 * with autonomy off, To Do alone with it on — is decided here and read by the panel, the drawer
 * and the drag hook alike. A second copy of any of it is where the three would drift apart.
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
  /** Set on the ONE lane whose cards print why the dispatcher is holding them: a card is held only
   *  while it waits to be taken up, so the sentence belongs to that lane's faces and no other's. */
  showsHold?: boolean;
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
 * The board's lanes, left to right, for a given autonomy setting. Backlog is leftmost (operator
 * ruling 2026-09-16): work enters at the left edge and flows right, so the scan reads as a
 * pipeline — not-ready, ready, being asked about, being built, done.
 *
 * AUTONOMY OFF — four lanes, and To Do carries TWO statuses. A card waiting on an answer is not
 * hidden and its status is never rewritten to make the board simpler: it sits in To Do wearing
 * its own chip, which is the whole reason a lane is a set of statuses rather than one.
 *
 * AUTONOMY ON — five. To Do narrows to `todo` alone and Open questions becomes a lane of its own,
 * placed DIRECTLY AFTER To Do: those are the cards that just left it, and a card that splits out
 * should land next door rather than two columns away. Only To Do offers `+`, because a
 * self-running board takes new work through To Do and nowhere else.
 *
 * This order IS the keyboard's: `Ctrl/Cmd + →` moves the focused card to the ADJACENT lane, so
 * from a To Do card the easiest key asks a question about it (autonomy on) or starts building it
 * (autonomy off), and `←` demotes it to the backlog. The drag hook inherits this ruling from here
 * rather than re-deciding it.
 */
export function kanbanLanes(autonomy: boolean): KanbanLaneSpec[] {
  const todo: KanbanLaneSpec = {
    id: 'todo',
    titleKey: 'kanban.lanes.todo',
    statuses: autonomy ? ['todo'] : ['todo', 'questions'],
    canAdd: true,
    muted: false,
    showsHold: true,
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
    // With autonomy on, new work enters through To Do alone, so a `+` here would strand its card.
    canAdd: !autonomy,
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
    ? [backlog, todo, questions, inProgress, done]
    : [backlog, todo, inProgress, done];
}

/** One ring of the bug board's instrument: its key, the i18n key of its name, and the lanes whose cards it carries, in their order. */
export type KanbanRingSpec = { id: string; titleKey: string; laneIds: string[] };

/**
 * THE BOARD AS RINGS ROUND ITS CORE, inside out: what the board has in hand closest to the core, then what waits to be taken up,
 * then what is not ready, and finished work on the outermost ring, the largest, which holds the most. Work falls inward as it is
 * taken up and is put out to the rim when it is done.
 *
 * TO DO'S RING CARRIES THE OPEN QUESTIONS TOO, whatever the autonomy setting: on a ring a card that waits on an answer is already
 * its own sign (its mark turns the accent and holds a gate open), so a ring of its own would only say it twice. The lanes stay as
 * `kanbanLanes` composes them, so a card can still be moved into Open questions from its own course.
 *
 * Read by the panel's instrument (`BugInstrument`) through `utils/bugRings`. A lane named here that the autonomy setting does not
 * compose (Open questions with autonomy off, whose cards To Do already holds) is simply not read.
 */
export function kanbanRings(): KanbanRingSpec[] {
  return [
    { id: 'active', titleKey: 'kanban.lanes.active', laneIds: ['active'] },
    { id: 'todo', titleKey: 'kanban.lanes.todo', laneIds: ['todo', 'questions'] },
    { id: 'not_ready', titleKey: 'kanban.lanes.backlog', laneIds: ['not_ready'] },
    { id: DONE_LANE_ID, titleKey: 'kanban.lanes.done', laneIds: [DONE_LANE_ID] },
  ];
}

/**
 * The lane a new card is made in: To Do, the lane every board takes new work through whatever its autonomy setting (with it on
 * the only lane that takes any). A card meant for the backlog is moved there from its own course. Null for lanes that hold no To Do.
 */
export function newCardLane(specs: KanbanLaneSpec[]): KanbanLaneSpec | null {
  return specs.find((spec) => spec.id === 'todo') ?? null;
}

/** The lane a card of this status sits in, or null for a status no lane shows. */
export function laneOfStatus(specs: KanbanLaneSpec[], status: KanbanStatus): KanbanLaneSpec | null {
  return specs.find((spec) => spec.statuses.includes(status)) ?? null;
}
