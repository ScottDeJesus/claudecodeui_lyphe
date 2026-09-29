/**
 * The four routes of `/api/claude-updates`.
 *
 * They parse, call and format, and nothing else. A report is one call and one `json`, a check is that
 * call awaited, and the two actions are the body's SHAPE plus the service's answer — whose refusal
 * already carries the status this route sends. Everything behind them — the reading, the cadence, the
 * job file, the runner, the journal lines — belongs to the services; a route that reached for a file
 * or a subprocess would be a second place that knows how an update works.
 */

import express from 'express';

import type {
  ClaudeUpdatePackageKey,
  ClaudeUpdatesReport,
  ClaudeUpdateRefusal,
} from '@/shared/claude-update-types.js';

import type { UpdateActionResult } from './update-actions.service.js';

/** What the routes call. Every one of these is answered by a service that owns the decision. */
type ClaudeUpdatesRoutes = {
  /** The report, with the current job and the tail of its log already read into it. */
  report: () => Promise<ClaudeUpdatesReport>;
  /** Runs one check — joining any already in flight — and resolves when it is done. Never rejects. */
  checkNow: () => Promise<void>;
  /** Starts the job the targets name, or says why not. */
  applyUpdate: (targets: Partial<Record<ClaudeUpdatePackageKey, string>>) => Promise<UpdateActionResult>;
  /** Asks the supervisor to boot this server's code again. */
  restartServer: () => Promise<UpdateActionResult>;
};

/** The one refusal this file owns: a body that is not a request at all never reaches a service, so
 *  the sentence says what a request looks like rather than which version moved. */
const BAD_REQUEST: ClaudeUpdateRefusal = {
  error: 'bad-request',
  message: 'the request must carry a targets object naming cli, sdk, or both',
};

/** The targets out of a request body, or null when the body is not that shape. Only the SHAPE is
 *  read here — which keys may be in it, and whether their values are versions, is the service's. */
function readTargets(body: unknown): Partial<Record<ClaudeUpdatePackageKey, string>> | null {
  if (typeof body !== 'object' || body === null) return null;
  const targets = (body as { targets?: unknown }).targets;
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) return null;
  return targets as Partial<Record<ClaudeUpdatePackageKey, string>>;
}

export function createClaudeUpdatesRouter(routes: ClaudeUpdatesRoutes): express.Router {
  const router = express.Router();

  router.get('/', async (_request, response, next) => {
    try {
      response.json(await routes.report());
    } catch (error) {
      next(error);
    }
  });

  router.post('/check', async (_request, response, next) => {
    try {
      await routes.checkNow();
      response.json(await routes.report());
    } catch (error) {
      next(error);
    }
  });

  // 202, not 200: a job has been started, not finished. The report that comes back is the answer to
  // "what is happening", which is exactly what the tab polls from here on.
  router.post('/apply', async (request, response, next) => {
    try {
      const targets = readTargets(request.body);
      if (targets === null) {
        response.status(400).json(BAD_REQUEST);
        return;
      }

      const result = await routes.applyUpdate(targets);
      if (!result.ok) {
        response.status(result.status).json(result.refusal);
        return;
      }
      response.status(202).json(await routes.report());
    } catch (error) {
      next(error);
    }
  });

  // What a reboot request's answer can be is `requested`, and nothing more: the process that would
  // tell the caller more is the one being replaced, and the answer comes back as a report from
  // whichever server holds the port next.
  router.post('/restart', async (_request, response, next) => {
    try {
      const result = await routes.restartServer();
      if (!result.ok) {
        response.status(result.status).json(result.refusal);
        return;
      }
      response.status(202).json({ requested: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
