import express from 'express';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';

import { asyncHandler, readAuthenticatedUserId } from '@/shared/utils.js';

import type { CompanionService } from '../companion.service.js';

/**
 * The station's needs routes, mounted by `createCompanionRoutes` at `/api/companion/station` behind `authenticateToken`.
 * ONLY TRANSPORT: each route reads who is asking (the account whose follow-ups the list holds), checks the shape of what came, calls
 * one service verb and answers.
 *
 *   - `GET /needs` answers `{ needs, faults }`: everything that needs him in his order (`StationNeed[]`) and the kinds that could
 *     not be read, which the page says in words and never reads as "nothing waits". A read that throws as a whole (the house was not
 *     attached) is logged and answered 503 `{ error }` with a sentence the page's banner can show;
 *   - `POST /asks` takes `{ sessionId, requestId, answer }` (the ask to settle and his word for it) and answers 200 `{ told }`, the
 *     sentence that says what was done; 400 `{ error }` when the word is no answer to that ask (the sentence says what is);
 *     409 `{ error }` when the ask is no longer waiting. A body that is not that shape is a 400 naming the first field that is wrong.
 *     Only a chat's ask is answered here: an Accept and a round are answered on the dispatcher's own card.
 *
 * No `x-companion-client`: the list and the answer are no page's. The page reads the list again on each of its events
 * (`StationNeedsContext`). Consumed by `companion.routes.ts`.
 */

/** The longest request id or session id the route takes: a gateway id is a UUID, so this only bounds what a stranger could make it hold. */
const ID_MAX = 200;

/** The longest word the route takes for an ask: `answer_session`'s own bound for a free answer. */
const ANSWER_MAX = 2_000;

/** The body of `POST /asks` (`StationAskAnswer`). The answer is trimmed, as `answer_session` trims hers. */
const askAnswerBody = z.object({
  sessionId: z.string().min(1).max(ID_MAX),
  requestId: z.string().min(1).max(ID_MAX),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});

/** The sentence that names the first field of a body that failed the shape, for the 400. */
function firstProblem(error: z.ZodError): string {
  const [issue] = error.issues;
  const field = issue.path.join('.');
  return field === '' ? 'The body must be an object with sessionId, requestId and answer.' : `${field}: ${issue.message}`;
}

/** Consumed by `companion.routes.ts`, which hands it the service. */
export function createNeedsRoutes(service: CompanionService): Router {
  const router = express.Router();

  router.get(
    '/needs',
    asyncHandler(async (request: Request, response: Response) => {
      // Outside the try: who is asking is the app's own 401, not a read that failed.
      const userId = readAuthenticatedUserId(request);
      try {
        response.json(await service.stationNeeds(userId));
      } catch (error) {
        console.error('[Station] what needs him could not be read', error);
        response.status(503).json({ error: 'What needs you could not be read just now.' });
      }
    }),
  );

  router.post(
    '/asks',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const body = askAnswerBody.safeParse(request.body);
      if (!body.success) {
        response.status(400).json({ error: firstProblem(body.error) });
        return;
      }
      try {
        const outcome = await service.answerStationAsk(userId, body.data);
        if (outcome.ok) response.json({ told: outcome.told });
        else response.status(outcome.status).json({ error: outcome.sentence });
      } catch (error) {
        // The ask is still waiting: a failed rule write comes before the answer, so the call can simply be made again.
        console.error('[Station] an ask could not be answered', error);
        response.status(500).json({ error: 'The answer could not be sent just now; the ask is still waiting.' });
      }
    }),
  );

  return router;
}
