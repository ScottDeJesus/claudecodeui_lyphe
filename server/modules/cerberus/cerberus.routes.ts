import express from 'express';
import type { Request, Response, Router } from 'express';

import type { CerberusGatewayState, CerberusReadInputs } from '@/shared/cerberus-types.js';
import { AppError, asyncHandler, readPathParam } from '@/shared/utils.js';

import { getDefinition, putDefinition, retireCheck, setLabel } from './definitions.service.js';
import { enrollmentStatus, mintEnrollment } from './enrollments.service.js';
import { createMute, liftMute } from './mutes.service.js';
import { activity } from './read-model/activity.js';
import { checkDetail, checkIndex } from './read-model/check-detail.js';
import { lookupAt } from './read-model/lookup.js';
import { buildOverview } from './read-model/overview.js';

/**
 * Cerberus's thirteen routes, created by `cerberus.module.ts` for the server entrypoint's one mount
 * at `/api/cerberus`.
 *
 * WHAT A ROUTE DECIDES HERE. Transport SHAPE only: that a field is the kind of value the verb takes
 * (text, a number of milliseconds), and which path parts make up a check's key. Whether a time is in
 * range, a name is in the grammar or a check exists is the service's refusal, so each handler is
 * read, call one verb, answer. A shape that is wrong is a 400 `CERBERUS_BAD_REQUEST`.
 *
 * THE ANSWER IS THE WIRE SHAPE ITSELF — `CerberusOverview`, `CerberusMute`, `CerberusLookup` — not
 * wrapped in the app's `{ success, data }` envelope, which the contract (`cerberus-types.ts`) does not
 * carry; a write that has nothing to say is a bare 204. Refusals are the app's own envelope: every
 * failure is an `AppError` with a `CERBERUS_` code, which the entrypoint's error middleware turns into
 * `{ success: false, error: { code, message, details } }`.
 *
 * `by` — who muted — is the signed-in user's name, which `authenticateToken` (on the mount) put on
 * the request.
 *
 * A READ is `readInputs()` handed to the read model: the moment, every node's link, the gateway and
 * ingest's memory, gathered once per request by the module, so "now" is one instant for the whole
 * answer.
 */

type AuthenticatedRequest = Request & { user?: { username?: string } };

/** What the module hands its routes: the read model's inputs and the gateway's state, both read live. */
type CerberusRouteDependencies = {
  readInputs: () => CerberusReadInputs;
  gatewayState: () => CerberusGatewayState;
};

const DEFAULT_ACTIVITY_LIMIT = 40;
const MAX_ACTIVITY_LIMIT = 100;

function badRequest(message: string): AppError {
  return new AppError(message, { code: 'CERBERUS_BAD_REQUEST', statusCode: 400 });
}

/** The JSON object a write carries. */
function readBody(request: Request): Record<string, unknown> {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw badRequest('The body must be a JSON object.');
  return body as Record<string, unknown>;
}

/** A text field that must be there (the empty string counts as there). */
function requiredText(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

/** A text field that may be absent or null; present, it must be text. */
function optionalText(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  return value;
}

/** A moment or count in a query string: whole digits, or absent. */
function optionalWholeNumber(request: Request, name: string): number | undefined {
  const value = request.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^-?\d{1,16}$/.test(value)) throw badRequest(`${name} must be a whole number.`);
  return Number(value);
}

/** The key of a check named by the three path parts `:service/:check` — `<service>/<id>`. */
function readCheckKey(request: Request): string {
  return `${readPathParam(request.params.service, 'service')}/${readPathParam(request.params.check, 'check')}`;
}

function readUsername(request: Request): string {
  const username = (request as AuthenticatedRequest).user?.username;
  if (typeof username !== 'string' || username === '') {
    throw new AppError('Authenticated user is required.', { code: 'CERBERUS_USER_REQUIRED', statusCode: 401 });
  }
  return username;
}

/** Creates the router for `cerberus.module.ts`. Each handler is one verb and its shape. */
export function createCerberusRouter({ readInputs, gatewayState }: CerberusRouteDependencies): Router {
  const router = express.Router();

  router.get(
    '/overview',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(buildOverview(readInputs()));
    })
  );

  router.get(
    '/checks',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(checkIndex());
    })
  );

  router.get(
    '/checks/:node/:service/:check',
    asyncHandler(async (request: Request, response: Response) => {
      const node = readPathParam(request.params.node, 'node');
      const lookup = optionalWholeNumber(request, 'lookup');
      const end = optionalWholeNumber(request, 'end');
      response.json(checkDetail(node, readCheckKey(request), { lookupAt: lookup, end }, readInputs()));
    })
  );

  router.get(
    '/lookup',
    asyncHandler(async (request: Request, response: Response) => {
      const { node, key } = request.query;
      const at = optionalWholeNumber(request, 'at');
      if (typeof node !== 'string' || typeof key !== 'string' || at === undefined) {
        throw badRequest('node, key and at are all needed.');
      }
      response.json(lookupAt(node, key, at, readInputs()));
    })
  );

  router.get(
    '/activity',
    asyncHandler(async (request: Request, response: Response) => {
      const inputs = readInputs();
      // `before` is exclusive; one past now includes what happened this very millisecond.
      const before = optionalWholeNumber(request, 'before') ?? inputs.now + 1;
      const limit = optionalWholeNumber(request, 'limit') ?? DEFAULT_ACTIVITY_LIMIT;
      response.json(activity({ before, limit: Math.min(MAX_ACTIVITY_LIMIT, limit) }, inputs));
    })
  );

  router.post(
    '/mutes',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      if (typeof body.until !== 'number') throw badRequest('until must be a number of milliseconds.');
      const mute = createMute(
        {
          node: requiredText(body, 'node'),
          key: requiredText(body, 'key'),
          until: body.until,
          reason: optionalText(body, 'reason') ?? '',
        },
        readUsername(request)
      );
      response.json(mute);
    })
  );

  router.post(
    '/mutes/:id/lift',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(liftMute(readPathParam(request.params.id, 'id')));
    })
  );

  router.put(
    '/labels',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      setLabel({
        node: requiredText(body, 'node'),
        key: optionalText(body, 'key'),
        service: optionalText(body, 'service'),
        label: requiredText(body, 'label'),
      });
      response.status(204).end();
    })
  );

  router.post(
    '/enrollments',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      response.json(mintEnrollment({ name: requiredText(body, 'name'), desc: optionalText(body, 'desc') }, gatewayState()));
    })
  );

  router.get(
    '/enrollments/:name',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(enrollmentStatus(readPathParam(request.params.name, 'name')));
    })
  );

  router.get(
    '/definitions/:node',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(getDefinition(readPathParam(request.params.node, 'node')));
    })
  );

  router.put(
    '/definitions/:node',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(putDefinition(readPathParam(request.params.node, 'node'), request.body));
    })
  );

  router.delete(
    '/checks/:node/:service/:check',
    asyncHandler(async (request: Request, response: Response) => {
      retireCheck(readPathParam(request.params.node, 'node'), readCheckKey(request));
      response.status(204).end();
    })
  );

  return router;
}
