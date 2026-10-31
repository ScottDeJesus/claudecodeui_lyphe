import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { RelayAnswer, ResumeRunOrder } from '@/shared/relayed-press-types.js';
import type { SoulLaunchSnapshot, SoulLaunchStateEvent } from '@/shared/types.js';
import { dispatchSoulsStateDir } from '@/shared/utils.js';

import { createDispatchSoulsRouter } from './dispatch-souls.routes.js';
import { resumeChainOnHisWord } from './run-resume.service.js';
import { readSoulTranscript } from './soul-transcript.service.js';
import { snapshotLaunches } from './soul-launch.service.js';

/**
 * How often the launch root is read. Two seconds: fast enough that a launch appearing or a receipt
 * landing reaches the pin while the reader is still looking at the chat, slow enough over a
 * directory of a few dozen launches to be free.
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

/**
 * How long a read of the launches waits for this boot's first reading of the launch root: the dispatcher and roadmap
 * lanes' bound, so a reader of the house is owed an answer either way and is told "not read yet" past it.
 */
const FIRST_READ_WAIT_MS = 5000;

/**
 * What `createDispatchSoulsModule` hands the server entrypoint: the router to mount, the poll's `start` and `stop`, and
 * `launches()`, the lane's picture behind `whenLanded` — the souls and chains sessions launched by hand. The lane's
 * reading is synchronous and seeded when it is built, so this answers at once; `null` is the shared lane's type, never
 * a case this lane meets. The entrypoint passes `launches` on to the companion's house
 * (`CompanionHouse.launches`), and `resumeRun(order)` after it (`CompanionHouse.resumeRun`): a chain resumed with his
 * rulings on his word, spoken or typed, through the plan-runner's own door with kaylee--press's record of it
 * (`run-resume.service.ts`) — this lane owns the runs on this server.
 */
export type DispatchSoulsModule = {
  router: Router;
  start(): void;
  stop(): void;
  launches(): Promise<SoulLaunchSnapshot[] | null>;
  resumeRun(order: ResumeRunOrder): Promise<RelayAnswer>;
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
  const stateDir = dispatchSoulsStateDir();

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
    launches: () => lane.whenLanded(FIRST_READ_WAIT_MS),
    resumeRun: (order) => resumeChainOnHisWord(order, (line) => console.log(line)),
  };
}
