import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import express from 'express';

import { userFacingEnv } from '@/shared/child-env.js';
import { createPolledLane, type PolledLane } from '@/shared/polled-lane.service.js';
import type { ArcSnapshot, ArcStateEvent, ArcVerbResult } from '@/shared/types.js';
import {
  readRunnerModelChoice,
  readRunnerScheduleWhen,
  runnerModelChoiceError,
  runnerScheduleWhenError,
} from '@/shared/utils.js';

import { snapshotArcs } from './arc-state.service.js';

/**
 * The arc deck's server half: the poll that puts an `arc_state` frame on the wire when the deck moves, and the
 * five routes the deck reads, drags, pins, starts and schedules through. The lane never writes an arc file — a
 * drag is relayed to the runner's own `arc reorder`, the header's DeepSeek / Claude control to its `arc model`,
 * its Start to `arc start` and its `Start at …` to `arc schedule`, each of which
 * takes the arc's lock and writes the record itself, so the arc file stays the ONE truth, the deck a view of it,
 * and the answer the runner's own sentence carried whole.
 */

const execFileAsync = promisify(execFile);

/** How much the runner may say. Every arc verb relayed here prints a line or two; the ceiling is stated rather than left to the default. */
const VERB_MAX_BUFFER = 1024 * 1024;

/** What an arc name may look like: the runner's own `SAFE_ID_RE` shape (`hooks/plan_runner/arcs.py`), with no separator a path could use. */
const ARC_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Said only when the runner itself said nothing, because it never ran or never finished — the two cases `reason` covers. */
const NO_ANSWER: Record<'timeout' | 'spawn-failed', string> = {
  timeout: 'the runner was stopped before it answered — read the arc before retrying, since an arc verb takes the arc lock',
  'spawn-failed': 'the plan runner command could not be started on this host',
};

export type ArcLaneDependencies = {
  /** Where the runner keeps its arcs: `<arcsDir>/<name>/arc.json`, one directory per arc. */
  arcsDir: string;
  /** The runner's entry point, absolute — `~/.claude/scripts/plan-runner` unless the env moved it. */
  bin: string;
  /** The directory holding the Claude CLI, prepended to `PATH`, or `null` — see `runner-verb.service.ts`. */
  claudeBinDir: string | null;
  /** Puts one frame on every open chat socket. Called only when the picture changed. */
  broadcast: (frame: ArcStateEvent) => void;
  /** How often the arc root is read, in milliseconds. */
  pollMs: number;
  /** Wall-clock ceiling for one relayed arc verb. */
  timeoutMs: number;
  /** How long a finished arc stays on the deck, in SECONDS — the run list's own window. */
  endedKeepS: number;
  /** Injected by the composition root — this server has no logger (see `polled-lane.service.ts`). */
  logError: (message: string) => void;
};

/** The three things the relay needs off the composition root; `ArcLaneDependencies` is a superset of them. */
type ArcVerbTarget = Pick<ArcLaneDependencies, 'bin' | 'claudeBinDir' | 'timeoutMs'>;

/** What the lane hands back: the polled deck picture, and the routes over it. */
export type ArcLane = PolledLane<ArcSnapshot[]> & { router: express.Router };

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** The run verbs' own mapping (`plan-runner.routes.ts`): a runner refusal is a CONFLICT, not a server fault. */
function statusForArcVerb(result: ArcVerbResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

/** A body position, or `null`: only an integer in 1..999 is one the runner could act on. */
function readPosition(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 999 ? value : null;
}

/**
 * Relays one `plan-runner arc <subverb> <arc> …` and comes back with what the runner said; nothing here throws,
 * since a refusal is a RESULT. `argv` is built by the route from the validated name and our own words only.
 */
async function runArcVerb(arc: string, argv: readonly string[], target: ArcVerbTarget): Promise<ArcVerbResult> {
  const searchPath = target.claudeBinDir ? `${target.claudeBinDir}:${process.env.PATH ?? ''}` : process.env.PATH;

  try {
    const result = await execFileAsync(target.bin, ['arc', ...argv], {
      timeout: target.timeoutMs,
      maxBuffer: VERB_MAX_BUFFER,
      env: { ...userFacingEnv(), PATH: searchPath },
      cwd: os.homedir(),
    });
    return { ok: true, arc, exit: 0, stdout: readOutput(result.stdout), stderr: readOutput(result.stderr) };
  } catch (error) {
    const failure = error as { code?: unknown; signal?: unknown; stdout?: unknown; stderr?: unknown };
    const stdout = readOutput(failure.stdout);
    const stderr = readOutput(failure.stderr);

    // A NUMERIC code means the runner ran and decided — an unknown arc, or a card it will not move — and a
    // verdict travels whole. A SIGNAL means it never answered: our ceiling, or a binary that could not start.
    // Residue, named for the next reader as `runner-verb.service.ts` names it: an output overflow carries no
    // signal and so lands on `spawn-failed`, the one case that is honestly neither word — and it is
    // unreachable, since `VERB_MAX_BUFFER` is roughly a thousand times what an arc verb prints.
    if (typeof failure.code === 'number' && Number.isFinite(failure.code)) {
      return { ok: false, arc, exit: failure.code, stdout, stderr };
    }
    const reason = typeof failure.signal === 'string' ? 'timeout' : 'spawn-failed';
    return { ok: false, arc, exit: null, stdout, stderr: stderr || NO_ANSWER[reason], reason };
  }
}

/**
 * Builds the deck's lane for the composition root: the poll over `snapshotArcs`, the frame, and the five routes.
 * `plan-runner.module.ts` is its only caller, and the only place that reads the environment or names a socket.
 */
export function createArcLane(dependencies: ArcLaneDependencies): ArcLane {
  const lane = createPolledLane<ArcSnapshot[], ArcStateEvent>({
    // Epoch SECONDS: `arc.json`'s stamps come from the runner's Python `time.time()`, and a millisecond clock
    // compared against one of them would age every finished arc out at once.
    snapshot: () =>
      snapshotArcs(dependencies.arcsDir, Date.now() / 1000, dependencies.endedKeepS, (dir, message) =>
        dependencies.logError(`could not read arc directory ${dir}: ${message}`),
      ),
    frame: (arcs) => ({ kind: 'arc_state', arcs, at: Date.now() }),
    broadcast: dependencies.broadcast,
    pollMs: dependencies.pollMs,
    logError: (message) => dependencies.logError(`[PlanRunner] ${message}`),
  });

  const router = express.Router();

  router.get('/arcs', (_request, response) => {
    response.json({ arcs: lane.current(), at: Date.now() });
  });

  /**
   * A drag. The name is checked before anything else, so a traversal attempt never reaches the runner, and
   * nothing is reordered here: the runner writes the file and the next frame redraws the deck.
   */
  router.post('/arcs/:arc/reorder', async (request, response, next) => {
    const arc = request.params.arc;
    if (!ARC_NAME.test(arc)) {
      response.status(400).json({ error: 'arc name is required' });
      return;
    }

    const from = readPosition(request.body?.from);
    const to = readPosition(request.body?.to);
    if (from === null || to === null) {
      response.status(400).json({ error: 'from and to are required' });
      return;
    }

    try {
      const result = await runArcVerb(arc, ['reorder', arc, String(from), String(to)], dependencies);
      response.status(statusForArcVerb(result)).json(result);
    } catch (error) {
      // The service resolves every failure it can name; this is one it has no word for, so it belongs to the
      // app's error handler rather than a body of our own.
      next(error);
    }
  });

  /**
   * The header's DeepSeek / Claude control: the arc's ONE word, relayed to `arc model`. The body's word is
   * matched by `readRunnerModelChoice` before anything is spawned; the runner records it and hands it to every
   * card, and the next `arc_state` frame redraws the header — nothing here is optimistic.
   */
  router.post('/arcs/:arc/model', async (request, response, next) => {
    const arc = request.params.arc;
    if (!ARC_NAME.test(arc)) {
      response.status(400).json({ error: 'arc name is required' });
      return;
    }
    const choice = readRunnerModelChoice(request.body?.model);
    if (choice === null) {
      response.status(400).json({ error: runnerModelChoiceError() });
      return;
    }

    try {
      const result = await runArcVerb(arc, ['model', arc, choice], dependencies);
      response.status(statusForArcVerb(result)).json(result);
    } catch (error) {
      next(error); // one it has no word for: the app's error handler, as the reorder route does
    }
  });

  /**
   * The header's Start: `arc start <name>`, relayed with NO `--now` — the operator's word for the whole arc is
   * a separate act the deck does not offer. The runner runs the whole ladder (lints, switch, intent lock) and
   * its refusal is the 409's body, shown by the deck as a toast.
   */
  router.post('/arcs/:arc/start', async (request, response, next) => {
    const arc = request.params.arc;
    if (!ARC_NAME.test(arc)) {
      response.status(400).json({ error: 'arc name is required' });
      return;
    }
    try {
      const result = await runArcVerb(arc, ['start', arc], dependencies);
      response.status(statusForArcVerb(result)).json(result);
    } catch (error) {
      next(error); // one it has no word for: the app's error handler, as the reorder route does
    }
  });

  /** The header's `Start at …` / Cancel: `arc schedule <name> offpeak|<iso>|none`, the word shape-checked first. */
  router.post('/arcs/:arc/schedule', async (request, response, next) => {
    const arc = request.params.arc;
    if (!ARC_NAME.test(arc)) {
      response.status(400).json({ error: 'arc name is required' });
      return;
    }
    const when = readRunnerScheduleWhen(request.body?.when);
    if (when === null) {
      response.status(400).json({ error: runnerScheduleWhenError() });
      return;
    }
    try {
      const result = await runArcVerb(arc, ['schedule', arc, when], dependencies);
      response.status(statusForArcVerb(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return {
    router,
    start: () => lane.start(),
    stop: () => lane.stop(),
    current: () => lane.current(),
  };
}
