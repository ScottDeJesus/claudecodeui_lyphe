import express from 'express';
import type { Request } from 'express';

import { requestSourceOf } from '@/shared/request-source.js';

import type { BootReportContext, BootReportService } from './boot-report.service.js';

/** A report is a few kilobytes of what one page saw; the page caps itself at 12, so a body past 16 is not one of ours. */
const BODY_LIMIT = '16kb';

function contextOf(request: Request): BootReportContext {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  return { ...requestSourceOf(request.headers, request.socket.remoteAddress), token: bearer };
}

/**
 * Creates the public boot-report router for `boot-report.module.ts`.
 *
 * `POST /` takes the JSON a page that did not draw sends (`fetch` with keepalive, or `sendBeacon`, which posts the same
 * body as a Blob) and answers 204: the sender cannot act on an answer and never waits for one. 429 only when a rate cap
 * refused it, 400 for a body that is not a JSON object naming a `kind` (the parser hands a POST it skipped to this route as `{}`).
 * Nothing here reads the token; the service names the account from it.
 */
export function createBootReportRouter(service: BootReportService): express.Router {
  const router = express.Router();

  router.post(
    '/',
    // Its own parser at a small limit: the entrypoint mounts this router ABOVE the 50 MB one, so a public door never reads a body that size.
    express.json({ limit: BODY_LIMIT, type: ['application/json', 'text/plain'] }),
    (request, response, next) => {
      try {
        const outcome = service.accept(request.body, contextOf(request));
        if (outcome === 'unreadable') return response.status(400).end();
        return response.status(outcome === 'rate-limited' ? 429 : 204).end();
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}
