import express from 'express';

import type { DispatcherCommandResult } from '@/shared/dispatcher-command.js';
import type { SoulLaunchSnapshot, SubagentTranscriptResult } from '@/shared/types.js';

/**
 * The dispatch-souls lane's two routes. Auth is the mount's `authenticateToken`, in
 * `server/index.ts`.
 *
 * `/launches` exists for the gap the push cannot cover — the moment between a client mounting and
 * the lane's next broadcast, which only happens on a CHANGE, so a quiet state root can leave a
 * fresh page with nothing until a launch moves. It is the seed read: the lane's last snapshot,
 * never a fresh scan of the disk.
 *
 * The sibling transcript read is addressed by launch id and exists for the chat's Subagents widget,
 * whose rows know their launch but not the Claude session behind it. That id is validated here,
 * before the service joins it under the module's fixed state directory.
 *
 * `POST /launches/:launchId/cpu-release` is the Override of a launch the runner is holding back because the
 * box's CPU is full: it lets THAT agent start now and leaves the check on. It answers in the body every press of
 * the lane already reads — the pacer door's own sentence on `stdout` (`RELEASED <id>`, or `REFUSED <id>: …`) —
 * with the status the dispatcher's verbs use: 200, a refusal as a 409, and 504/503 where the door never answered.
 *
 * All handlers validate and translate and do nothing else: no file is read in this file and no
 * process is started here.
 */

export type DispatchSoulsRouterDependencies = {
  /**
   * The lane's last reading — `null` while a first one has not landed, which is the one thing a lane
   * that has not read can honestly say. Never a fresh scan: the poll already owns the disk.
   *
   * THIS LANE'S READING IS FROM MEMORY, so its construction seed is already a picture and the `null`
   * below is never taken (`dispatch-souls.module.ts`). The type admits it because the polled lane's
   * door is shared with a lane whose reading is a subprocess, and the answer written here is the one
   * such a lane owes a reader: "not read yet", never an empty launch list dressed as a reading — and
   * never an error status, because the refusal is not picture-shaped and the client drops it anyway
   * (`SoulLaunchFeed.tsx`: `!Array.isArray(body.launches)`), while a non-2xx status is what a browser
   * logs as a console error in every tab that seeds through it.
   */
  current: () => SoulLaunchSnapshot[] | null;
  /** One launch's transcript, from the launch id the request carries. */
  transcript: (launchId: string) => Promise<SubagentTranscriptResult>;
  /** The Override of one launch waiting for CPU: the pacer door's answer, never a throw. */
  cpuRelease: (launchId: string) => Promise<DispatcherCommandResult>;
};

/** A launch id as the launcher writes it: a plain name, never a way out of the state directory. */
const LAUNCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * The launch ids the pacer's door takes (`state.SAFE_ID_RE`: no dot — it names a file in the pacer's own folder), and none that starts
 * with a dash: the launcher mints `dispatch-<agent>-…`, and an id led by `-` would be read by the door's argument parser as an option
 * (`-h` answered 200 with the door's usage), the same first character `LAUNCH_ID_PATTERN` above already requires.
 */
const CPU_RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * How the pacer door's answer becomes a status, as a relayed dispatcher verb's does: a refusal is a CONFLICT, not a fault
 * (`REFUSED <id>: not waiting for CPU` — the agent started on its own a moment before the press), and travels whole in the body.
 */
function statusForRelease(result: DispatcherCommandResult): number {
  if (result.ok) return 200;
  if (result.reason === 'timeout') return 504;
  if (result.reason === 'spawn-failed') return 503;
  return 409;
}

export function createDispatchSoulsRouter(dependencies: DispatchSoulsRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/launches', (_request, response) => {
    const launches = dependencies.current();
    if (launches === null) {
      response.json({ error: 'the launcher has not been read yet' });
      return;
    }
    response.json({ launches, at: Date.now() });
  });

  router.get('/launches/:launchId/transcript', async (request, response) => {
    const launchId = request.params.launchId;
    if (!LAUNCH_ID_PATTERN.test(launchId) || launchId.includes('..')) {
      response.status(400).json({ error: 'Invalid launchId.' });
      return;
    }

    response.json(await dependencies.transcript(launchId));
  });

  router.post('/launches/:launchId/cpu-release', async (request, response, next) => {
    const launchId = request.params.launchId;
    if (!CPU_RELEASE_ID_PATTERN.test(launchId)) {
      response.status(400).json({ error: 'Invalid launchId.' });
      return;
    }

    try {
      const result = await dependencies.cpuRelease(launchId);
      response.status(statusForRelease(result)).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
