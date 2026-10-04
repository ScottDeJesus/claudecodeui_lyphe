/**
 * The six routes of `/api/claude-updates`.
 *
 * They parse, call and format, and nothing else. A report is one call and one `json`, a check is that
 * call awaited, the two actions are the body's SHAPE plus the service's answer — whose refusal
 * already carries the status this route sends — and the automatic-install switch is a read and a
 * write of one boolean. Everything behind them — the reading, the cadence, the
 * job file, the runner, the journal lines — belongs to the services; a route that reached for a file
 * or a subprocess would be a second place that knows how an update works.
 */

import express from 'express';

import type {
  ClaudeAutoInstall,
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
  /** The automatic-install switch, and what an update on offer is waiting for. */
  readAutoInstall: () => Promise<ClaudeAutoInstall>;
  /** Writes the automatic-install switch. */
  setAutoInstall: (enabled: boolean) => void;
};

/** The one refusal this file owns: a body that is not a request at all never reaches a service, so
 *  the sentence says what a request looks like rather than which version moved. */
const BAD_REQUEST: ClaudeUpdateRefusal = {
  error: 'bad-request',
  message: 'the request must carry a targets object naming cli, sdk, or both',
};

/** The other refusal this file owns, for the switch's write: a body without a boolean `enabled`. */
const BAD_AUTO_INSTALL_REQUEST: ClaudeUpdateRefusal = {
  error: 'bad-request',
  message: 'the request must carry { "enabled": true } or { "enabled": false }',
};

/** The switch's position out of a request body, or null when the body does not carry one. A string
 *  "false" is not a position — only a real boolean is, so a mistyped client is refused, not obeyed. */
function readEnabledFlag(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null) return null;
  const enabled = (body as { enabled?: unknown }).enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

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

  // Both answer the same block the report carries, so a client that just flipped the switch reads the
  // position back from the server's own mouth, `waiting` included.
  router.get('/auto-install', async (_request, response, next) => {
    try {
      response.json(await routes.readAutoInstall());
    } catch (error) {
      next(error);
    }
  });

  router.put('/auto-install', async (request, response, next) => {
    try {
      const enabled = readEnabledFlag(request.body);
      if (enabled === null) {
        response.status(400).json(BAD_AUTO_INSTALL_REQUEST);
        return;
      }
      routes.setAutoInstall(enabled);
      response.json(await routes.readAutoInstall());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
