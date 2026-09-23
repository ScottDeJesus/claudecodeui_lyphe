import express from 'express';

import type { RunnerOffpeak, RunnerRunSnapshot, RunnerVerb, RunnerVerbResult } from '@/shared/types.js';
import {
  readRunnerModelChoice,
  readRunnerScheduleWhen,
  runnerModelChoiceError,
  runnerScheduleWhenError,
} from '@/shared/utils.js';

/**
 * What a run id may look like. The runner mints `<plan stem>-<YYYYmmdd-HHMMSS>-<4 hex>` and
 * composes a directory path from it, so this is deliberately narrower than "any path segment":
 * no slash and no `%`, which is what stops a traversal attempt at the door rather than one
 * layer in. `..` on its own passes the character test and is simply a run nothing can find.
 */
const RUN_ID = /^[A-Za-z0-9._-]{1,120}$/;

export type PlanRunnerRouterDependencies = {
  /** The watcher's last reading. Never a fresh scan: the poll already owns the disk. */
  current: () => RunnerRunSnapshot[];
  /** Relays one of the runner's own verbs and comes back with what it said; `verbArgs` follow the run id. */
  runVerb: (verb: RunnerVerb, runId: string, verbArgs?: readonly string[]) => Promise<RunnerVerbResult>;
  /** The runner's next DeepSeek off-peak moment, epoch SECONDS or `null` (`runner-offpeak.service.ts`, cached). */
  offpeak: () => Promise<number | null>;
};

/**
 * How a relayed verb's outcome becomes a status.
 *
 * A runner refusal is a CONFLICT, not a server fault: the run is not in a state that verb can
 * act on, the runner said exactly why, and that sentence travels in the body untouched. Turning
 * it into a 500 would replace the one useful thing in the answer with our own paraphrase.
 */
function statusForVerb(result: RunnerVerbResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

/**
 * The plan-runner lane's seven routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: no file is read here, no process is
 * started here, and no route names a path from the request — the state directory and the runner
 * binary are the module's, fixed at composition, and a request can only ever choose a run id.
 */
export function createPlanRunnerRouter(dependencies: PlanRunnerRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/runs', (_request, response) => {
    response.json({ runs: dependencies.current(), at: Date.now() });
  });

  // BEFORE `/runs/:id`, which would otherwise answer "no such run" for the word `offpeak`. The time the
  // `Start at …` button shows: the runner's own clock (`plan-runner offpeak`), never computed here.
  router.get('/runs/offpeak', async (_request, response) => {
    const body: RunnerOffpeak = { at: await dependencies.offpeak() };
    response.json(body);
  });

  router.get('/runs/:id', (request, response) => {
    // A malformed id cannot name a run, so it gets the same answer an unknown one gets — and it
    // gets it without a lookup. A read here has no other failure mode: the picture is already in
    // memory, so either a run carries that id or none does.
    const run = dependencies.current().find((entry) => entry.run_id === request.params.id);
    if (!run) {
      response.status(404).json({ error: 'no such run' });
      return;
    }
    response.json({ run });
  });

  /**
   * Every verb is the same handler; only the word differs, and the word is ours, never the
   * request's — `model`'s argument too, which `readRunnerModelChoice` maps onto our own constant, and
   * `schedule`'s, checked by `readRunnerScheduleWhen` as one of three shapes. `readArgs` answers `null` for a
   * body that names nothing the runner accepts (a 400 with `badBody`'s sentence, nothing spawned). The params are declared rather than left to the default dictionary, whose `id` is
   * `string | string[]` for the repeated-parameter patterns this route does not use.
   */
  const relay = (
    verb: RunnerVerb,
    readArgs: (body: unknown) => string[] | null = () => [],
    badBody: () => string = runnerModelChoiceError,
  ): express.RequestHandler<{ id: string }> => async (request, response, next) => {
    const runId = request.params.id;
    if (!RUN_ID.test(runId)) {
      response.status(400).json({ error: 'run id is required' });
      return;
    }
    const verbArgs = readArgs(request.body);
    if (verbArgs === null) {
      response.status(400).json({ error: badBody() });
      return;
    }

    try {
      const result = await dependencies.runVerb(verb, runId, verbArgs);
      response.status(statusForVerb(result)).json(result);
    } catch (error) {
      // The service resolves every failure it can name, so reaching here means something this
      // lane has no word for. It belongs to the app's error handler, not to a body of our own.
      next(error);
    }
  };

  router.post('/runs/:id/stop', relay('stop'));
  router.post('/runs/:id/resume', relay('resume'));
  router.post('/runs/:id/model', relay('model', (body) => {
    const choice = readRunnerModelChoice((body as { model?: unknown } | undefined)?.model);
    return choice === null ? null : [choice];
  }));
  // A QUEUED run's Start at a time: `plan-runner schedule <id> offpeak|<iso>|none`. The runner refuses a run
  // that is not queued and a time already past; that sentence is the 409's body.
  router.post('/runs/:id/schedule', relay('schedule', (body) => {
    const when = readRunnerScheduleWhen((body as { when?: unknown } | undefined)?.when);
    return when === null ? null : [when];
  }, runnerScheduleWhenError));

  return router;
}
