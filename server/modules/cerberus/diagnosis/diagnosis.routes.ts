import express from 'express';
import type { Request, Response, Router } from 'express';

import type { CerberusReadInputs } from '@/shared/cerberus-types.js';
import { asyncHandler, readPathParam } from '@/shared/utils.js';

import { badRequest, optionalText, readBody, readUsername, requiredNumber, requiredObject, requiredText } from '../route-input.js';
import { startRun } from '../runs.service.js';

import { promoteDiagnosis } from './diagnosis-promotion.js';
import { getDiagnosis, startDiagnosis } from './diagnosis.service.js';

/**
 * The four routes of a diagnosis, mounted by `cerberus.routes.ts` under `/api/cerberus`: what a route
 * decides here is transport SHAPE only — that a field is text, a number, a true/false — and every
 * refusal worth the name (no such check, a diagnosis already running, no proposal, a lapsed one-off, a
 * limit that is not offered) is the service's, in the app's `{ success: false, error }` envelope.
 *
 *   POST /diagnoses               `{ node, check, model? }` → `{ id }`; the diagnosis runs on in the background
 *   GET  /diagnoses/:id           `CerberusDiagnosisView`, with every step and its run's lines
 *   POST /diagnoses/:id/run       "Run it once": → `{ runId }`; 409 with no proposal, or once its one-off has lapsed
 *   POST /diagnoses/:id/promote   `{ name, auto, limit: { runs, per: 3600 } }` → `CerberusCatalogEntryView`
 *
 * Like the rest of the module the answer is the wire shape itself, not wrapped in `{ success, data }`.
 * Running a proposal once never touches the catalog; promoting it is the only route that does.
 *
 * Consumers: `cerberus.routes.ts`, whose router mounts this one.
 */

/** A true/false field that must be there. */
function requiredBoolean(source: Record<string, unknown>, field: string): boolean {
  const value = source[field];
  if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false.`);
  return value;
}

/** Creates the router for `cerberus.routes.ts`. `readInputs` is the module's: one instant, the links, ingest's memory. */
export function createDiagnosisRouter(readInputs: () => CerberusReadInputs): Router {
  const router = express.Router();

  router.post(
    '/diagnoses',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      const id = startDiagnosis(
        {
          node: requiredText(body, 'node'),
          check: requiredText(body, 'check'),
          model: optionalText(body, 'model'),
          askedBy: readUsername(request),
        },
        readInputs()
      );
      response.json({ id });
    })
  );

  router.get(
    '/diagnoses/:id',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(getDiagnosis(readPathParam(request.params.id, 'id')));
    })
  );

  router.post(
    '/diagnoses/:id/run',
    asyncHandler(async (request: Request, response: Response) => {
      const runId = await startRun({ diagnosisId: readPathParam(request.params.id, 'id'), by: 'you' });
      response.json({ runId });
    })
  );

  router.post(
    '/diagnoses/:id/promote',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      const limit = requiredObject(body, 'limit');
      const entry = promoteDiagnosis(
        readPathParam(request.params.id, 'id'),
        {
          name: requiredText(body, 'name'),
          auto: requiredBoolean(body, 'auto'),
          limit: { runs: requiredNumber(limit, 'runs'), per: requiredNumber(limit, 'per') },
        },
        readUsername(request)
      );
      response.json(entry);
    })
  );

  return router;
}
