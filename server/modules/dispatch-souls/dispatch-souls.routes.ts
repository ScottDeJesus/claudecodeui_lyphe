import express from 'express';

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
 * Both handlers validate and translate and do nothing else: no file is read in this file and no
 * process is started here.
 */

export type DispatchSoulsRouterDependencies = {
  /** The lane's last reading. Never a fresh scan: the poll already owns the disk. */
  current: () => SoulLaunchSnapshot[];
  /** One launch's transcript, from the launch id the request carries. */
  transcript: (launchId: string) => Promise<SubagentTranscriptResult>;
};

/** A launch id as the launcher writes it: a plain name, never a way out of the state directory. */
const LAUNCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createDispatchSoulsRouter(dependencies: DispatchSoulsRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/launches', (_request, response) => {
    response.json({ launches: dependencies.current(), at: Date.now() });
  });

  router.get('/launches/:launchId/transcript', async (request, response) => {
    const launchId = request.params.launchId;
    if (!LAUNCH_ID_PATTERN.test(launchId) || launchId.includes('..')) {
      response.status(400).json({ error: 'Invalid launchId.' });
      return;
    }

    response.json(await dependencies.transcript(launchId));
  });

  return router;
}
