/**
 * What `GET /api/kanban-dispatch/dashboard` answers: the board's own stats and changelog, and the cases
 * door's and the dispatcher's bug stats, and the bug hunters' report (`dispatcher hunt status --json`). Each house section is `{ ok: true, value } | { ok: false, error }`,
 * so a door that did not answer blanks its own section and nothing else. The board's numbers are this
 * server's own reads and always arrive. It is a read: no transaction, no frame, no write.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { kanbanStatsService, type KanbanChangelogEntry, type KanbanStats } from '@/modules/kanban/index.js';
import { readDispatcherJson, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';
import type { HuntStatus } from '@/shared/hunt-types.js';
import { KANBAN_STATS_DAYS_DEFAULT, KANBAN_STATS_DAYS_MAX } from '@/shared/kanban-types.js';

import { readCasesStats, readTicketStats, type CasesStats, type TicketStats } from './kanban-dispatch.dashboard-parts.js';
import { readHuntStatus } from './kanban-dispatch.dashboard-hunts.js';

/** The scope word for the whole install. Spelled out so a link that says `board=all` reads as what it does. */
const ALL_BOARDS = 'all';

/** A query is decimal; the radix is passed so `parseInt` never guesses another base from a prefix. */
const DECIMAL_RADIX = 10;

/** The smallest window a request may ask for; anything below it is treated as absent. */
const DAYS_MINIMUM = 1;

/**
 * The most one house command may print. Cases stats lists every open regression with its paragraph-long
 * sentence; on 2026-11-19 the live answer is tens of kilobytes, so a few megabytes is headroom. It is
 * stated here rather than left to execFile's default, so the ceiling is a number beside the reads it governs.
 */
const MAX_BUFFER = 4 * 1024 * 1024;

/** The two house doors: the dispatcher's own composition, and the cases door's (its own binary, `door: 'cases'`), both built by the module root. */
export type DashboardDependencies = { dispatcher: DispatcherCommandDependencies; cases: DispatcherCommandDependencies };

/** A house section's answer. A failure carries the door's own sentence, so the page can say why a section is blank. */
export type DashboardPart<Value> = { ok: true; value: Value } | { ok: false; error: string };

/** The board's own numbers come first and cannot fail on their own; the three house sections each can fail alone. */
export type DashboardAnswer = { stats: KanbanStats; changelog: KanbanChangelogEntry[]; cases: DashboardPart<CasesStats>; tickets: DashboardPart<TicketStats>; hunts: DashboardPart<HuntStatus> };

/** A query value may arrive repeated or as a nested object; only the first plain string counts. */
function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * One board by id, or `null` for every board that is not archived. An id is handed through untouched:
 * the service is the one that knows whether it exists, and its 404 is the answer for an unknown one.
 */
function parseScope(value: unknown): string | null {
  const raw = firstString(value);
  if (raw === undefined || raw === '' || raw === ALL_BOARDS) return null;

  return raw;
}

/**
 * A bad number falls back to the default rather than failing the request, and a large one is clamped
 * rather than refused. This is the rule `GET /api/kanban/stats` keeps, so both routes answer the same
 * window for the same link.
 */
function parseDays(value: unknown): number {
  const raw = firstString(value);
  if (raw === undefined) return KANBAN_STATS_DAYS_DEFAULT;

  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (!Number.isFinite(parsed) || parsed < DAYS_MINIMUM) return KANBAN_STATS_DAYS_DEFAULT;

  return Math.min(parsed, KANBAN_STATS_DAYS_MAX);
}

/**
 * Runs one house command and reads its document, and never throws. A failure is logged once and carried
 * in the answer, so a house that did not answer cannot take the board's own numbers down with it.
 */
async function readPart<Value>(
  argv: string[],
  door: DispatcherCommandDependencies,
  read: (body: unknown, document: string) => Value,
): Promise<DashboardPart<Value>> {
  const document = `${door.door ?? 'dispatcher'} ${argv.join(' ')}`;
  try {
    const body = await readDispatcherJson(argv, door, MAX_BUFFER);
    return { ok: true, value: read(body, document) };
  } catch (error) {
    const sentence = error instanceof Error ? error.message : String(error);
    console.error(`[kanban-dispatch] dashboard: ${sentence}`);
    return { ok: false, error: sentence };
  }
}

/**
 * The board's numbers are read first and synchronously, so an unknown board answers 404 before either
 * house command is started. Nothing here catches that error: it is the board's ordinary 404 and goes to `next`.
 */
export function createDashboardHandler(dependencies: DashboardDependencies): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const scope = parseScope(request.query.board);
      const days = parseDays(request.query.days);

      const stats = kanbanStatsService.stats(scope, days);
      const changelog = kanbanStatsService.changelog(scope);

      const [cases, tickets, hunts] = await Promise.all([
        readPart<CasesStats>(['stats', '--days', String(days), '--json'], dependencies.cases, readCasesStats),
        readPart<TicketStats>(['bug', 'stats', '--days', String(days), '--json'], dependencies.dispatcher, readTicketStats),
        readPart<HuntStatus>(['hunt', 'status', '--json'], dependencies.dispatcher, readHuntStatus),
      ]);

      const answer: DashboardAnswer = { stats, changelog, cases, tickets, hunts };
      response.json(answer);
    } catch (error) {
      next(error);
    }
  };
}
