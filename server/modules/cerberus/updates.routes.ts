import express from 'express';
import type { Request, Response, Router } from 'express';

import { AppError, asyncHandler, readPathParam } from '@/shared/utils.js';

import { getBatch, startBatch, wardensStatus } from './updates.service.js';

/**
 * The three routes of a warden update, mounted by `cerberus.routes.ts` under `/api/cerberus` beside its
 * nineteen: what a route decides here is transport SHAPE only — that `nodes` is a list of text — and
 * every refusal worth the name (no node named, a node that is not enrolled, nothing built, an update
 * already running) is `startBatch`'s, in the app's `{ success: false, error }` envelope.
 *
 *   GET  /wardens           `CerberusWardens`: the release on offer, each node's version against it, the running batch
 *   POST /updates           `{ nodes }` → `{ batch, updates: CerberusUpdateView[] }`; the batch starts at once
 *   GET  /updates/:batch    the batch's `CerberusUpdateView[]`, with every step, as the dialog reads it every 2 s
 *
 * Like the rest of the module the answer is the wire shape itself, not wrapped in `{ success, data }`.
 *
 * Consumers: `cerberus.routes.ts`, whose router mounts this one.
 */

function badRequest(message: string): AppError {
  return new AppError(message, { code: 'CERBERUS_BAD_REQUEST', statusCode: 400 });
}

/** The `nodes` of a `POST /updates` body: a list of text, whatever it holds. */
function readNodeNames(request: Request): string[] {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('The body must be a JSON object.');
  const { nodes } = body as Record<string, unknown>;
  if (!Array.isArray(nodes) || !nodes.every((node) => typeof node === 'string')) throw badRequest('nodes must be a list of node names.');
  return nodes as string[];
}

/** Creates the router for `cerberus.routes.ts`. Each handler is one verb and its shape. */
export function createUpdatesRouter(): Router {
  const router = express.Router();

  router.get(
    '/wardens',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(await wardensStatus());
    })
  );

  router.post(
    '/updates',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(await startBatch(readNodeNames(request)));
    })
  );

  router.get(
    '/updates/:batch',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(getBatch(readPathParam(request.params.batch, 'batch')));
    })
  );

  return router;
}
