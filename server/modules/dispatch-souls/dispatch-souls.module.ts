import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { SoulLaunchSnapshot, SoulLaunchStateEvent } from '@/shared/types.js';

import { createDispatchSoulsRouter } from './dispatch-souls.routes.js';
import { readSoulTranscript } from './soul-transcript.service.js';
import { snapshotLaunches } from './soul-launch.service.js';

/**
 * Where the launcher keeps its launch directories, unless the operator moved it.
 *
 * The launcher's own root is hard-coded (`hooks/plan_runner/solo/record.py:DISPATCH_DIR`), so this
 * default is a COPY of a constant we do not own — and the env name is ours, a seam for pointing a
 * probe at a hermetic tree rather than a knob for moving the launcher. Set it and this lane reads
 * somewhere else; a dispatch still writes to the real root, because that is the launcher's and
 * not something a server env var may reach.
 */
const DEFAULT_STATE_DIR = '~/.claude/state/dispatch-souls';

/**
 * How often the launch root is read. `plan-runner`'s own cadence, for its reason: fast enough
 * that a launch appearing or a receipt landing reaches the pin while the reader is still looking
 * at the chat, slow enough over a directory of a few dozen launches to be free.
 */
const POLL_MS = 2000;

/**
 * How long an ended launch stays on the lane after its receipt.
 *
 * Six hours and not the launcher's fortnight: a launch directory is kept for 14 days because a
 * conductor may still resume it, while this lane feeds the chat's pinned rows with a two-hour
 * dismissal window of its own. Long enough that a chat reopened after lunch still finds
 * the morning's dispatch pinned with its cost, short enough that the lane is never an archive.
 */
const LAUNCH_KEEP_S = 6 * 60 * 60;

/** `~` at the front becomes this user's home. Anywhere else it is an ordinary character. */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export type DispatchSoulsModule = {
  router: Router;
  start(): void;
  stop(): void;
};

/**
 * Builds the launcher-souls lane for the server entrypoint: the poll, the frame, and the seed and
 * transcript routes behind it.
 *
 * The composition root is the only place here that reads the environment, names a path or touches
 * a socket; everything under it takes what it needs as an argument, which is what lets the whole
 * classification be proven against a fixture tree with no launcher in existence.
 *
 * The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
 * `wss.clients` set, which would also deliver it to `/shell`, `/plugin-ws` and
 * `/desktop-notifications`, where it would be parsed and dropped, and on `/plugin-ws` handed to
 * third-party plugin frontends that have no business seeing it (`taskmaster.routes.ts:30-50`).
 */
export function createDispatchSoulsModule(): DispatchSoulsModule {
  const stateDir = expandHome(process.env.DISPATCH_SOULS_STATE_DIR || DEFAULT_STATE_DIR);

  const broadcast = (frame: SoulLaunchStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  /**
   * The lane's one door to the journal, and the one thing that bounds its volume. Everything under
   * this root polls every two seconds, so a fault that persists is a fault that repeats — a broken
   * launch root would otherwise write thousands of identical lines and bury everything else in the
   * journal. Said once per distinct message, for the life of the process.
   */
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(message);
  };

  const lane = createPolledLane<SoulLaunchSnapshot[], SoulLaunchStateEvent>({
    // Epoch SECONDS: every timestamp the launcher's Python wrote comes from `time.time()`, and a
    // millisecond clock compared against one of them makes every launch on the host read as
    // having started in 1970.
    snapshot: () =>
      snapshotLaunches(
        stateDir,
        Date.now() / 1000,
        LAUNCH_KEEP_S,
        (dir, message) => logErrorOnce(`[DispatchSouls] could not read launch directory ${dir}: ${message}`),
      ),
    frame: (launches) => ({ kind: 'soul_launch_state', launches, at: Date.now() }),
    broadcast,
    pollMs: POLL_MS,
    logError: (message) => logErrorOnce(`[DispatchSouls] ${message}`),
  });

  return {
    router: createDispatchSoulsRouter({
      current: () => lane.current(),
      transcript: (launchId) => readSoulTranscript(stateDir, launchId),
    }),
    start: () => lane.start(),
    stop: () => lane.stop(),
  };
}
