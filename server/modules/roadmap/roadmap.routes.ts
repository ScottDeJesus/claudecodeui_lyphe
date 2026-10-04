import express from 'express';

import type { RoadmapAct, RoadmapCase, RoadmapPicture, RoadmapWriteResult } from '@/shared/roadmap-types.js';

import { NAME_PATTERN, writeArgv } from './roadmap-write.service.js';

export type RoadmapRouterDependencies = {
  /**
   * The reading to answer a request with: the lane's last and — in the gap before this boot's first
   * `dispatcher roadmap show --json` has landed — that first reading, waited for up to the bound the
   * composition root names (`FIRST_READ_WAIT_MS`, `roadmap.module.ts`). Never a fresh read of its own:
   * the poll already owns the subprocess. `null` means the wait ended with this boot holding no picture.
   */
  current: () => Promise<RoadmapPicture | null>;
  /** Runs one write's argv through the dispatcher and comes back with what it said (`roadmap-relay.service.ts`). */
  relay: (act: RoadmapAct, argv: readonly string[], body: unknown) => Promise<RoadmapWriteResult>;
  /** Reads the roadmap again now, so a write that landed redraws the screen within moments (`PolledLane.poke`). */
  poke: () => void;
  /**
   * One feature's active cases, read through the cases door (`roadmap-cases.service.ts`) when the
   * feature dialog opens. Rejects with one sentence naming what the door said or did not.
   */
  cases: (feature: string) => Promise<RoadmapCase[]>;
};

/**
 * What a read is told while this boot has not read the dispatcher yet — never an empty roadmap, which
 * every client would draw as a real one, and never an error status: a non-2xx is what puts a console
 * error in every tab that seeds during a handover (the rule the dispatcher lane's own `NOT_READ_YET`
 * states). The body is not a picture, so the screen draws nothing from it, and the frame the first
 * landing broadcasts fills the screen a moment later.
 */
const NOT_READ_YET = { error: 'the roadmap has not been read yet' } as const;

/**
 * How a relayed write's outcome becomes a status, in the shape of the dispatcher lane's `statusForVerb`.
 * A refusal is a CONFLICT, not a server fault: the dispatcher said why on stdout (`REFUSED …`, exit 2,
 * or a not-found line, exit 1) and that sentence travels in the body untouched. The two ways it never
 * got to answer are the gateway's: a teardown is a 504, a binary that would not start a 503.
 */
function statusForWrite(result: RoadmapWriteResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

/**
 * The roadmap lane's eleven routes: one read of the picture, one read of a feature's cases and the nine
 * writes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * `GET /cases?feature=<name>` fences its one query to a plan name (a 400 with a sentence, nothing run)
 * and answers `{ cases }`. A read that threw answers 502 with the thrown sentence as `error`: the
 * cases door is an upstream command that failed, and `readDispatcherJson` hands back a sentence, not a
 * result with a `reason` for `statusForWrite` to sort into its 504 and 503.
 *
 * These handlers fence and translate and do nothing else. `writeArgv` turns a body into the
 * dispatcher's argv or a sentence naming the field that fails its fence (a 400, nothing spawned); the
 * relay runs it; the answer is the dispatcher's result with the act and the name, under the status
 * `statusForWrite` gives it. Nothing here names a flag, a path or a binary, and nothing is optimistic:
 * a write that answered ok pokes the lane, and the screen redraws from the picture the dispatcher
 * itself reads back.
 */
export function createRoadmapRouter(dependencies: RoadmapRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/', async (_request, response, next) => {
    try {
      const picture = await dependencies.current();
      response.json(picture === null ? NOT_READ_YET : { ...picture, at: Date.now() });
    } catch (error) {
      next(error);
    }
  });

  router.get('/cases', async (request, response) => {
    const feature = request.query.feature;
    if (typeof feature !== 'string' || !NAME_PATTERN.test(feature)) {
      response.status(400).json({ error: 'feature must be a plan name' });
      return;
    }
    try {
      response.json({ cases: await dependencies.cases(feature) });
    } catch (error) {
      // The sentence is the answer's reason, so the dialog says what the door said.
      response.status(502).json({ error: error instanceof Error ? error.message : 'the cases door did not answer' });
    }
  });

  /** Every write is the same handler; only the act differs, and the act is ours, never the request's. */
  const write = (act: RoadmapAct): express.RequestHandler => async (request, response, next) => {
    const argv = writeArgv(act, request.body);
    if (typeof argv === 'string') {
      response.status(400).json({ error: argv });
      return;
    }
    try {
      const result = await dependencies.relay(act, argv, request.body);
      response.status(statusForWrite(result)).json(result);
      if (result.ok) dependencies.poke();
    } catch (error) {
      // The relay resolves every failure it can name, so reaching here is one this lane has no word
      // for: it belongs to the app's error handler, not to a body of our own.
      next(error);
    }
  };

  router.post('/add', write('add'));
  router.post('/edit', write('edit'));
  router.post('/move', write('move'));
  router.post('/propose', write('propose'));
  router.post('/unpropose', write('unpropose'));
  router.post('/block', write('block'));
  router.post('/unblock', write('unblock'));
  router.post('/remove', write('remove'));
  // The design door, not a roadmap verb: a promote is `dispatcher design <name>` (`roadmap-write.service.ts`).
  router.post('/promote', write('promote'));

  return router;
}
