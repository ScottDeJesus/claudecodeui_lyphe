import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import {
  KANBAN_CHANGELOG_LIMIT_DEFAULT,
  KANBAN_CHANGELOG_LIMIT_MAX,
  KANBAN_STATS_DAYS_DEFAULT,
  KANBAN_STATS_DAYS_MAX,
  type KanbanChangelogEntry,
} from '@/shared/kanban-types.js';

import type { KanbanStatsService } from '../kanban-stats.service.js';

/**
 * The scope word the dashboard sends for the whole install.
 *
 * It means the same as leaving the parameter off: every board that is not archived. The word is
 * spelled out so a link that says `board=all` reads as what it does.
 */
const ALL_BOARDS = 'all';

/**
 * The two shapes a changelog can be answered in. `md` is what the dashboard's `Copy as Markdown`
 * fetches; JSON is what every other reader takes.
 */
const FORMAT_JSON = 'json';
const FORMAT_MARKDOWN = 'md';
const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';

/**
 * The length of the `YYYY-MM-DD` prefix of an ISO timestamp: the part of a done-time a person reads
 * as the day the card was finished.
 */
const ISO_DATE_LENGTH = 10;

/** A query value is always decimal; passing the radix stops `parseInt` guessing one from a prefix. */
const DECIMAL_RADIX = 10;

/** The smallest value a bounded query may ask for; anything below it is treated as absent. */
const BOUNDED_INT_MINIMUM = 1;

/** The status a refused request carries; the same 400 the board routes answer with. */
const HTTP_BAD_REQUEST = 400;

/** A run of carriage returns and line feeds, the breaks that would split a Markdown line in two. */
const LINE_BREAKS = /[\r\n]+/g;

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type StatsRouteDependencies = { stats: KanbanStatsService };

/**
 * One handler, with its failure path attached once.
 *
 * Every service failure is an `AppError` and belongs to `next(error)`, which turns it into the
 * global handler's `{ success: false, error: { code, message } }`. Nothing is caught here: a route
 * that decided what an error meant would be a second, quieter policy beside the service's.
 */
function handle<P = Record<string, string>>(
  run: (request: Request<P>, response: Response) => void
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      run(request, response);
    } catch (error) {
      next(error);
    }
  };
}

/** A query value that may arrive repeated or as a nested object; only the first plain string counts. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * The board a stats read is about: one board by id, or `null` for the whole install.
 *
 * Absent, empty and `all` all mean the whole install, so a dashboard that leaves the parameter off
 * gets the same numbers as one that asks for `all`. Archived boards are left out of that view. An id
 * is handed through untouched; the service is the one that answers 404 for an unknown board.
 */
function parseScope(value: unknown): string | null {
  const raw = firstString(value);
  if (raw === undefined || raw === '' || raw === ALL_BOARDS) return null;

  return raw;
}

/**
 * Clamps a numeric query to `[BOUNDED_INT_MINIMUM, max]`, falling back when it is absent or unusable.
 *
 * A bad number falls back to the default instead of failing the request: a dashboard that sends
 * `days=abc` gets the usual window, the same forgiving rule the audit-log limit follows. The clamp
 * stops one request from asking for a whole history.
 */
function parseBoundedInt(value: unknown, fallback: number, max: number): number {
  const raw = firstString(value);
  if (raw === undefined) return fallback;

  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (!Number.isFinite(parsed) || parsed < BOUNDED_INT_MINIMUM) return fallback;

  return Math.min(parsed, max);
}

/**
 * A title or board name may carry a line break (the board's own create and patch routes accept one);
 * folded to a space so each entry stays one Markdown line.
 */
function asOneLine(text: string): string {
  return text.replace(LINE_BREAKS, ' ');
}

/**
 * Renders a changelog as the Markdown a person pastes into a note: one dated line per entry, in the
 * order the service gave them, newest first.
 *
 * The line carries names and never ids (INV-76): the id is what a program keys on, and a pasted
 * note is read by a person. An empty list is an empty body, not a lone newline.
 */
function changelogAsMarkdown(entries: KanbanChangelogEntry[]): string {
  if (entries.length === 0) return '';

  const lines = entries.map(
    (entry) =>
      `- ${entry.doneAt.slice(0, ISO_DATE_LENGTH)} — ${entry.changelog} (${asOneLine(entry.title)}, ${asOneLine(entry.boardName)})`
  );

  return `${lines.join('\n')}\n`;
}

/**
 * The stats routes: the board's numbers over a window of days, and its changelog as JSON or as
 * Markdown.
 *
 * Auth is the mount's (`authenticateToken` on `/api/kanban` in `server/index.ts`): no file here
 * imports a guard.
 *
 * These handlers parse, call one service verb and shape the answer. No transaction, no database
 * handle, and no board policy lives here. Both routes are reads: they open no transaction and send
 * no frame. The `md` answer is what the dashboard's `Copy as Markdown` fetches.
 */
export function createStatsRoutes(dependencies: StatsRouteDependencies): Router {
  const router = express.Router();
  const { stats } = dependencies;

  router.get(
    '/stats',
    handle((request, response) => {
      const scope = parseScope(request.query.board);
      const days = parseBoundedInt(request.query.days, KANBAN_STATS_DAYS_DEFAULT, KANBAN_STATS_DAYS_MAX);

      response.json({ stats: stats.stats(scope, days) });
    })
  );

  router.get(
    '/changelog',
    handle((request, response) => {
      // The format is refused before the service is asked, so a request that cannot be answered
      // never costs a read of the history.
      const format = request.query.format === undefined ? FORMAT_JSON : firstString(request.query.format);
      if (format !== FORMAT_JSON && format !== FORMAT_MARKDOWN) {
        response.status(HTTP_BAD_REQUEST).json({ error: 'format must be json or md' });
        return;
      }

      const scope = parseScope(request.query.board);
      const since = firstString(request.query.since) ?? null;
      const limit = parseBoundedInt(request.query.limit, KANBAN_CHANGELOG_LIMIT_DEFAULT, KANBAN_CHANGELOG_LIMIT_MAX);
      const entries = stats.changelog(scope, { since, limit });

      if (format === FORMAT_MARKDOWN) {
        response.type(MARKDOWN_CONTENT_TYPE).send(changelogAsMarkdown(entries));
        return;
      }

      response.json({ changelog: entries });
    })
  );

  return router;
}
