import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { KANBAN_LESSON_STATUSES, lessonNotFound } from '../kanban-lessons.service.js';
import type { KanbanLessonsService } from '../kanban-lessons.service.js';

/**
 * The lesson routes: the read of what a build learned, and the one place a person reviews it.
 *
 * Four handlers, each one service verb: the index, the by-id read and the two reviews. Lessons are
 * staged by the `/learn` spill sweep, not through a route. The router has one mount, `/api/kanban`
 * behind `authenticateToken`.
 */

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type LearningRouteDependencies = { lessons: KanbanLessonsService };

/**
 * The index read's default and ceiling: 100 back unless a caller asks for more, 500 at the most.
 */
const LESSON_LIMIT_DEFAULT = 100;
const LESSON_LIMIT_MAX = 500;

/**
 * One handler, with its failure path attached once.
 *
 * Every service failure is an `AppError` and belongs to `next(error)`, which turns it into the
 * global handler's `{ success: false, error: { code, message } }`. Nothing is caught here: a route
 * that decided what an error meant would be a second, quieter policy beside the service's.
 */
function handle<P extends Record<string, string>>(
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

/**
 * A query value as a filter, or `undefined` when the caller gave no filter at all.
 *
 * A repeated parameter arrives as an array in Express and only the first plain string counts. A
 * BLANK value is no filter either: `GET /api/kanban/lessons?status=&limit=` is how this plan's own
 * route table spells the unfiltered call, and an empty filter is no filter. Refusing `''` would
 * answer a 400 to the very spelling the plan writes down, for a filter the caller did not
 * specify.
 */
function filterValue(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
  if (typeof raw !== 'string') return undefined;
  return raw.trim() === '' ? undefined : raw;
}

/**
 * `?status=` narrowed to the three words a lesson can be in, or `null` when the filter is unusable.
 *
 * An absent filter is not an error — it lists every lesson — but a status this corpus has never
 * had is a caller's bug, and answering it with an empty list would hide it. The vocabulary lives in
 * the service, beside the verbs that write it.
 */
function parseStatus(value: unknown): string | undefined | null {
  const raw = filterValue(value);
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  return (KANBAN_LESSON_STATUSES as readonly string[]).includes(lower) ? lower : null;
}

/**
 * `?limit=` inside `[1, 500]`, or `undefined` for a value that is absent, unusable or outside it.
 *
 * Refused rather than clamped: a silently clamped limit hides the caller's bug, and a full sweep
 * of the index only works if 500 means 500.
 */
function parseLimit(value: unknown): number | undefined | null {
  const raw = filterValue(value);
  if (raw === undefined) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== raw.trim()) return null;
  return parsed >= 1 && parsed <= LESSON_LIMIT_MAX ? parsed : null;
}

export function createLearningRoutes(dependencies: LearningRouteDependencies): Router {
  const router = express.Router();
  const { lessons } = dependencies;

  router.get('/lessons', handle((request, response) => {
    const status = parseStatus(request.query.status);
    if (status === null) {
      response
        .status(400)
        .json({ error: `status must be one of ${KANBAN_LESSON_STATUSES.join(', ')}` });
      return;
    }

    const limit = parseLimit(request.query.limit);
    if (limit === null) {
      response
        .status(400)
        .json({ error: `limit must be an integer between 1 and ${LESSON_LIMIT_MAX}` });
      return;
    }

    response.json({
      lessons: lessons.listLessons({ status, limit: limit ?? LESSON_LIMIT_DEFAULT }),
    });
  }));

  router.get('/lessons/:lessonId', handle<{ lessonId: string }>((request, response) => {
    const lesson = lessons.getLesson(request.params.lessonId);
    if (lesson === null) throw lessonNotFound(request.params.lessonId);

    response.json({ lesson });
  }));

  /**
   * The two reviews. `reviewLesson` answers null for an id that names nothing (404) and throws its
   * own 422 for a lesson already out of `staged` — the sentence travels from the service untouched,
   * because it is the service that knows which state the row is actually in.
   */
  router.post('/lessons/:lessonId/approve', handle<{ lessonId: string }>((request, response) => {
    const lesson = lessons.reviewLesson(request.params.lessonId, true);
    if (lesson === null) throw lessonNotFound(request.params.lessonId);

    response.json({ lesson });
  }));

  router.post('/lessons/:lessonId/reject', handle<{ lessonId: string }>((request, response) => {
    const lesson = lessons.reviewLesson(request.params.lessonId, false);
    if (lesson === null) throw lessonNotFound(request.params.lessonId);

    response.json({ lesson });
  }));

  return router;
}
