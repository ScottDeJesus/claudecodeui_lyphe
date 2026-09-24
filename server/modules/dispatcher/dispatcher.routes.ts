import express from 'express';

import type { DispatcherVerb, DispatcherVerbResult, RunnerOffpeak } from '@/shared/types.js';
import { readRunnerScheduleWhen, runnerScheduleWhenError } from '@/shared/utils.js';

import type { DispatcherPicture } from './dispatcher-state.service.js';

/**
 * What a plan may be called in a URL.
 *
 * This is the dispatcher's own name rule with the suffix that reaches its door
 * (`hooks/dispatcher/names.py:NAME_RE` — `<name>` or `<name>.v3`, lowercase, hyphenated, minted by
 * the board). It is written out rather than imported because the rule's HOME is that module, on the
 * other side of a process boundary; what this fence is for is narrower and worth stating exactly: an
 * argument that cannot be parsed as a plan name never reaches an argv array at all. Everything the
 * regex refuses — a slash, a space, a `$`, a leading `.` — is a string no verb could act on, and
 * refusing it here is what keeps any future caller of this router from having to remember that.
 */
const PLAN_NAME = /^[a-z0-9][a-z0-9-]{0,99}(\.v3)?$/;

export type DispatcherRouterDependencies = {
  /** The watcher's last reading. Never a fresh read: the poll already owns the subprocess. */
  current: () => DispatcherPicture;
  /** Relays one of the dispatcher's own verbs and comes back with what it said; `verbArgs` follow the plan's name. */
  runVerb: (verb: DispatcherVerb, plan: string, verbArgs?: readonly string[]) => Promise<DispatcherVerbResult>;
  /** The dispatcher's next DeepSeek off-peak moment, epoch SECONDS or `null` (`runner-offpeak.service.ts`, reused as is). */
  offpeak: () => Promise<number | null>;
};

/**
 * How a relayed verb's outcome becomes a status.
 *
 * A dispatcher refusal is a CONFLICT, not a server fault — the plan is not in a state that verb can
 * act on (`REFUSED schedule <name>.v3: is live — stop it first`, exit 2), the dispatcher said exactly
 * why on stdout, and that sentence travels in the body untouched. Turning it into a 500 would replace
 * the one useful thing in the answer with our own paraphrase.
 */
function statusForVerb(result: DispatcherVerbResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

/**
 * The dispatcher lane's eight routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: nothing is read here, no process is
 * started here, and no route names a path from the request — the binary and the store are the
 * module's, fixed at composition, and a request can only ever choose a plan by name and a word from
 * the closed set of five verbs.
 */
export function createDispatcherRouter(dependencies: DispatcherRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/plans', (_request, response) => {
    response.json({ ...dependencies.current(), at: Date.now() });
  });

  // BEFORE `/plans/:name`, which would otherwise answer `no such plan` for the word `offpeak`. The
  // time a queued plan's `Start at …` button shows: the dispatcher's own clock, never computed here.
  router.get('/plans/offpeak', async (_request, response) => {
    const body: RunnerOffpeak = { at: await dependencies.offpeak() };
    response.json(body);
  });

  router.get('/plans/:name', (request, response) => {
    // Both spellings of one plan: the store holds the bare name, and the card and every verb address
    // it with the `.v3` suffix the board minted (`plan.v3`). No name is ever rewritten here — the
    // question is only whether this picture holds a plan either spelling names.
    const wanted = request.params.name;
    const plan = dependencies
      .current()
      .plans.find((entry) => entry.name === wanted || entry.v3 === wanted);
    if (!plan) {
      response.status(404).json({ error: 'no such plan' });
      return;
    }
    response.json({ plan });
  });

  /**
   * Every verb is the same handler; only the word differs, and the word is ours, never the request's
   * — `schedule`'s hour too, checked by `readRunnerScheduleWhen` against the three shapes the
   * dispatcher accepts, so the argv word is always one we wrote down. `readArgs` answers `null` for a
   * body that names nothing the dispatcher accepts (a 400 with `badBody`'s sentence, nothing
   * spawned). The params are declared rather than left to the default dictionary, whose `name` is
   * `string | string[]` for the repeated-parameter patterns these routes do not use.
   *
   * The plan's name travels to the dispatcher EXACTLY as the URL spelled it: `.v3` and all, since
   * that rule is the dispatcher's own and both spellings are its door's (INV-171). This route's job
   * is to refuse what cannot be a name, never to normalize one.
   */
  const relay = (
    verb: DispatcherVerb,
    readArgs: (body: unknown) => string[] | null = () => [],
  ): express.RequestHandler<{ name: string }> => async (request, response, next) => {
    const plan = request.params.name;
    if (!PLAN_NAME.test(plan)) {
      response.status(400).json({ error: 'plan name is required' });
      return;
    }
    const verbArgs = readArgs(request.body);
    if (verbArgs === null) {
      response.status(400).json({ error: runnerScheduleWhenError() });
      return;
    }

    try {
      const result = await dependencies.runVerb(verb, plan, verbArgs);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      // The service resolves every failure it can name, so reaching here means something this lane
      // has no word for. It belongs to the app's error handler, not to a body of our own.
      next(error);
    }
  };

  router.post('/plans/:name/stop', relay('stop'));
  router.post('/plans/:name/resume', relay('resume'));
  router.post('/plans/:name/park', relay('park'));
  router.post('/plans/:name/unpark', relay('unpark'));
  // A QUEUED plan's Start at a time, and the only verb here with an argument:
  // `dispatcher schedule <name> offpeak|<iso>|none`. The dispatcher refuses a plan that is live or
  // has never waited, and a time already past; that sentence is the 409's body, untouched.
  router.post('/plans/:name/schedule', relay('schedule', (body) => {
    const when = readRunnerScheduleWhen((body as { when?: unknown } | undefined)?.when);
    return when === null ? null : [when];
  }));

  return router;
}
