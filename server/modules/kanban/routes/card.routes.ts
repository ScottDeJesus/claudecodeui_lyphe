import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import {
  KANBAN_LANE_LIMIT_DEFAULT,
  KANBAN_LANE_LIMIT_MAX,
  KANBAN_PRIORITIES,
  KANBAN_STATUSES,
  type KanbanPriority,
  type KanbanStatus,
} from '@/shared/kanban-types.js';

import type { KanbanCardsService } from '../kanban-cards.service.js';

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type CardRouteDependencies = {
  cards: KanbanCardsService;
};

/**
 * One handler, with its failure path attached once.
 *
 * Every service failure is an `AppError` and belongs to `next(error)`, which turns it into the
 * global handler's `{ success: false, error: { code, message } }`. Nothing is caught here: a route
 * that decided what an error meant would be a second, quieter policy beside the service's.
 *
 * A copy of `board.routes.ts`'s helper of the same name and shape. The two route files landed in
 * different phases and neither may import the other's privates; when a third sibling needs it, the
 * three copies belong in one transport module of their own.
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

/** Whether a value is one of the five statuses. The type guard the parsed query is narrowed by. */
function isStatus(value: unknown): value is KanbanStatus {
  return typeof value === 'string' && (KANBAN_STATUSES as readonly string[]).includes(value);
}

/** Whether a value is one of the three priorities. */
function isPriority(value: unknown): value is KanbanPriority {
  return typeof value === 'string' && (KANBAN_PRIORITIES as readonly string[]).includes(value);
}

/**
 * What `?status=` named: the statuses, or the member that was not one.
 *
 * A lane is a SET of statuses, so this is a COMMA-SEPARATED LIST — `status=todo` and
 * `status=todo,questions` are both ordinary, and `questions` is what the To Do lane adds when
 * autonomy is off. Split, trimmed, empties dropped; an unknown member is reported rather than
 * dropped, because silently ignoring it would answer a request for two statuses with one lane.
 */
function parseStatusList(value: unknown): { statuses: KanbanStatus[]; invalid: string | null } {
  const raw = firstString(value);
  if (raw === undefined) return { statuses: [], invalid: null };

  const statuses: KanbanStatus[] = [];
  for (const part of raw.split(',').map((piece) => piece.trim())) {
    if (part.length === 0) continue;
    if (!isStatus(part)) return { statuses: [], invalid: part };
    statuses.push(part);
  }

  return { statuses, invalid: null };
}

/** Clamps a lane limit to `[1, 200]`, defaulting to 50 when it is absent or unusable. */
function parseLaneLimit(value: unknown): number {
  const raw = firstString(value);
  if (raw === undefined) return KANBAN_LANE_LIMIT_DEFAULT;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return KANBAN_LANE_LIMIT_DEFAULT;

  return Math.min(parsed, KANBAN_LANE_LIMIT_MAX);
}

/** A body field that may be a string or absent; anything else is a 400 the caller must see. */
function optionalString(
  body: Record<string, unknown>,
  field: string
): { value: string | undefined; error: string | null } {
  const raw = body[field];
  if (raw === undefined) return { value: undefined, error: null };
  if (typeof raw !== 'string') return { value: undefined, error: `${field} must be a string` };
  return { value: raw, error: null };
}

/**
 * The card routes: the lane page, create, detail, patch, move, archive, restore and the two tag
 * writes.
 *
 * Auth is the mount's (`authenticateToken` in `server/index.ts`): no file here imports the guard,
 * and no route reads an actor off the request — the write verbs take the optional trailing context
 * and the routes pass nothing, so an event's actor is `'operator'`.
 *
 * These handlers parse, call one service verb and shape the answer. No transaction, no database
 * handle, and no lane policy lives here: which statuses compose a lane is the panel's, and the
 * `status` list arrives already composed.
 */
export function createCardRoutes(dependencies: CardRouteDependencies): Router {
  const router = express.Router();
  const { cards } = dependencies;

  router.get(
    '/boards/:boardId/cards',
    handle<{ boardId: string }>((request, response) => {
      const parsed = parseStatusList(request.query.status);

      if (parsed.invalid !== null) {
        response.status(400).json({ error: `"${parsed.invalid}" is not a card status` });
        return;
      }
      if (parsed.statuses.length === 0) {
        response.status(400).json({ error: 'status must name at least one card status' });
        return;
      }

      response.json(
        cards.listLaneCards(request.params.boardId, parsed.statuses, {
          limit: parseLaneLimit(request.query.limit),
          // Opaque here by design: the route neither parses a cursor nor builds one, so the
          // repository can change its format without this file moving.
          cursor: firstString(request.query.cursor) ?? null,
        })
      );
    })
  );

  router.post(
    '/boards/:boardId/cards',
    handle<{ boardId: string }>((request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const { value: description, error: descriptionError } = optionalString(body, 'description');

      if (typeof body.title !== 'string') {
        response.status(400).json({ error: 'a card title is required' });
        return;
      }
      if (descriptionError !== null) {
        response.status(400).json({ error: descriptionError });
        return;
      }
      if (body.status !== undefined && !isStatus(body.status)) {
        response.status(400).json({ error: 'status must be one of the five card statuses' });
        return;
      }
      if (body.priority !== undefined && !isPriority(body.priority)) {
        response.status(400).json({ error: 'priority must be low, medium or high' });
        return;
      }

      response.json({
        card: cards.createCard(request.params.boardId, {
          title: body.title,
          priority: isPriority(body.priority) ? body.priority : undefined,
          status: isStatus(body.status) ? body.status : undefined,
          description,
        }),
      });
    })
  );

  router.get(
    '/cards/:cardId',
    handle<{ cardId: string }>((request, response) => {
      response.json({ card: cards.getCard(request.params.cardId) });
    })
  );

  router.patch(
    '/cards/:cardId',
    handle<{ cardId: string }>((request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const patch: {
        title?: string;
        priority?: KanbanPriority;
        description?: string;
        body?: string;
        plan?: string | null;
        closingRemarks?: string;
      } = {};

      for (const field of ['title', 'description', 'body', 'closingRemarks'] as const) {
        const { value, error } = optionalString(body, field);
        if (error !== null) {
          response.status(400).json({ error });
          return;
        }
        if (value !== undefined) patch[field] = value;
      }

      // `plan` is the one field that may be CLEARED: null is a card with no plan, which is a
      // different state from a card whose plan was never touched.
      if (body.plan !== undefined && body.plan !== null && typeof body.plan !== 'string') {
        response.status(400).json({ error: 'plan must be a string or null' });
        return;
      }
      if (body.plan !== undefined) patch.plan = body.plan as string | null;

      if (body.priority !== undefined) {
        if (!isPriority(body.priority)) {
          response.status(400).json({ error: 'priority must be low, medium or high' });
          return;
        }
        patch.priority = body.priority;
      }

      response.json({ card: cards.updateCard(request.params.cardId, patch) });
    })
  );

  router.post(
    '/cards/:cardId/move',
    handle<{ cardId: string }>((request, response) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (!isStatus(body.status)) {
        response.status(400).json({ error: 'status must be one of the five card statuses' });
        return;
      }
      for (const field of ['afterId', 'beforeId'] as const) {
        if (body[field] !== undefined && body[field] !== null && typeof body[field] !== 'string') {
          response.status(400).json({ error: `${field} must be a card id or null` });
          return;
        }
      }

      response.json({
        card: cards.moveCard(request.params.cardId, {
          status: body.status,
          afterId: (body.afterId as string | null | undefined) ?? null,
          beforeId: (body.beforeId as string | null | undefined) ?? null,
        }),
      });
    })
  );

  router.post(
    '/cards/:cardId/archive',
    handle<{ cardId: string }>((request, response) => {
      response.json({ card: cards.archiveCard(request.params.cardId) });
    })
  );

  router.post(
    '/cards/:cardId/restore',
    handle<{ cardId: string }>((request, response) => {
      response.json({ card: cards.restoreCard(request.params.cardId) });
    })
  );

  router.post(
    '/cards/:cardId/tags',
    handle<{ cardId: string }>((request, response) => {
      const body = (request.body ?? {}) as { tag?: unknown };

      if (typeof body.tag !== 'string') {
        response.status(400).json({ error: 'a tag is required' });
        return;
      }

      response.json({ card: cards.addTag(request.params.cardId, body.tag) });
    })
  );

  router.delete(
    '/cards/:cardId/tags/:tag',
    handle<{ cardId: string; tag: string }>((request, response) => {
      response.json({ card: cards.removeTag(request.params.cardId, request.params.tag) });
    })
  );

  return router;
}
