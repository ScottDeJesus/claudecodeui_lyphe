import express from 'express';
import type { Request, Response, Router } from 'express';

import type { CerberusGatewayState, CerberusReadInputs } from '@/shared/cerberus-types.js';
import { asyncHandler, readPathParam } from '@/shared/utils.js';

import { listCatalog, retireEntry, setAuto, writeEntry } from './catalog.service.js';
import { getDefinition, putDefinition, retireCheck, setLabel } from './definitions.service.js';
import { createDiagnosisRouter } from './diagnosis/diagnosis.routes.js';
import { enrollmentStatus, mintEnrollment } from './enrollments.service.js';
import { createMute, liftMute } from './mutes.service.js';
import { activity } from './read-model/activity.js';
import { checkDetail, checkIndex } from './read-model/check-detail.js';
import { lookupAt } from './read-model/lookup.js';
import { buildOverview } from './read-model/overview.js';
import { getRun, startRun } from './runs.service.js';
import {
  badRequest,
  optionalBoolean,
  optionalText,
  readBody,
  readUsername,
  requiredNumber,
  requiredObject,
  requiredText,
} from './route-input.js';
import { createUpdatesRouter } from './updates.routes.js';

/**
 * Cerberus's twenty-six routes, created by `cerberus.module.ts` for the server entrypoint's one mount
 * at `/api/cerberus` — nineteen here, the three of a warden update in `updates.routes.ts` and the four
 * of a diagnosis in `diagnosis/diagnosis.routes.ts`, both mounted at the end of this router.
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
 * `by` — who muted, who wrote a fix, who switched one's auto-run — is the signed-in user's name,
 * which `authenticateToken` (on the mount) put on the request.
 *
 * A READ is `readInputs()` handed to the read model: the moment, every node's link, the gateway and
 * ingest's memory, gathered once per request by the module, so "now" is one instant for the whole
 * answer.
 */

/** What the module hands its routes: the read model's inputs and the gateway's state, both read live. */
type CerberusRouteDependencies = {
  readInputs: () => CerberusReadInputs;
  gatewayState: () => CerberusGatewayState;
};

const DEFAULT_ACTIVITY_LIMIT = 40;
const MAX_ACTIVITY_LIMIT = 100;

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

  router.get(
    '/catalog',
    asyncHandler(async (_request: Request, response: Response) => {
      response.json(listCatalog());
    })
  );

  router.post(
    '/catalog',
    asyncHandler(async (request: Request, response: Response) => {
      const body = readBody(request);
      const limit = requiredObject(body, 'limit');
      const entry = writeEntry(
        {
          node: requiredText(body, 'node'),
          check: requiredText(body, 'check'),
          name: requiredText(body, 'name'),
          when: requiredText(body, 'when'),
          cmd: requiredText(body, 'cmd'),
          timeout: requiredNumber(body, 'timeout'),
          limit: { runs: requiredNumber(limit, 'runs'), per: requiredNumber(limit, 'per') },
          recheck: optionalBoolean(body, 'recheck'),
          capped: optionalText(body, 'capped'),
        },
        { kind: 'written', by: readUsername(request), at: Date.now() }
      );
      response.json(entry);
    })
  );

  router.put(
    '/catalog/:id/auto',
    asyncHandler(async (request: Request, response: Response) => {
      const on = optionalBoolean(readBody(request), 'on');
      if (on === undefined) throw badRequest('on must be true or false.');
      response.json(setAuto(readPathParam(request.params.id, 'id'), on, readUsername(request)));
    })
  );

  // An entry withdrawn: it leaves every list and the node's next set (404 for an unknown id; one already retired is a 204 that changes nothing).
  router.post(
    '/catalog/:id/retire',
    asyncHandler(async (request: Request, response: Response) => {
      retireEntry(readPathParam(request.params.id, 'id'));
      response.status(204).end();
    })
  );

  router.post(
    '/catalog/:id/run',
    asyncHandler(async (request: Request, response: Response) => {
      const runId = await startRun({ entryId: readPathParam(request.params.id, 'id'), by: 'you' });
      response.json({ runId });
    })
  );

  router.get(
    '/runs/:id',
    asyncHandler(async (request: Request, response: Response) => {
      response.json(getRun(readPathParam(request.params.id, 'id')));
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

  router.use(createUpdatesRouter());
  router.use(createDiagnosisRouter(readInputs));

  return router;
}
