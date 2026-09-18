import express from 'express';
import type { NextFunction, Response } from 'express';

import type { MemoryCandidateFull, MemoryCandidateRead, MemoryPending } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

// Imported from its own home rather than through the service's re-export: the routes catch this
// class, and a catch that names a second door to it would be a catch that survives its removal.
import { MemoryRefusal } from './memory-assert.js';
import { memoryNotFound, type MemoryIntakeService } from './memory.service.js';

/**
 * The memory-intake lane's four routes: the two reads the Memory tab polls, and the two writes a
 * person's click performs.
 *
 * THE `{ reachable }` ENVELOPE IS KEPT because the client is built on it — the same ruling the
 * accounts lane carries. It is a fact about the read rather than about a remote server: every answer
 * this module can compute is `reachable: true`, and there is no upstream here to be unreachable. The
 * envelope survives because the panel, the tab gates and the command palette all branch on it, and a
 * shape change would be a client change this phase does not own.
 *
 * A MALFORMED ID NEVER REACHES THE SERVICE. `/^[A-Za-z0-9_-]{1,64}$/` admits no dot, no slash and no
 * percent, so a traversal attempt is refused at the route as a 422 — for the writes as well as for
 * the read, and identically on every mount this router is used behind.
 *
 * A WRITE'S VERDICT IS ITS OWN BODY. The client reads a refusal out of `error` as a STRING — the cap
 * guard's plain English, which is the most useful thing a reviewer can be told and the reason the
 * candidate stays pending — so both failures answer `{ error: "<words>" }` rather than the global
 * handler's `{ success: false, error: { code, message } }`, whose nested shape the reader would drop
 * on the floor. Success answers `{ candidate }`, which is the fresh row the panel re-renders from.
 *
 * NOTHING IN THIS FILE KNOWS ABOUT A BOARD. It is mounted at `/api/memory` and nowhere else, so the
 * `kanban-pm` mount a Metis can reach cannot see it, by construction rather than by a refusal list.
 */

/**
 * What a candidate's id may look like — the same fence the Descent proxy wrote, kept verbatim so the
 * ids a session has already seen keep working. Narrower than "any path segment" on purpose.
 */
const MEMORY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The index read's ceiling, matching the service's own default. */
const MEMORY_LIST_LIMIT = 100;

/** One status word: the review queue, or the filed memories — anything else reads the queue. */
function listStatus(value: unknown): 'pending' | 'approved' {
  return value === 'approved' ? 'approved' : 'pending';
}

/**
 * Run one review write and answer with its verdict.
 *
 * Three outcomes and no fourth: a candidate (200), no row under that id (404), or a refusal the
 * person can act on (422 — either the row was already reviewed, or the size guard said no). Anything
 * else is a genuine fault and belongs to `next`, which is the only place that decides what an
 * unexpected error means.
 */
function sendReviewWrite(
  response: Response,
  next: NextFunction,
  candidateId: string,
  run: () => MemoryCandidateFull | null
): void {
  try {
    const candidate = run();
    if (candidate === null) {
      const missing = memoryNotFound(candidateId);
      response.status(missing.statusCode).json({ error: missing.message });
      return;
    }
    response.json({ candidate });
  } catch (error) {
    if (error instanceof MemoryRefusal) {
      response.status(422).json({ error: error.message });
      return;
    }
    if (error instanceof AppError && error.statusCode < 500) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
}

/**
 * Creates the lane's router for `memory-intake.module.ts`, which the server entrypoint mounts.
 *
 * The reads answer 200 whatever the database says — an empty queue is an answer, and a read never
 * fails — and each handler is one service verb plus its shape.
 */
export function createMemoryRoutes(service: MemoryIntakeService): express.Router {
  const router = express.Router();

  router.get('/', (request, response, next) => {
    try {
      const candidates = service.list({
        status: listStatus(request.query.status),
        limit: MEMORY_LIST_LIMIT,
      });
      response.json({ reachable: true, candidates } satisfies MemoryPending);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:candidateId', (request, response, next) => {
    const { candidateId } = request.params;
    if (!MEMORY_ID.test(candidateId)) {
      response.status(422).json({ error: 'id is malformed' });
      return;
    }
    try {
      // `candidate: null` is an ANSWER, not an error: it means one thing — no row carries that id —
      // and the screen draws "no longer there" rather than an error wall. A card already reviewed
      // still reads whole, its `status` saying which.
      const candidate = service.get(candidateId);
      response.json({ reachable: true, candidate } satisfies MemoryCandidateRead);
    } catch (error) {
      next(error);
    }
  });

  router.post('/:candidateId/approve', (request, response, next) => {
    const { candidateId } = request.params;
    if (!MEMORY_ID.test(candidateId)) {
      response.status(422).json({ error: 'id is malformed' });
      return;
    }
    // Validated at the door, then written to disk last — a refusal leaves the candidate pending with
    // its words recorded, so the person can trim it and press again.
    sendReviewWrite(response, next, candidateId, () => service.approve(candidateId));
  });

  router.post('/:candidateId/reject', (request, response, next) => {
    const { candidateId } = request.params;
    if (!MEMORY_ID.test(candidateId)) {
      response.status(422).json({ error: 'id is malformed' });
      return;
    }
    // Nothing is written to any target by a rejection; the row is the whole of it.
    sendReviewWrite(response, next, candidateId, () => service.reject(candidateId));
  });

  return router;
}
