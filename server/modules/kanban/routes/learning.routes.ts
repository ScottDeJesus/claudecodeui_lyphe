import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { KANBAN_LESSON_STATUSES, lessonNotFound } from '../kanban-lessons.service.js';
import type { KanbanLessonInput, KanbanLessonsService } from '../kanban-lessons.service.js';

/**
 * The lesson routes: the corpus a build learned, and the one place a person reviews it.
 *
 * Four of the five handlers call exactly one service verb and shape the answer — the index, the
 * by-id read and the two reviews. The fifth, the stage, is the only one with a body to read, and
 * its checks are transport checks: the service decides whether a card exists, never whether a name
 * is a string.
 *
 * THE REVIEW IS THE FENCE, and it is not enforced here. Both mounts carry this router — the
 * operator's `/api/kanban` behind `authenticateToken` and the child's `/api/kanban-pm` behind
 * `kanbanMetisSecretGuard` — so a refusal written in a handler would be a refusal a second mount
 * could forget. It lives in the guard, ahead of the router, where the door itself is
 * (`kanban-metis.routes.ts`'s `REVIEW_PATH`). Nothing in this file knows which mount it serves.
 */

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type LearningRouteDependencies = { lessons: KanbanLessonsService };

/** The index read's default and ceiling, exactly as `mcp_tools_lessons.py`'s schema states them. */
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
 * route table spells the unfiltered call, and the ported source reads an empty filter as none
 * (`server_api_lessons.py:39`, `body.get("status") or None`). Refusing `''` would answer a 400 to
 * the very spelling the plan writes down, for a filter the caller did not specify.
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
 * Refused rather than clamped, matching `mcp_tools_lessons.py:184-186`: a silently clamped limit
 * hides the caller's bug, and the "full dedupe sweep" its schema documents only works if 500 means
 * 500.
 */
function parseLimit(value: unknown): number | undefined | null {
  const raw = filterValue(value);
  if (raw === undefined) return undefined;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== raw.trim()) return null;
  return parsed >= 1 && parsed <= LESSON_LIMIT_MAX ? parsed : null;
}

/** The stage body read into the service's input, or the sentence saying which field is wrong. */
function readLessonInput(body: Record<string, unknown>): KanbanLessonInput | string {
  const { name, summary, trigger, body: text, tags, cardId, kind } = body;

  if (typeof name !== 'string' || name === '') return 'a lesson name is required';
  if (typeof summary !== 'string') return 'summary must be a string';
  if (typeof trigger !== 'string' || trigger === '') return 'a lesson trigger is required';
  if (text !== undefined && typeof text !== 'string') return 'body must be a string';
  if (cardId !== undefined && cardId !== null && typeof cardId !== 'string') {
    return 'cardId must be a string or null';
  }
  if (kind !== undefined && kind !== 'note' && kind !== 'skill_draft') {
    return "kind must be 'note' or 'skill_draft'";
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
      return 'tags must be an array of strings';
    }
  }

  return {
    name,
    summary,
    trigger,
    body: text as string | undefined,
    tags: tags as string[] | undefined,
    cardId: cardId as string | null | undefined,
    kind: kind as 'note' | 'skill_draft' | undefined,
  };
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

  router.post('/lessons', handle((request, response) => {
    const input = readLessonInput((request.body ?? {}) as Record<string, unknown>);
    if (typeof input === 'string') {
      response.status(400).json({ error: input });
      return;
    }

    response.status(201).json({ lesson: lessons.stageLesson(input) });
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
