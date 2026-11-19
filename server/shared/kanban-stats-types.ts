// ---------------------------
//----------------- KANBAN STATS CONTRACTS ------------
// The wire shapes of the board's two new reads: the stats, which answer the dashboard's questions
// about open work and time to fix, and the changelog, the lines a person reads back as a list of
// what was fixed. Every shape either read puts on the wire lives here.
//
// Consumers: `server/modules/kanban/kanban-stats.service.ts` (builds both reads),
// `server/modules/kanban/routes/stats.routes.ts` (serves them), and the board-dispatch dashboard
// (draws them).
//
// It is a SIBLING of `server/shared/kanban-types.ts` rather than an addition to it, because that file
// is past the house ceiling of 300 lines. `kanban-types.ts` re-exports everything here, so callers keep
// one import surface. This file imports only TYPES from `kanban-types.ts`, so the re-export cycle is
// erased at runtime.
//
// The client mirror is `src/shared/kanban-stats-types.ts`, field for field. A change here without the
// same change there is a response the panel cannot read, so the two are edited together, always.

import type { KanbanPriority, KanbanStatus } from './kanban-types.js';

/**
 * The window the stats read covers when the caller names no `days`. The ONE home for the number, so
 * the route's default and the service's fallback cannot disagree about how far back a dashboard looks.
 */
export const KANBAN_STATS_DAYS_DEFAULT = 30;

/**
 * The hard ceiling on the stats window. Without it one request can ask for a day-by-day series across
 * the whole history of a board, which is a chart of years of empty days drawn for a glance.
 */
export const KANBAN_STATS_DAYS_MAX = 365;

/**
 * The changelog page size when the caller names no limit. The ONE home for the number, so the route's
 * default and the service's fallback cannot drift apart.
 */
export const KANBAN_CHANGELOG_LIMIT_DEFAULT = 50;

/**
 * The hard ceiling on a changelog page. The changelog is read as a list a person scrolls; past this, one
 * request pulls a whole project's history to render a page of it.
 */
export const KANBAN_CHANGELOG_LIMIT_MAX = 200;

/** a changelog line is one sentence a person reads in a list; the card's `changelog` column takes at most this many characters */
export const KANBAN_CHANGELOG_MAX_CHARS = 300;

/**
 * Open cards per priority. The dashboard's priority figures read these three counts without fetching
 * the cards behind them.
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
 * An aged open card that also carries its priority and status, so the dashboard can say which lane the
 * card is stuck in. `status` is never `'done'` here, because done is not open.
 */
export type KanbanAgedOpenCard = KanbanAgedCard & {
  priority: KanbanPriority;
  status: KanbanStatus;
};

/** Hours from a card's creation to its arrival in Done, over the cards whose done_at falls in the window; null when no card closed in it (an unknown is not a zero). */
export type KanbanFixTime = {
  count: number;
  medianHours: number;
  p90Hours: number;
} | null;

/**
 * Time to fix split by priority, with `all` across every priority. Each field is its own window's answer,
 * so a high-priority figure is never averaged in with a low one.
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
 * The stats read, one body for the whole dashboard, so no figure can disagree with its neighbour on the
 * same screen.
 *
 * OPEN means not archived and not in done. `scope.boardId` null is every board that is not archived.
 * `cameBack` counts cards created in the window that carry a `regression-of:` tag.
 */
export type KanbanStats = {
  scope: {
    boardId: string | null;
    boardName: string | null;
    days: number;
  };
  open: {
    total: number;
    byPriority: KanbanCountsByPriority;
    byLane: KanbanOpenByLane;
  };
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
 * One changelog line: a card that reached Done, with the sentence a person reads for it. Like an aged
 * card, it names its board and title rather than only an id (INV-76). `kind` is null when the card
 * carries no kind tag.
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
