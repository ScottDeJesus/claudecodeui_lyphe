/**
 * The board's numbers: the stats the dashboard draws and the changelog it lists. A read only, so it
 * goes through no transaction and no write seam, and sends no frame.
 *
 * Every figure is computed at each read from the card rows, and none is stored: no column holds a
 * count, so a stored count can never drift from the cards it counts.
 *
 * Two scopes, one rule. OPEN means not archived and not in done: the work still waiting. The history
 * figures (opened, fixed, time to fix, ways in, came back, the changelog) count archived cards too,
 * because a card fixed or opened and later archived still happened, and archiving it must not erase
 * that from the history.
 *
 * Consumers: `server/modules/kanban/routes/stats.routes.ts` (serves both reads). The rows come from
 * `kanbanStatsDb`, reached through `@/modules/database/index.js`. The arithmetic itself lives in
 * `kanban-stats-figures.ts`, pure functions of the rows read here.
 */

import {
  kanbanBoardsDb,
  kanbanCardTagsDb,
  kanbanStatsDb,
  type KanbanStatsChangelogRow,
} from '@/modules/database/index.js';
import {
  KANBAN_CHANGELOG_LIMIT_DEFAULT,
  KANBAN_CHANGELOG_LIMIT_MAX,
  KANBAN_STATS_DAYS_MAX,
  type KanbanChangelogEntry,
  type KanbanChangelogKind,
  type KanbanStats,
} from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import {
  dailyCounts,
  MS_PER_DAY,
  oldestOpenCards,
  oldestOpenHighCard,
  openCounts,
  timeToFixByPriority,
  waysInOf,
  windowDayKeys,
} from './kanban-stats-figures.js';

/** SQLite stores a flag as 1 when it is set, which is how `came_back` reads. */
const FLAG_SET = 1;

/** The fewest days a stats window can cover: one, which is today alone. */
const MIN_STATS_DAYS = 1;

/** The fewest changelog lines a page can ask for. */
const MIN_CHANGELOG_LIMIT = 1;

/**
 * The changelog kinds, in the order they win: a card carrying two kind tags files under the first one
 * listed. Each kind is also the tag that names it, so adding a kind is one entry here.
 */
const CHANGELOG_KIND_TAGS: readonly KanbanChangelogKind[] = [
  'regression',
  'bug',
  'ui-change',
  'tweak',
];

/** The board a read covers, by id and name; both are null when the read covers every live board. */
type KanbanScope = Pick<KanbanStats['scope'], 'boardId' | 'boardName'>;

/**
 * The scope a read names. A board id must name a board, archived ones included, because the caller
 * asked for it by name. Null is every board that is not archived, which has no single name to show.
 */
function resolveScope(boardId: string | null): KanbanScope {
  if (boardId === null) {
    return { boardId: null, boardName: null };
  }
  const board = kanbanBoardsDb.getBoard(boardId);
  if (!board) {
    throw new AppError(`No kanban board with id "${boardId}".`, {
      code: 'KANBAN_BOARD_NOT_FOUND',
      statusCode: 404,
    });
  }
  return { boardId, boardName: board.name };
}

/**
 * Rejects a window that is not a whole number of days in range. The route clamps the value first; this
 * guards the callers that are not the route, so a bad window cannot reach the reads.
 */
function assertStatsDays(days: number): void {
  if (!Number.isInteger(days) || days < MIN_STATS_DAYS || days > KANBAN_STATS_DAYS_MAX) {
    throw new AppError(
      `days must be a whole number from ${MIN_STATS_DAYS} to ${KANBAN_STATS_DAYS_MAX}.`,
      {
        code: 'KANBAN_STATS_DAYS_INVALID',
        statusCode: 400,
      }
    );
  }
}

/**
 * Rejects a changelog page size that is not a whole number in range, so one request cannot pull a
 * whole project's history into a page.
 */
function assertChangelogLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < MIN_CHANGELOG_LIMIT || limit > KANBAN_CHANGELOG_LIMIT_MAX) {
    throw new AppError(
      `limit must be a whole number from ${MIN_CHANGELOG_LIMIT} to ${KANBAN_CHANGELOG_LIMIT_MAX}.`,
      {
        code: 'KANBAN_CHANGELOG_LIMIT_INVALID',
        statusCode: 400,
      }
    );
  }
}

/**
 * The changelog's lower bound as an ISO stamp, or null when none was asked for. An empty string counts
 * as none, so a blank parameter reads as no cutoff. The stamp is normalised so the text comparison in
 * the read sorts the same way as the instants it names.
 */
function changelogSinceIso(since: string | null | undefined): string | null {
  if (!since) {
    return null;
  }
  if (!Number.isFinite(Date.parse(since))) {
    throw new AppError('since must be a date, such as 2026-11-01.', {
      code: 'KANBAN_CHANGELOG_SINCE_INVALID',
      statusCode: 400,
    });
  }
  return new Date(since).toISOString();
}

/**
 * The first kind, in CHANGELOG_KIND_TAGS order, whose tag the card carries. Null when the card carries
 * none of them, so an untagged card still gets a line rather than being dropped.
 */
function changelogKindOf(tags: string[]): KanbanChangelogKind | null {
  return CHANGELOG_KIND_TAGS.find((kind) => tags.includes(kind)) ?? null;
}

/**
 * One changelog line, named by its board and title as well as its id. The tags come in from the caller,
 * which reads them once for the whole page, because the kind is filed from them.
 */
function toChangelogEntry(row: KanbanStatsChangelogRow, tags: string[]): KanbanChangelogEntry {
  return {
    cardId: row.id,
    boardId: row.board_id,
    boardName: row.board_name,
    title: row.title,
    kind: changelogKindOf(tags),
    changelog: row.changelog,
    doneAt: row.done_at,
  };
}

/**
 * The board's stats and changelog, for one board or for every board that is not archived (a null
 * `boardId`). A board id must name a board, archived ones included; a board that is not there is the
 * same 404 every board verb answers.
 */
export const kanbanStatsService = {
  /**
   * The dashboard's figures over a window of whole UTC days ending today. The window starts at UTC
   * midnight so its first day is whole, and the day keys match the UTC stamps the cards store. `now` is
   * a parameter so the window and the card ages are measured against the same instant.
   */
  stats(boardId: string | null, days: number, now: Date = new Date()): KanbanStats {
    assertStatsDays(days);
    const scope = resolveScope(boardId);
    const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const windowStartMs = todayMs - (days - 1) * MS_PER_DAY;
    const since = new Date(windowStartMs).toISOString();
    const open = kanbanStatsDb.openCards(scope.boardId);
    const fixed = kanbanStatsDb.fixedSince(scope.boardId, since);
    const created = kanbanStatsDb.createdSince(scope.boardId, since);
    return {
      scope: { boardId: scope.boardId, boardName: scope.boardName, days },
      open: openCounts(open),
      oldestOpenHigh: oldestOpenHighCard(open, now),
      oldestOpen: oldestOpenCards(open, now),
      timeToFix: timeToFixByPriority(fixed),
      byDay: dailyCounts(windowDayKeys(windowStartMs, days), created, fixed),
      waysIn: waysInOf(created),
      cameBack: created.filter((row) => row.came_back === FLAG_SET).length,
    };
  },

  /**
   * The changelog: the lines of cards that reached Done, newest fix first, each filed under the kind its
   * tags name. `since` is a cutoff, and a bare date such as 2026-11-01 is that UTC midnight. The page size
   * is capped so one page stays a page, not a whole project's history.
   */
  changelog(
    boardId: string | null,
    options: { since?: string | null; limit?: number } = {}
  ): KanbanChangelogEntry[] {
    const sinceIso = changelogSinceIso(options.since);
    const limit = options.limit ?? KANBAN_CHANGELOG_LIMIT_DEFAULT;
    assertChangelogLimit(limit);
    const scope = resolveScope(boardId);
    const rows = kanbanStatsDb.changelogEntries(scope.boardId, sinceIso, limit);
    const tagsByCardId = kanbanCardTagsDb.listTagsForCards(rows.map((row) => row.id));
    return rows.map((row) => toChangelogEntry(row, tagsByCardId.get(row.id) ?? []));
  },
};

export type KanbanStatsService = typeof kanbanStatsService;
