import crypto from 'node:crypto';

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { appConfigDb } from '@/modules/database/index.js';
import { kanbanBoardsService } from '@/modules/kanban/index.js';
import { readClaudeTranscriptBySessionId } from '@/modules/providers/index.js';
import { AppError } from '@/shared/utils.js';

import { deriveMetisSecret } from './metis-env.service.js';
import type { MetisDriver } from './metis-driver.service.js';
import { getLiveMetisRegistry, type MetisRegistry } from './metis-registry.service.js';
import type { MetisSpawner } from './metis-spawn.service.js';

/**
 * The board's Metis door: the five verbs that launch, watch and end a session, and the derived-
 * credential guard the MCP child comes in through.
 *
 * Thin on purpose — parse, call one service, format. Every decision here is about a request and
 * nothing else: what a launch means belongs to the spawner, what a session is belongs to the
 * registry, when a board may be worked on belongs to the driver, and what a transcript is belongs
 * to the providers module. This file is the only place in `kanban-metis` that knows a path.
 */

/** The dependencies this router needs. `kanban-metis.module.ts` hands them over. */
export type KanbanMetisRouteDependencies = {
  registry: MetisRegistry;
  spawner: MetisSpawner;
  driver: MetisDriver;
};

/**
 * The app's JWT signing secret, as both the guard and the child's credential derive from it.
 *
 * ONE reader for both, exported, because the two must agree exactly: the composition root hands a
 * child `HMAC(secret, sessionId)` and this file recomputes the same HMAC on every request, and two
 * copies of this expression would be two secrets the moment either one learned something.
 *
 * The precedence is `auth.middleware.ts:9`'s — an explicit `JWT_SECRET` in the environment wins,
 * the database row is the fallback — so a token minted by the app's own login is checked against
 * the same secret that signed it, and a board child's credential is checked against the same one
 * the server would use to mint it.
 */
export function readAppJwtSecret(): string {
  return process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
}

/** One handler, with its failure path attached once — `AppError`s render from the transport. */
function handle<P extends Record<string, string>>(
  run: (request: Request<P>, response: Response) => Promise<void> | void,
): RequestHandler<P> {
  return (request: Request<P>, response: Response, next: NextFunction) => {
    try {
      const running = run(request, response);
      if (running instanceof Promise) running.catch(next);
    } catch (error) {
      next(error);
    }
  };
}

/**
 * The importer, refused before the router can see it.
 *
 * `POST /api/kanban-pm/import/descent` reads a FOREIGN database — the Descent SQLite file — and
 * rewrites the board from it, four hundred cards in one transaction. No autonomous session has any
 * business calling it: a Metis who decided to "sync" would not be building a card, she would be
 * replacing every card on the board with an older picture of it, and the only reason the operator
 * can do it at all is that he knows which database he is pointing at. His own authenticated mount
 * (`/api/kanban`) still carries the verb; this door does not.
 */
const IMPORT_PATH = /\/import(\/|$)/i;

/**
 * Is this the importer's path, however it is spelled?
 *
 * CASE-INSENSITIVE AND PERCENT-DECODED, because the router behind this guard is both. Express
 * matches routes without regard to case unless `case sensitive routing` is set, so a guard that
 * spelled the path in lowercase only would be a lock on one handle of a door standing open:
 * MEASURED 2026-09-16, `POST /api/kanban-pm/import/descent` was refused 403 while
 * `POST /api/kanban-pm/Import/descent` reached `import.routes.ts:46` and ran. A `%2F` is a `/` to
 * everything downstream of here too, so the test is made on the decoded path.
 */
function isImporterPath(rawPath: string): boolean {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // A stray `%` that is not a valid escape. The raw path is then the only honest string to test.
  }
  return IMPORT_PATH.test(decoded);
}

/**
 * The code that travels with a refusal, so a client keyed on `error.code` reads a credential
 * failure as one. `AUTH_TOKEN_INVALID` is the app's own 401 (`auth.middleware.ts:55`), and this
 * door answers in the same words as the user mount so a caller need not know which door it knocked
 * on to know it was not let in.
 */
function refusalCode(status: number): string {
  return status === 401 ? 'AUTH_TOKEN_INVALID' : 'FORBIDDEN';
}

/** Refuses with one given status and no body a caller could mistake for a board answer. */
function refuse(response: Response, status: number, message: string): void {
  response.status(status).json({ success: false, error: { code: refusalCode(status), message } });
}

/** The bearer a request claims, or `null`. Case-insensitive on the scheme, as HTTP requires. */
function readBearer(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1].trim();
}

/**
 * The `kanban-pm` door: the same board router, behind a credential derived from the session id.
 *
 * THE CREDENTIAL IS `<sessionId>.<HMAC-SHA256(jwt_secret, sessionId)>` and nothing is stored to
 * check it. The child carries it in `KANBAN_PM_TOKEN` (written into its own MCP config by
 * `metis-env.service.ts`), the guard recomputes the HMAC for the id the bearer claims, and the
 * registry's `running` set is the only thing that can revoke it — so a server that restarted
 * mid-build accepts a live Metis's next tool call, and a session that has ended stops being
 * accepted, both without a byte of state kept between the two.
 *
 * A user's session token is NOT accepted here and cannot be: it has three dot-separated parts
 * where this has exactly one, so it fails the split before an HMAC is ever computed. That is what
 * keeps the operator's own JWT — which the chat sends to `/api/kanban` — from quietly working on
 * the autonomous door as well.
 */
export function kanbanMetisSecretGuard(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (isImporterPath(request.path)) {
    refuse(response, 403, 'The descent importer is not reachable from the kanban-pm door.');
    return;
  }

  const bearer = readBearer(request);
  if (bearer === null) {
    refuse(response, 401, 'A kanban-pm request must carry its session credential.');
    return;
  }
  const parts = bearer.split('.');
  if (parts.length !== 2) {
    refuse(response, 401, 'A kanban-pm request must carry its session credential.');
    return;
  }
  const [sessionId, proof] = parts;

  const registry = getLiveMetisRegistry();
  // No module composed yet, or a session that has ended: the same answer, deliberately. A guard
  // that told those two apart would be describing the server's boot order to an unauthenticated
  // caller.
  if (registry === null || !registry.isRunning(sessionId)) {
    refuse(response, 401, 'No such running Metis session.');
    return;
  }

  const expected = deriveMetisSecret(readAppJwtSecret(), sessionId);
  const given = Buffer.from(proof, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  // Constant-time, and length-checked first because `timingSafeEqual` throws on a length mismatch —
  // and the check itself leaks nothing, a hex HMAC of a known length being the only shape accepted.
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    refuse(response, 401, 'Invalid Metis session credential.');
    return;
  }

  next();
}

/**
 * The driver's routes, mounted at `/api/kanban-metis` behind `authenticateToken`.
 *
 * Every one of them answers with the session it touched, and the transcript with the same
 * `SubagentTranscriptResult` the operator's own subagent reads return — a Metis's transcript is
 * read by the panel the chat already has, not by a second one built here.
 */
export function createKanbanMetisRouter(dependencies: KanbanMetisRouteDependencies): Router {
  const { registry, spawner, driver } = dependencies;
  const router = express.Router();

  router.get(
    '/sessions',
    handle((_request: Request, response: Response) => {
      response.json({ sessions: registry.list(), at: Date.now() });
    }),
  );

  /**
   * Why this board is or is not being worked on, in the driver's own numbers.
   *
   * The tick's decision is four dials and one timestamp, and every one of them is answered here:
   * autonomy (the board's governor), concurrency (how many sessions it may run), live (how many it
   * has), claimable (how much work is waiting) and lastSpawnAt (how recently the cooldown was
   * stamped). Without this, an operator watching a quiet board cannot tell "nothing to do" from
   * "the driver is not running" from "the cooldown is holding it" — the three have the same
   * outward behaviour and completely different fixes.
   *
   * The board is read here because a missing one is a 404 and that is a transport fact; the
   * arithmetic over it belongs to the driver.
   */
  router.get(
    '/boards/:boardId/driver',
    handle<{ boardId: string }>((request, response) => {
      const board = kanbanBoardsService.getBoard(request.params.boardId);
      if (board === null) {
        throw new AppError(`No kanban board with id "${request.params.boardId}".`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      }
      const reading = driver.reading(board);
      response.json({
        autonomy: reading.autonomy,
        concurrency: reading.concurrency,
        claimable: reading.claimable,
        live: reading.live,
        lastSpawnAt: reading.lastSpawnAt,
      });
    }),
  );

  router.post(
    '/boards/:boardId/launch',
    handle<{ boardId: string }>(async (request, response) => {
      // `operator`, because the only thing that reaches this route is an authenticated human —
      // the driver does not go through its own HTTP door, it calls the spawner in-process.
      const session = await spawner.launch({
        boardId: request.params.boardId,
        launchedBy: 'operator',
      });
      response.status(201).json({ session });
    }),
  );

  router.post(
    '/sessions/:sessionId/stop',
    handle<{ sessionId: string }>((request, response) => {
      response.json({ session: spawner.stop(request.params.sessionId) });
    }),
  );

  router.post(
    '/sessions/:sessionId/resume',
    handle<{ sessionId: string }>(async (request, response) => {
      response.json({ session: await spawner.resume(request.params.sessionId) });
    }),
  );

  /**
   * One session's transcript, and the one route here with no service of its own.
   *
   * The board MINTS the session id, so there is no launch-to-session translation to perform: the
   * identity is the whole mapping. Knowing the id is the authorization — the registry has to have
   * recorded it — and the read itself belongs to the providers module.
   *
   * `readClaudeTranscriptBySessionId` falls back to `scanProjectsRoot` when the sessions table
   * holds no row (`claude-transcript-activity.ts:190-197`). A board Metis having no row is not an
   * edge case here, it is the ONLY case: her cwd is under `~/.claude/kanban-metis`, and the
   * synchronizer refuses to register such a transcript as a project session at all. So the fallback
   * path is the ordinary path, and this route is the only reader that takes it.
   */
  router.get(
    '/sessions/:sessionId/transcript',
    handle<{ sessionId: string }>(async (request, response) => {
      const sessionId = request.params.sessionId;
      if (registry.get(sessionId) === null) {
        throw new AppError(`No Metis session with id "${sessionId}".`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      }
      response.json(await readClaudeTranscriptBySessionId(sessionId));
    }),
  );

  return router;
}
