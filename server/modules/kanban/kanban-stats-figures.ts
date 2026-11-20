/**
 * The arithmetic behind the board's numbers: pure functions of the rows `kanbanStatsDb` read and of one
 * `now`, so each figure can be reasoned about without a database. `kanban-stats.service.ts` reads the
 * rows and calls these in the order the stats are assembled. Nothing here reads, writes or throws.
 */

import type {
  KanbanStatsCreatedRow,
  KanbanStatsFixedRow,
  KanbanStatsOpenRow,
} from '@/modules/database/index.js';
import type {
  KanbanAgedCard,
  KanbanAgedOpenCard,
  KanbanFixTime,
  KanbanPriority,
  KanbanStats,
  KanbanStatsDay,
  KanbanWayIn,
} from '@/shared/kanban-types.js';

/** Milliseconds in one hour; turns the gap between two stamps into the hours the dashboard shows. */
const MS_PER_HOUR = 3_600_000;

/** Milliseconds in one UTC day; the window and the card ages are counted in whole UTC days. */
export const MS_PER_DAY = 86_400_000;

/** How many of the oldest open cards the dashboard names; the rest are counted, not listed. */
const OLDEST_OPEN_SHOWN = 10;

/** The percentile the slow tail of time to fix is reported at, by nearest rank. */
const P90 = 0.9;

/** The source a card is filed under when no creating event recorded who opened it. */
const UNKNOWN_SOURCE = 'unknown';

/** Characters in a 'YYYY-MM-DD' day key: the prefix of every ISO stamp the day counts read. */
const DAY_KEY_LENGTH = 10;

/** Steps per unit when a figure is rounded to one decimal place. */
const TENTHS_PER_UNIT = 10;

/** The stored value of `archived` on a card that is still in use. */
const NOT_ARCHIVED = 0;

/** The status a fixed card carries; done is the one status that is not open. */
const DONE_STATUS = 'done';

/** The priority the oldest-high figure is read for. */
const HIGH_PRIORITY = 'high';

/**
 * Open cards counted by priority and by lane. Every key starts at zero, so an empty lane reads as zero
 * rather than going missing. The lane count skips a done card because done has no lane in the open
 * figures; the open read never returns one, so the skip only keeps the lane index typed.
 */
export function openCounts(open: KanbanStatsOpenRow[]): KanbanStats['open'] {
  const byPriority = { high: 0, medium: 0, low: 0 };
  const byLane = { not_ready: 0, todo: 0, questions: 0, active: 0 };
  for (const row of open) {
    byPriority[row.priority] += 1;
    if (row.status !== DONE_STATUS) {
      byLane[row.status] += 1;
    }
  }
  return { total: open.length, byPriority, byLane };
}

/**
 * Whole UTC days a card has been open. A stamp that does not parse, or that lies in the future, reads as
 * zero days rather than a negative or NaN age the dashboard would print.
 */
function ageInDays(createdAt: string, now: Date): number {
  const ageMs = now.getTime() - Date.parse(createdAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return 0;
  }
  return Math.floor(ageMs / MS_PER_DAY);
}

/**
 * The oldest open cards, named for a person and carrying their priority and status. The read is oldest
 * first, so the front of it is the oldest work on the board.
 */
export function oldestOpenCards(open: KanbanStatsOpenRow[], now: Date): KanbanAgedOpenCard[] {
  return open.slice(0, OLDEST_OPEN_SHOWN).map((row) => ({
    cardId: row.id,
    boardId: row.board_id,
    boardName: row.board_name,
    title: row.title,
    createdAt: row.created_at,
    ageDays: ageInDays(row.created_at, now),
    priority: row.priority,
    status: row.status,
  }));
}

/**
 * The oldest open card of high priority, without the priority and status fields. The first match is the
 * oldest, because the read is oldest first. Null when no high-priority card is open, which is not the
 * same thing as a card that is zero days old.
 */
export function oldestOpenHighCard(open: KanbanStatsOpenRow[], now: Date): KanbanAgedCard | null {
  const row = open.find((candidate) => candidate.priority === HIGH_PRIORITY);
  if (!row) {
    return null;
  }
  return {
    cardId: row.id,
    boardId: row.board_id,
    boardName: row.board_name,
    title: row.title,
    createdAt: row.created_at,
    ageDays: ageInDays(row.created_at, now),
  };
}

/**
 * Hours from a card's creation to its arrival in Done, or null when either stamp does not parse. A done
 * stamp that precedes its creation is clamped to zero hours rather than shown as a negative duration.
 */
function hoursToFix(row: KanbanStatsFixedRow): number | null {
  const createdMs = Date.parse(row.created_at);
  const doneMs = Date.parse(row.done_at);
  if (!Number.isFinite(createdMs) || !Number.isFinite(doneMs)) {
    return null;
  }
  return Math.max(0, (doneMs - createdMs) / MS_PER_HOUR);
}

/**
 * The hours of every fixed card whose two stamps parse. A card that does not parse is left out of the
 * list, not counted as a zero-hour fix that would drag the median down.
 */
function hoursToFixOf(fixed: KanbanStatsFixedRow[]): number[] {
  const hours: number[] = [];
  for (const row of fixed) {
    const rowHours = hoursToFix(row);
    if (rowHours !== null) {
      hours.push(rowHours);
    }
  }
  return hours;
}

/** Rounds to one decimal place, the precision the dashboard shows hours at. */
function roundToTenth(value: number): number {
  return Math.round(value * TENTHS_PER_UNIT) / TENTHS_PER_UNIT;
}

/**
 * The count, median, and nearest-rank 90th percentile of a list of hours, each rounded to one decimal.
 * Null for an empty list, because no card closed is not the same as a fix that took zero hours. The
 * median of an even count is the mean of its two middles; the p90 is always a value a card actually took.
 */
function summariseHours(hours: number[]): KanbanFixTime {
  if (hours.length === 0) {
    return null;
  }
  const sorted = [...hours].sort((a, b) => a - b);
  const count = sorted.length;
  const middle = Math.floor(count / 2);
  const medianHours =
    count % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p90Hours = sorted[Math.ceil(P90 * count) - 1];
  return {
    count,
    medianHours: roundToTenth(medianHours),
    p90Hours: roundToTenth(p90Hours),
  };
}

/**
 * Time to fix across every priority, and for each priority on its own. Each figure is summarised from its
 * own rows, so a high-priority figure is never averaged in with a low one.
 */
export function timeToFixByPriority(fixed: KanbanStatsFixedRow[]): KanbanStats['timeToFix'] {
  const hoursOfPriority = (priority: KanbanPriority): number[] =>
    hoursToFixOf(fixed.filter((row) => row.priority === priority));
  return {
    all: summariseHours(hoursToFixOf(fixed)),
    high: summariseHours(hoursOfPriority('high')),
    medium: summariseHours(hoursOfPriority('medium')),
    low: summariseHours(hoursOfPriority('low')),
  };
}

/**
 * The day key of an ISO stamp: its first ten characters, which name the UTC calendar day it falls on.
 */
function dayKeyOf(isoStamp: string): string {
  return isoStamp.slice(0, DAY_KEY_LENGTH);
}

/**
 * The UTC day keys of the window, from its first day through today, in date order. Each key is built
 * the same way the stored stamps are keyed, so a card and its day always meet on the same key.
 */
export function windowDayKeys(windowStartMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, offset) =>
    dayKeyOf(new Date(windowStartMs + offset * MS_PER_DAY).toISOString())
  );
}

/**
 * How many stamps fall on each of the given days, with every day present at zero. A stamp outside the
 * window has no key in the map, so it is ignored rather than counted under a day the chart does not show.
 */
function countStampsByDay(dayKeys: string[], stamps: string[]): Map<string, number> {
  const counts = new Map<string, number>(dayKeys.map((day): [string, number] => [day, 0]));
  for (const stamp of stamps) {
    const day = dayKeyOf(stamp);
    const current = counts.get(day);
    if (current !== undefined) {
      counts.set(day, current + 1);
    }
  }
  return counts;
}

/**
 * One row per day of the window, zeros included, so the chart never has to invent a missing day. Opened
 * counts the creation stamps and fixed counts the done stamps, each on the day it falls on.
 */
export function dailyCounts(
  dayKeys: string[],
  created: KanbanStatsCreatedRow[],
  fixed: KanbanStatsFixedRow[]
): KanbanStatsDay[] {
  const openedByDay = countStampsByDay(
    dayKeys,
    created.map((row) => row.created_at)
  );
  const fixedByDay = countStampsByDay(
    dayKeys,
    fixed.map((row) => row.done_at)
  );
  return dayKeys.map((day) => ({
    day,
    opened: openedByDay.get(day) ?? 0,
    fixed: fixedByDay.get(day) ?? 0,
  }));
}

/**
 * Cards grouped by who opened them: how work reached the board. A card with no recorded creator is
 * grouped under UNKNOWN_SOURCE rather than dropped, so the groups still add up to the cards opened.
 * Largest group first, then by name, so the order is the same from one read to the next.
 */
export function waysInOf(created: KanbanStatsCreatedRow[]): KanbanWayIn[] {
  const tallies = new Map<string, { opened: number; open: number }>();
  for (const row of created) {
    const source = row.creator ?? UNKNOWN_SOURCE;
    const tally = tallies.get(source) ?? { opened: 0, open: 0 };
    tally.opened += 1;
    if (row.archived === NOT_ARCHIVED && row.status !== DONE_STATUS) {
      tally.open += 1;
    }
    tallies.set(source, tally);
  }
  return Array.from(tallies, ([source, tally]) => ({
    source,
    opened: tally.opened,
    open: tally.open,
  })).sort((a, b) => b.opened - a.opened || a.source.localeCompare(b.source));
}
