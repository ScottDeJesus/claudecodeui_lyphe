//----------------- KANBAN STATS CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the board's two new reads: the stats read the board-dispatch dashboard draws
// its counts and charts from, and the changelog read its done list draws from. Every shape here is
// one a wire carries from the server or one the dashboard hands to its own components.
//
// Its server-side consumers are `server/modules/kanban/kanban-stats.service.ts`, which builds these
// shapes, and `server/modules/kanban/routes/stats.routes.ts`, which serves them. The board-dispatch
// dashboard is the client consumer.
//
// Its twin is `server/shared/kanban-stats-types.ts`, and the two edit in the SAME change, field for
// field: a field renamed on one side and not the other is a number the dashboard quietly reads as
// undefined.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// It lives in its own file rather than in `src/shared/kanban-types.ts`, which is already past the
// house ceiling of 300 lines for a module. `src/shared/kanban-types.ts` re-exports everything here,
// so callers keep one import surface.
//
// It imports only TYPES from `kanban-types.ts`, and every import is `import type`, so the re-export
// cycle between the two files is erased at runtime and never loads.

import type { KanbanPriority, KanbanStatus } from '@/shared/kanban-types';

/**
 * The window, in days, a stats read covers when the caller names none: a month shows the trend
 * without making the day series too long to scan on the dashboard.
 */
export const KANBAN_STATS_DAYS_DEFAULT = 30;

/**
 * The widest window a stats read accepts: a year bounds how far back a stats read looks, so its
 * cost does not grow with the board's whole history.
 */
export const KANBAN_STATS_DAYS_MAX = 365;

/**
 * The changelog lines one read returns when the caller names no limit: a recency list a person
 * scans at once, not an archive.
 */
export const KANBAN_CHANGELOG_LIMIT_DEFAULT = 50;

/**
 * The most changelog lines one read returns, so a caller asking for everything cannot pull the
 * whole done history into one response.
 */
export const KANBAN_CHANGELOG_LIMIT_MAX = 200;

/** a changelog line is one sentence a person reads in a list; the card's `changelog` column takes at most this many characters */
export const KANBAN_CHANGELOG_MAX_CHARS = 300;

/**
 * Open cards per priority. All three keys are always present, so a priority with no open card
 * reads as a zero, never as a missing field.
 */
export type KanbanCountsByPriority = {
  high: number;
  medium: number;
  low: number;
};

/** Open cards per lane status: every status but done, since done is not open. */
export type KanbanOpenByLane = {
  not_ready: number;
  todo: number;
  questions: number;
  active: number;
};

/** One open card named for a person: its title and board name, never only an id (INV-76), with its whole days open. */
export type KanbanAgedCard = {
  cardId: string;
  boardId: string;
  boardName: string;
  title: string;
  createdAt: string;
  ageDays: number;
};

/**
 * An aged card with the priority and status that explain why it is still open: the row the
 * oldest-open list draws.
 */
export type KanbanAgedOpenCard = KanbanAgedCard & {
  priority: KanbanPriority;
  status: KanbanStatus;
};

/** Hours from a card's creation to its arrival in Done, over the cards whose done_at falls in the window; null when no card closed in it (an unknown is not a zero). */
export type KanbanFixTime =
  | {
      count: number;
      medianHours: number;
      p90Hours: number;
    }
  | null;

/**
 * Time-to-fix for the window, once over every card that closed in it and once per priority, so the
 * dashboard shows the spread without a second request.
 */
export type KanbanFixTimes = {
  all: KanbanFixTime;
  high: KanbanFixTime;
  medium: KanbanFixTime;
  low: KanbanFixTime;
};

/** One UTC day of the window, zeros included so a chart never has to invent a missing day. day is 'YYYY-MM-DD'. */
export type KanbanStatsDay = {
  day: string;
  opened: number;
  fixed: number;
};

/** Cards by the actor of their creating event: how work reached the board. */
export type KanbanWayIn = {
  source: string;
  opened: number;
  open: number;
};

/**
 * The board-dispatch dashboard's one stats read, over the window of `scope.days` days.
 *
 * OPEN means not archived and not in done: every count under `open` and every card under
 * `oldestOpenHigh` and `oldestOpen` uses that one definition, so the dashboard never shows two
 * different open totals. `scope.boardId` null is every board not archived. `cameBack` counts cards
 * created in the window that carry a `regression-of:` tag: a card filed as a regression of an
 * earlier one, which the fix-time figures cannot see.
 */
export type KanbanStats = {
  scope: { boardId: string | null; boardName: string | null; days: number };
  open: { total: number; byPriority: KanbanCountsByPriority; byLane: KanbanOpenByLane };
  oldestOpenHigh: KanbanAgedCard | null;
  oldestOpen: KanbanAgedOpenCard[];
  timeToFix: KanbanFixTimes;
  byDay: KanbanStatsDay[];
  waysIn: KanbanWayIn[];
  cameBack: number;
};

/** The kind a changelog line is filed under, read from the card's tags. */
export type KanbanChangelogKind = 'bug' | 'ui-change' | 'tweak' | 'regression';

/**
 * One done card's changelog line, as the list reads it: the title and board name name the card to
 * a person, and `kind` is null when the card carries no kind tag.
 */
export type KanbanChangelogEntry = {
  cardId: string;
  boardId: string;
  boardName: string;
  title: string;
  kind: KanbanChangelogKind | null;
  changelog: string;
  doneAt: string;
};
