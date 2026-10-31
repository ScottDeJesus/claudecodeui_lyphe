import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';

import { AppError, asyncHandler, readPathParam } from '@/shared/utils.js';

import { earsFile } from './ears-files.js';

/**
 * Her ears' one route, mounted by `createCompanionRoutes` at `/api/companion/ears` behind `authenticateToken`. ONLY TRANSPORT:
 * it parses the path, asks `earsFile` and sends.
 *
 *   GET /files/<repo>/<path>     one pinned file of the models the page's ears load (Moonshine base and Silero VAD), as bytes
 *
 * WHY IT EXISTS. His preference is that nothing leaves the browser before her name, and every byte the page's ears load comes
 * from CloudCLI's own server: the page's worker has remote models switched off and asks this route for each model file with its
 * sign-in header. `<repo>` is a Hugging Face repository (`owner/name`) and `<path>` a file in it, so the URL is the layout
 * transformers.js reads under a `localModelPath`. The first ask of a file fetches it from Hugging Face at its pinned revision
 * and keeps it under `~/.cloudcli/companion-ears` (`ears-files.ts`); every ask after that is answered from disk.
 *
 * The rest of the path is looked up in the manifest by string equality, so no path outside it can be named: anything else is
 * 404 `COMPANION_EARS_NOT_FOUND`, and a fetch that was refused (Hugging Face unreachable, a file that did not match its pinned
 * SHA-256) is 502 `COMPANION_EARS_UNREACHABLE` carrying the sentence. Both are the app's own `AppError` envelope. A hit goes out
 * with `sendFile`, which answers the one-byte range the page's transformers.js asks first (a range that starts past the end of
 * the file is 416 carrying a `Content-Range` that names its size, as HTTP says, not the app's 500), with
 * `Cache-Control: private, max-age=31536000, immutable`: a file is pinned to a revision and a hash, so a page never asks twice.
 * Like her face's files, these name no `x-companion-client`. Consumed by `companion.routes.ts`.
 */

/** The same header as her face's files: the bytes a manifest entry names never change. */
const EARS_FILE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** A repository is `owner/name`: the first two segments of the rest of the path. What follows is the file's path in it. */
function splitRepoAndPath(rest: string): { repo: string; filePath: string } {
  const segments = rest.split('/');
  return { repo: segments.slice(0, 2).join('/'), filePath: segments.slice(2).join('/') };
}

/** What `send` (under `sendFile`) attaches to the error it raises for a range it cannot satisfy: HTTP's status, and the `Content-Range` header that names the file's size. */
type RangeRefusal = Error & { status?: number; headers?: Record<string, string> };

/** Answers a range that starts past the end of the file with the 416 `send` chose, as the transport's own answer; any other error goes on to the app's handler. */
function answerUnsatisfiableRange(failure: RangeRefusal, _request: Request, response: Response, next: NextFunction): void {
  if (failure.status !== 416 || response.headersSent) return next(failure);
  response.status(416).set(failure.headers ?? {}).end();
}

/** Consumed by `companion.routes.ts`. */
export function createEarsRoutes(): Router {
  const router = express.Router();

  router.get(
    '/files/*',
    asyncHandler(async (request: Request, response: Response) => {
      const { repo, filePath } = splitRepoAndPath(readPathParam(request.params[0], 'path'));
      const answer = await earsFile(repo, filePath);
      if (!answer.ok) {
        if (answer.status === 404) {
          throw new AppError(answer.sentence, { code: 'COMPANION_EARS_NOT_FOUND', statusCode: 404 });
        }
        throw new AppError(answer.sentence, { code: 'COMPANION_EARS_UNREACHABLE', statusCode: 502 });
      }
      // `dotfiles: 'allow'` because the root lives under `~/.cloudcli`, which `sendFile` would otherwise refuse as a hidden path.
      response.sendFile(answer.location, { dotfiles: 'allow', cacheControl: false, headers: { 'Cache-Control': EARS_FILE_CACHE_CONTROL } });
    }),
  );

  router.use(answerUnsatisfiableRange);

  return router;
}
