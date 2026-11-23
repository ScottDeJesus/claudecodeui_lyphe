import express from 'express';

import type { CommandDependencies } from '@/modules/dispatcher/index.js';
import { bodyOf, isArgText, relayJson, relayLine, sendBadRequest } from '@/modules/kanban-dispatch/index.js';

import type { SpikeOutcome } from './rnd-spike.service.js';
import { RND_REFUSAL_EXITS, type RndPicture } from './rnd-state.service.js';

/**
 * The R&D relay's routes. The read answers the lane's picture; every write is ONE `dispatcher rnd` command over the
 * shared relay the hunt routes use, its refusal answered 409 with the dispatcher's own sentence, and a write that
 * landed pokes the lane so every screen follows the act at once. These handlers fence and translate, nothing else:
 * a name or a flag value the dispatcher's parser could read as a flag is refused 400 before anything runs, and
 * free text travels as `--flag=<text>`, one argv element. Auth is the mount's `authenticateToken`.
 */

export type RndRouterDependencies = {
  commands: CommandDependencies;
  /** The lane's picture, waited for up to its first-read bound; `null` while this boot has none. */
  current: () => Promise<RndPicture | null>;
  /** Reads the R&D document again now (`PolledLane.poke`). */
  poke: () => void;
  spike: (name: string, projectPath: string) => Promise<SpikeOutcome>;
};

const STATUS_OK = 200;
const BODY_NOT_OBJECT = 'the body must be a JSON object';
const NAME_NOT_ARG = 'the candidate name must be text that does not begin with a dash';
/** The longest free text a route passes on: the store's own longest field (evidence) is 4000 characters. */
const FREE_TEXT_MAX = 4000;
/** The settings' scoutsRun word (the store's own) and the dispatcher flag value that sets it. */
const SCOUTS_RUN_FLAGS = new Map<string, string>([['one_at_a_time', 'one-at-a-time'], ['all_at_once', 'all-at-once']]);
/** Not a picture, so no client draws an empty R&D place from it; the first landing's frame fills the screen. */
const NOT_READ_YET = { error: 'the R&D picture has not been read yet' } as const;

type Relay = typeof relayLine;
/** A body and the route's candidate name (`''` on a route without one) as argv, or the sentence a 400 carries. */
type Compose = (body: Record<string, unknown>, name: string) => readonly string[] | { error: string };

export function createRndRouter(dependencies: RndRouterDependencies): express.Router {
  const { commands, poke } = dependencies;
  const router = express.Router();

  const relayWrite =
    (relay: Relay, compose: Compose): express.RequestHandler =>
    async (request, response, next) => {
      try {
        const body = bodyOf(request.body);
        if (body === null) {
          sendBadRequest(response, BODY_NOT_OBJECT);
          return;
        }
        const name = request.params['name'];
        if (name !== undefined && !isArgText(name)) {
          sendBadRequest(response, NAME_NOT_ARG);
          return;
        }
        const argv = compose(body, name ?? '');
        if ('error' in argv) {
          sendBadRequest(response, argv.error);
          return;
        }
        await relay(commands, argv, response, RND_REFUSAL_EXITS);
        if (response.statusCode === STATUS_OK) poke();
      } catch (error) {
        next(error);
      }
    };

  router.get('/', async (_request, response, next) => {
    try {
      response.json((await dependencies.current()) ?? NOT_READ_YET);
    } catch (error) {
      next(error);
    }
  });

  // The dispatcher prints the settings after the write, so the answer is the settings as they now stand.
  router.put('/settings', relayWrite(relayJson, (body) => {
    const { webSearch, scoutsRun } = body;
    if (webSearch === undefined && scoutsRun === undefined) return { error: 'the body sets webSearch, scoutsRun or both' };
    if (webSearch !== undefined && typeof webSearch !== 'boolean') return { error: 'webSearch must be true or false' };
    const scoutsRunFlag = typeof scoutsRun === 'string' ? SCOUTS_RUN_FLAGS.get(scoutsRun) : undefined;
    if (scoutsRun !== undefined && scoutsRunFlag === undefined) return { error: 'scoutsRun must be one_at_a_time or all_at_once' };
    return [
      'rnd', 'config',
      ...(webSearch === undefined ? [] : ['--web-search', webSearch ? 'on' : 'off']),
      ...(scoutsRunFlag === undefined ? [] : ['--scouts-run', scoutsRunFlag]),
      '--json',
    ];
  }));

  router.post('/sources', relayWrite(relayLine, (body) => {
    const { url, label } = body;
    if (!isArgText(url)) return { error: 'url is required text that does not begin with a dash' };
    if (label !== undefined && !isLine(label)) return { error: 'label must be one line of text' };
    return ['rnd', 'source', 'add', url, ...(label === undefined ? [] : [`--label=${label}`])];
  }));

  router.delete('/sources', relayWrite(relayLine, (body) => {
    const { url } = body;
    if (!isArgText(url)) return { error: 'url is required text that does not begin with a dash' };
    return ['rnd', 'source', 'remove', url];
  }));

  router.post('/scout', relayWrite(relayLine, () => ['rnd', 'scout', '--now']));

  router.post('/candidates/:name/adopt', relayWrite(relayLine, (body, name) => {
    const { arc, goal, as } = body;
    if (!isArgText(arc)) return { error: 'arc is required text that does not begin with a dash' };
    if (as !== undefined && !isArgText(as)) return { error: 'as must be text that does not begin with a dash' };
    if (goal !== undefined && !isFreeText(goal)) return { error: `goal must be text of at most ${FREE_TEXT_MAX} characters` };
    const asFlags = as === undefined ? [] : ['--as', as];
    const goalFlags = goal === undefined ? [] : [`--goal=${goal}`];
    return ['rnd', 'adopt', name, '--arc', arc, ...asFlags, ...goalFlags];
  }));

  router.post('/candidates/:name/reject', relayWrite(relayLine, (body, name) => {
    const { why } = body;
    if (!isFreeText(why)) return { error: `why is required text of at most ${FREE_TEXT_MAX} characters` };
    return ['rnd', 'reject', name, `--why=${why}`];
  }));

  router.post('/candidates/:name/reopen', relayWrite(relayLine, (_body, name) => ['rnd', 'reopen', name]));

  router.post('/candidates/:name/spike', async (request, response, next) => {
    try {
      const name = request.params['name'];
      if (!isArgText(name)) {
        sendBadRequest(response, NAME_NOT_ARG);
        return;
      }
      const projectPath = bodyOf(request.body)?.['projectPath'];
      if (typeof projectPath !== 'string' || projectPath.trim() === '') {
        sendBadRequest(response, 'projectPath is required text');
        return;
      }
      const outcome = await dependencies.spike(name, projectPath);
      if (!outcome.ok) {
        response.status(outcome.status).json({ error: outcome.error });
        return;
      }
      poke();
      response.json(outcome.value);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isFreeText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= FREE_TEXT_MAX;
}

function isLine(value: unknown): value is string {
  return isFreeText(value) && !/[\r\n]/.test(value);
}
