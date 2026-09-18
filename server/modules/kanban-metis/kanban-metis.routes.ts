import crypto from 'node:crypto';

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';

import { appConfigDb } from '@/modules/database/index.js';
import { kanbanBoardsService } from '@/modules/kanban/index.js';
import { readClaudeTranscriptBySessionId } from '@/modules/providers/index.js';
import { KANBAN_CONCURRENCY_MAX } from '@/shared/kanban-types.js';
import { AppError } from '@/shared/utils.js';

import { deriveMetisSecret } from './metis-env.service.js';
import type { MetisDriver } from './metis-driver.service.js';
import { getLiveMetisRegistry, type MetisRegistry } from './metis-registry.service.js';
import type { MetisSpawner } from './metis-spawn.service.js';

/**
 * The board's Metis door: the routes that launch, watch, end and answer a session, and the derived-
 * credential guard the MCP child comes in through.
 *
 * Thin on purpose — parse, call one service, format. Every decision here is about a request and
 * nothing else: what a launch means belongs to the spawner, what a session is belongs to the
 * registry, when a board may be worked on belongs to the driver and to the board's own dial, and
 * what a transcript is belongs to the providers module. This file is the only place in
 * `kanban-metis` that knows a path.
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
 * The lesson REVIEW, refused on the same terms — and this is the fence that actually matters.
 *
 * The lesson lifecycle has two ends with opposite actors: a Metis STAGES a note about what she
 * learned, and a PERSON decides whether it reaches the corpus future sessions read. Not shipping
 * an MCP tool for the review is not a fence — the board's router is mounted a second time at
 * `/api/kanban-pm`, and every live Metis holds a derived credential that opens it. So a review
 * request that arrives on the child's door is refused at the door, before any handler sees it.
 *
 * Staging and reading are untouched: `POST /lessons` and both GETs pass, because filing a lesson
 * and reading the corpus are what a build is for. Only the two transitions out of `staged` are
 * refused, and only on this mount — the operator's own `/api/kanban` carries them.
 */
const REVIEW_PATH = /\/lessons\/[^/]+\/(approve|reject)(\/|$)/i;

/**
 * The DESTRUCTION of an operator's uploaded bytes, refused on the same terms — and METHOD-SCOPED,
 * unlike the two above.
 *
 * An attachment's bytes are the OPERATOR's: a screenshot he pasted into a card, a PDF he handed a
 * build. A Metis who ADDS one is recording what her build produced, and one who READS one is looking
 * at what she was handed — both are ordinary. One who DELETES one destroys bytes the board cannot
 * reconstruct: the row's deletion is an audit line, the file is simply gone, and no lease CAS undoes
 * a `rm`. So the refusal is on `DELETE` alone, and only on this door: the operator's own
 * `/api/kanban` carries all three verbs.
 *
 * The path test is the same shape as the two above, so `…/cards/<id>/attachments/<id>` in any case
 * is refused — spelled with `%2F` or not, because `matchesPath` decodes before it tests.
 *
 * ONE TRAILING SLASH IS TOLERATED, the way `REVIEW_PATH` above tolerates it, and that tolerance is
 * load-bearing rather than cosmetic: Express matches a path without regard to a trailing slash, a
 * regex anchored at `$` does not, and the gap between the two is the fence. MEASURED 2026-09-17:
 * `DELETE /api/kanban-pm/cards/<id>/attachments/<id>` answered 403, the identical request with one
 * trailing slash answered 401 — the fence MISSED and the credential check, which every live Metis
 * passes with her derived credential, is the only thing that refused — while the same spelling on
 * the operator's own mount answered 200 `{ok:true}` with the row gone and the file unlinked. The
 * fence is worth nothing if one character spells around it.
 *
 * A two-segment tail (`a-1%2Fx`, decoding to `a-1/x`) still falls through to the credential check.
 * That one IS harmless, and for a reason this one lacked: no minted attachment id carries a
 * separator, so the path finds no row and answers 404 with nothing destroyed.
 */
const OPERATOR_BYTES = /\/cards\/[^/]+\/attachments\/[^/]+\/?$/i;

/**
 * Does this path reach the given door, however it is spelled?
 *
 * CASE-INSENSITIVE AND PERCENT-DECODED, because the router behind this guard is both. Express
 * matches routes without regard to case unless `case sensitive routing` is set, so a guard that
 * spelled the path in lowercase only would be a lock on one handle of a door standing open:
 * MEASURED 2026-09-16, `POST /api/kanban-pm/import/descent` was refused 403 while
 * `POST /api/kanban-pm/Import/descent` reached `import.routes.ts:46` and ran. A `%2F` is a `/` to
 * everything downstream of here too, so the test is made on the decoded path.
 */
function matchesPath(path: RegExp, rawPath: string): boolean {
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // A stray `%` that is not a valid escape. The raw path is then the only honest string to test.
  }
  return path.test(decoded);
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
 * A CREDENTIAL ALONE IS NOT ACCEPTANCE. The guard asks this server's live registry whether that
 * session is running, and that map is filled by the spawner and serialized nowhere — which is the
 * revocation the whole scheme rests on. A credential minted in a SECOND process is therefore
 * well-formed and unknown here: 401 `No such running Metis session.` A probe that needs an accepted
 * bearer has to make THIS server adopt the session (the directory on disk before the boot), or read
 * its own argv as a child the spawner launched; minting one beside the server cannot work however
 * it is spelled.
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
  if (matchesPath(IMPORT_PATH, request.path)) {
    refuse(response, 403, 'The descent importer is not reachable from the kanban-pm door.');
    return;
  }

  // The review fence, ahead of the credential check: a review is a person's act, so WHOSE
  // credential arrived is not the question — no Metis reviews a lesson, this one included.
  if (matchesPath(REVIEW_PATH, request.path)) {
    refuse(response, 403, 'Reviewing a lesson is not reachable from the kanban-pm door.');
    return;
  }

  // The byte-destruction fence, method-scoped: staging a lesson and ADDING an attachment are both
  // how a build records its work, and both pass. Deleting one of the operator's uploaded files does
  // not, and neither method nor path is a question of whose credential arrived.
  if (request.method === 'DELETE' && matchesPath(OPERATOR_BYTES, request.path)) {
    refuse(response, 403, 'Deleting an attachment is not reachable from the kanban-pm door.');
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
   * The tick's decision is five dials, a timestamp and two gate answers, and every one of them is
   * answered here: autonomy (the board's governor), concurrency (how many sessions it may run, with
   * `concurrencyMax` — the clamp's ceiling — beside it so the panel's dial stops where the clamp does), live
   * (how many it has), claimable (how much work is waiting), lastSpawnAt (how recently the cooldown
   * was stamped), rateLimitUntil (how long the account cap holds spawning back) and relaunchAllowed
   * (whether the board's ledger still permits a launch). Without the last two, an operator watching
   * a quiet board cannot tell "nothing to do" from "the driver is not running" from "the cooldown is
   * holding it" from "the account is capped" from "this board has spent its attempts" — five
   * outward-identical situations with five different fixes.
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
        concurrencyMax: KANBAN_CONCURRENCY_MAX,
        claimable: reading.claimable,
        live: reading.live,
        lastSpawnAt: reading.lastSpawnAt,
        rateLimitUntil: reading.rateLimitUntil,
        relaunchAllowed: reading.relaunchAllowed,
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

  /**
   * The nudge: record that a person asked for this board to be worked on, and wake the driver.
   *
   * The tick is scheduled on the NEXT MACROTASK rather than called here, and that is not a
   * stylistic choice: a tick reaps and then spawns, which reads the board, queries its claimable
   * cards and can start a child — seconds of work the operator would spend watching a button spin.
   * `setImmediate` also puts it after this response has been written, so the caller is answered
   * first and the loop runs immediately afterwards. Nothing awaits the tick, and nothing needs to:
   * it swallows its own faults, and what it did is not what this answer is about.
   *
   * The event is recorded THROUGH THE BOARD'S OWN SERVICE (`kanbanBoardsService`, imported from the
   * kanban barrel), not written here, so the nudge lands in the board's audit log and on the wire
   * like every other act on it. A board that does not exist is that service's 404.
   */
  router.post(
    '/boards/:boardId/nudge',
    handle<{ boardId: string }>((request, response) => {
      kanbanBoardsService.nudgeBoard(request.params.boardId);
      setImmediate(() => driver.tick());
      response.json({ nudged: true, at: Date.now() });
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
   * One person's words to a Metis whose child has stopped, as the turn she wakes up to.
   *
   * THE BLANK CHECK IS THE ROUTE'S, and it is made before anything is looked up: an empty turn
   * would be a child spawned to answer nothing, and a 422 that named a session would be describing
   * a request that never needed to find one. Everything after it is ONE call — the spawner refuses
   * an unknown session (404), a session whose child is still running (409, `she is mid-turn — stop
   * her first, then reply`) and a board at its dial (409, in `canSpawn`'s own words), in that order,
   * because those are the three facts about a session and a board rather than three facts about a
   * request. A route that re-derived any of them would be a second, quieter policy beside the
   * spawner's — and this route is deliberately as thin as `resume` above it.
   */
  router.post(
    '/sessions/:sessionId/reply',
    handle<{ sessionId: string }>(async (request, response) => {
      const body = (request.body ?? {}) as { text?: unknown };
      if (typeof body.text !== 'string' || body.text.trim() === '') {
        throw new AppError('a reply needs text', {
          statusCode: 422,
          code: 'KANBAN_REPLY_TEXT_REQUIRED',
        });
      }
      response.json({ session: await spawner.reply(request.params.sessionId, body.text) });
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
