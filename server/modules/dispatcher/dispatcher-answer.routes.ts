import express from 'express';

import type { DispatcherAsk, DispatcherCardAnswer, ProviderPermissionDecision } from '@/shared/types.js';

import { askingSince } from './dispatcher-ask.reader.js';

/**
 * The card's door: `POST /answer`, mounted on the lane's own router (`dispatcher.module.ts`) so the
 * path is `/api/dispatcher/answer`, behind the mount's `authenticateToken` (`server/index.ts`).
 *
 * THE CARD SENDS THE ASK BACK EXACTLY AS IT DREW IT — the `asking` record of the `dispatcher_state`
 * frame the plan card and the Runner widget render — with the operator's word by question. This route
 * reads and validates that body and does nothing else: the ask's NAME, the lookup in the book, the
 * carry to the dispatcher and the outcome all belong to the asks service
 * (`dispatcher-asks.service.ts`), whose `answer` this router is handed.
 *
 * THAT DIVISION IS THE POINT. The ask becomes an argv word only after the service has derived its own
 * name from it (`keyOf`) and found ITS OWN record of that name, so a census the card never drew is
 * never approved and nothing the request carries is trusted. What a status can say here is only which
 * kind of "no" the lane answered with, and the body is the lane's own sentence either way — the
 * dispatcher's first line when it heard the answer, and this lane's when it never reached it.
 */

export type DispatcherAnswerRouterDependencies = {
  /** The card's door in the asks service, which owns the naming, the lookup and the carry. */
  answer: (ask: DispatcherAsk, decision: ProviderPermissionDecision) => Promise<DispatcherCardAnswer>;
};

/**
 * The status each outcome answers with.
 *
 * `took` is the only success. The three a carried answer can be answered with — the dispatcher
 * refused the word, it had approved the plan already, or no open ask carries the name the card's ask
 * derives — are CONFLICTS, exactly as every relayed verb's refusal is: nothing was carried, nothing
 * broke, and the sentence in the body is the dispatcher's own. `no-answer` is a 400 because the
 * REQUEST is what was wrong (the decision named no option the prompt offered), and `unread` a 503
 * because the fault is this server's: the store could not be read, so the lane never got to ask.
 */
const STATUS_OF: Record<DispatcherCardAnswer['outcome'], number> = {
  took: 200,
  'already-answered': 409,
  refused: 409,
  'not-open': 409,
  'no-answer': 400,
  unread: 503,
};

/**
 * A question-text → string map as the card sends one — `answers`, and a Rework's `notes` — or `null`
 * when the value is not one. EVERY value must be a string: both maps become the decision's
 * `updatedInput` verbatim and are read back by question (`dispatcher-answer.service.ts:readReply`),
 * so a value of any other type is a request this door has no answer for rather than something to
 * coerce into one.
 */
function readTextMap(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const map: Record<string, string> = {};
  for (const [question, answer] of Object.entries(value)) {
    if (typeof answer !== 'string') return null;
    map[question] = answer;
  }
  return map;
}

// Used by `dispatcher.module.ts`, which mounts it on the lane's router.
export function createDispatcherAnswerRouter(dependencies: DispatcherAnswerRouterDependencies): express.Router {
  const router = express.Router();

  router.post('/answer', async (request, response, next) => {
    const body = (request.body ?? {}) as { ask?: unknown; answers?: unknown; notes?: unknown };
    let ask: DispatcherAsk | null;
    try {
      // The document's own reader for a plan's `asking` key: an ask that does not read is a DIFFERENT
      // BUILD's prompt, and the reader names the field it refused. `null` is the key absent, which is
      // no ask at all — a different refusal, and both are this request's own fault.
      ask = askingSince(body.ask, 'answer.ask');
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (ask === null) {
      response.status(400).json({ error: 'ask is required' });
      return;
    }

    const answers = readTextMap(body.answers);
    if (answers === null) {
      response.status(400).json({ error: 'answers must be an object of strings, by question' });
      return;
    }
    let notes: Record<string, string> | null = null;
    if (body.notes !== undefined) {
      notes = readTextMap(body.notes);
      if (notes === null) {
        response.status(400).json({ error: 'notes must be an object of strings, by question' });
        return;
      }
    }

    // The one shape every door of this lane answers in: the card's and the phone's.
    const decision: ProviderPermissionDecision = {
      allow: true,
      updatedInput: { answers, ...(notes === null ? {} : { notes }) },
    };

    try {
      // The service never throws: whatever the dispatcher did, or failed to do, comes back as one of
      // the six outcomes. A throw out of it is a fault this lane has no word for, and it goes to the
      // app's error handler like any other route's.
      const reply = await dependencies.answer(ask, decision);
      response.status(STATUS_OF[reply.outcome]).json(reply);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
