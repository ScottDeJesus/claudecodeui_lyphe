import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import type { KanbanLeaseResult } from '@/shared/kanban-types.js';

import type { KanbanChecklistService } from '../kanban-checklist.service.js';
import type { KanbanLeasesService } from '../kanban-leases.service.js';
import type { KanbanQuestionsService } from '../kanban-questions.service.js';

/** The dependencies this route package needs. `kanban.routes.ts` hands them over. */
export type DetailRouteDependencies = {
  questions: KanbanQuestionsService;
  checklist: KanbanChecklistService;
  leases: KanbanLeasesService;
};

/**
 * A refusal the ROUTE itself makes, about the shape of a request — never about the state of the
 * board. The readers below throw it, `handle` answers it as a 400, and a handler stays a straight
 * line. A SERVICE failure is still an `AppError`, still `next(error)`'s, and never caught here.
 */
class BadRequest extends Error {}

/**
 * One handler, with its two failure paths attached once.
 *
 * A malformed field is the transport's own refusal, answered here as `res.status(400).json({ error })`
 * — the shape the board's other route files use for a parse failure. Everything else is an
 * `AppError` and belongs to `next(error)`, which renders `{ success: false, error: { code, message } }`.
 */
function handle<P = Record<string, string>>(
  run: (request: Request<P>, response: Response) => void
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      run(request, response);
    } catch (error) {
      if (error instanceof BadRequest) {
        response.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

/** The request body as a record. `express.json()` is global; an absent body is an empty one. */
function readBody(request: Request): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>;
}

/** A required string field. Anything else — absent, null, a number — is the caller's own 400. */
function readString(body: Record<string, unknown>, name: string): string {
  const raw = body[name];
  if (typeof raw !== 'string') throw new BadRequest(`${name} must be a string`);
  return raw;
}

/** An optional string field: `undefined` when it was not sent. */
function readOptionalString(body: Record<string, unknown>, name: string): string | undefined {
  const raw = body[name];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') throw new BadRequest(`${name} must be a string`);
  return raw;
}

/**
 * A list of strings, checked member by member rather than trusted.
 *
 * Checked because the array is stored as JSON and read back as choices the panel renders one row
 * per: a number in the middle of it would reach the drawer as a choice nobody can read.
 */
function asStringList(raw: unknown, name: string): string[] {
  if (!Array.isArray(raw) || !raw.every((member) => typeof member === 'string')) {
    throw new BadRequest(`${name} must be an array of strings`);
  }
  return raw as string[];
}

/** An optional list of strings: `undefined` when the field was not sent at all. */
function readOptionalStringList(body: Record<string, unknown>, name: string): string[] | undefined {
  const raw = body[name];
  return raw === undefined || raw === null ? undefined : asStringList(raw, name);
}

/**
 * A REQUIRED list of strings — an answer's `selected`, which the route table declares present.
 *
 * Required rather than defaulted to `[]`: an empty selection still marks the question answered, and
 * the approve gate reads only `answered = 0` — so a request that chose nothing would open the gate.
 */
function readStringList(body: Record<string, unknown>, name: string): string[] {
  const raw = body[name];
  if (raw === undefined || raw === null) throw new BadRequest(`${name} must be an array of strings`);
  return asStringList(raw, name);
}

/** An optional boolean field: `undefined` when it was not sent. */
function readOptionalBoolean(body: Record<string, unknown>, name: string): boolean | undefined {
  const raw = body[name];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'boolean') throw new BadRequest(`${name} must be a boolean`);
  return raw;
}

/** An optional checklist state, refused here rather than by the column's CHECK as a 500. */
function readOptionalState(
  body: Record<string, unknown>,
  name: string
): 'pending' | 'active' | 'done' | undefined {
  const raw = readOptionalString(body, name);
  if (raw === undefined) return undefined;
  if (raw !== 'pending' && raw !== 'active' && raw !== 'done') {
    throw new BadRequest(`${name} must be pending, active or done`);
  }
  return raw;
}

/** A lease owner: a required, non-blank name for the process taking or giving up the lease. */
function readOwner(body: Record<string, unknown>): string {
  const owner = readString(body, 'owner').trim();
  if (owner.length === 0) throw new BadRequest('a lease owner is required');
  return owner;
}

/**
 * One lease route, built from the verb it runs.
 *
 * All five leases take the same body — an owner — and answer with the same verdict, so the parsing
 * and the response shape live here once and each route is a path plus a verb.
 */
function leaseRoute(
  run: (cardId: string, owner: string) => KanbanLeaseResult
): RequestHandler<{ cardId: string }> {
  return handle<{ cardId: string }>((request, response) => {
    response.json(run(request.params.cardId, readOwner(readBody(request))));
  });
}

/**
 * The detail routes: a card's questions and their answers, its issues and their resolutions, its
 * checklist, its approval, and the five leases.
 *
 * A card's attachment BYTES are not here: they are their own route file
 * (`attachment.routes.ts`), because they are the only routes in the package that handle a
 * multipart body and stream a file rather than parse JSON.
 *
 * Auth is the mount's (`authenticateToken` in `server/index.ts`): no file here imports the guard,
 * and no route reads an actor off the request — the write verbs take the optional trailing context
 * and the routes pass nothing, so an event's actor is `'operator'`. A lease is the exception, and
 * deliberately: its owner is its own concept and travels as its own field.
 *
 * These handlers parse, call one service verb and shape the answer. No transaction, no database
 * handle and no board policy lives here.
 */
export function createDetailRoutes(dependencies: DetailRouteDependencies): Router {
  const router = express.Router();
  const { questions, checklist, leases } = dependencies;

  router.post(
    '/cards/:cardId/questions',
    handle<{ cardId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        question: questions.addQuestion(request.params.cardId, {
          text: readString(body, 'text'),
          options: readOptionalStringList(body, 'options'),
          multi: readOptionalBoolean(body, 'multi'),
          otherOn: readOptionalBoolean(body, 'otherOn'),
        }),
      });
    })
  );

  router.post(
    '/questions/:questionId/answer',
    handle<{ questionId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        question: questions.answerQuestion(request.params.questionId, {
          selected: readStringList(body, 'selected'),
          other: readOptionalString(body, 'other'),
        }),
      });
    })
  );

  router.post(
    '/cards/:cardId/issues',
    handle<{ cardId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        issue: checklist.fileIssue(request.params.cardId, { text: readString(body, 'text') }),
      });
    })
  );

  router.post(
    '/issues/:issueId/resolve',
    handle<{ issueId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        issue: checklist.resolveIssue(request.params.issueId, {
          resolvedBy: readOptionalString(body, 'resolvedBy'),
        }),
      });
    })
  );

  router.post(
    '/cards/:cardId/checklist',
    handle<{ cardId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        item: checklist.addChecklistItem(request.params.cardId, {
          text: readString(body, 'text'),
          note: readOptionalString(body, 'note'),
        }),
      });
    })
  );

  router.patch(
    '/checklist/:itemId',
    handle<{ itemId: string }>((request, response) => {
      const body = readBody(request);

      response.json({
        item: checklist.updateChecklistItem(request.params.itemId, {
          state: readOptionalState(body, 'state'),
          text: readOptionalString(body, 'text'),
          note: readOptionalString(body, 'note'),
        }),
      });
    })
  );

  router.delete(
    '/checklist/:itemId',
    handle<{ itemId: string }>((request, response) => {
      checklist.removeChecklistItem(request.params.itemId);
      response.json({ ok: true });
    })
  );

  router.post(
    '/cards/:cardId/approve',
    handle<{ cardId: string }>((request, response) => {
      response.json({ card: questions.approveCard(request.params.cardId) });
    })
  );

  router.post(
    '/cards/:cardId/unapprove',
    handle<{ cardId: string }>((request, response) => {
      response.json({ card: questions.unapproveCard(request.params.cardId) });
    })
  );

  // The five leases, one path and one verb each — the parsing and the verdict are `leaseRoute`'s.
  router.post('/cards/:cardId/build-lease/claim', leaseRoute(leases.claimBuildLease));
  router.post('/cards/:cardId/build-lease/refresh', leaseRoute(leases.refreshBuildLease));
  router.post('/cards/:cardId/build-lease/release', leaseRoute(leases.releaseBuildLease));
  router.post('/cards/:cardId/plan-lease/claim', leaseRoute(leases.claimPlanLease));
  router.post('/cards/:cardId/plan-lease/release', leaseRoute(leases.releasePlanLease));

  return router;
}
