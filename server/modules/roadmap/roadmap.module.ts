import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';
import type { RoadmapAct, RoadmapPicture, RoadmapStateEvent } from '@/shared/roadmap-types.js';
import { expandHome } from '@/shared/utils.js';

import { relayRoadmapWrite } from './roadmap-relay.service.js';
import { readRoadmapState } from './roadmap-state.service.js';
import { createRoadmapRouter } from './roadmap.routes.js';

/**
 * The roadmap lane: the picture of what this host is building toward, and the nine words the operator
 * may say to it — the dispatcher lane's twin, kept as a module of its own because the roadmap is a
 * separate picture with its own cadence and its own consumers.
 *
 * The dispatcher is the roadmap's OWN owner, exactly as it is the plans': the store, the words each
 * row reads as, the names and the refusals are all its. NOTHING HERE WRITES ANY OF IT, and nothing here
 * decides a word. The lane reads one document (`dispatcher roadmap show --json`), validates it field
 * by field, serves it, and relays a closed set of dispatcher verbs by argv with words this server
 * spelled itself; the dispatcher's sentence travels back untouched. A write pressed on the screen
 * pokes the lane, so its frame goes out within moments instead of at the next tick.
 *
 * The composition root is the only place here that reads the environment, names a binary or touches
 * a socket; the services under it spawn the process, and take what they need as an argument.
 */

/** The dispatcher's entry point, unless the operator moved it (the dispatcher lane's own default). */
const DEFAULT_BIN = '~/.claude/scripts/dispatcher';

/**
 * The `PATH` a command runs with when this process has none of its own. The dispatcher's verbs wake a
 * daemon and arm calendar units, so they look up `systemctl --user` on `PATH`; the three directories
 * every login shell falls back to, stated rather than left empty so a lookup can succeed instead of
 * failing in a way that reads like the dispatcher's fault.
 */
const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * How often the document is read. `roadmap show` reads the store and no stage record, so it costs
 * about a fifth of a second on this host; two seconds is the dispatcher lane's own cadence, and a
 * write pressed on the screen does not wait for it (the poke).
 */
const POLL_MS = 2000;

/**
 * Wall-clock ceiling for one command, the read and the writes alike. A write may kick the daemon
 * before its process exits — seconds rather than milliseconds.
 */
const READ_TIMEOUT_MS = 20000;

/**
 * How long a read waits for this boot's first `dispatcher roadmap show --json`. Felt only when the
 * dispatcher is slow or wedged: a reader is owed an answer either way, and past the bound it is told
 * "not read yet" while the first landing's frame arrives on its own the moment it comes.
 */
const FIRST_READ_WAIT_MS = 5000;

/**
 * The lane's child environment: the server's own, minus the two names that say WHOSE SESSION a command
 * runs in. This server is nobody's Claude session, whatever shell it was started from, and the
 * dispatcher reads those names as exactly that: `accept` refuses inside a Claude session, and `tell`
 * writes the session it finds onto the outing it queues. A promote pressed on the screen is the
 * operator's own and queues a design owned by no session, which the app's own prompts reach.
 */
function laneEnv(): NodeJS.ProcessEnv {
  const env = userFacingEnv({ PATH: process.env.PATH ?? DEFAULT_PATH });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.DISPATCHER_SESSION;
  return env;
}

export type RoadmapModule = {
  router: Router;
  start(): void;
  stop(): void;
};

export function createRoadmapModule(): RoadmapModule {
  const dependencies = {
    bin: expandHome(process.env.DISPATCHER_BIN || DEFAULT_BIN),
    timeoutMs: READ_TIMEOUT_MS,
    env: laneEnv(),
  };

  /** Every frame this module's sockets carry: the roadmap's own picture, and nothing else. */
  const broadcast = (frame: RoadmapStateEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  /**
   * The lane's one door to the journal, and the one thing that bounds its volume: a read that fails
   * every two seconds would bury the journal in copies of one line, so each distinct message is
   * said once for the life of the process. A message that quotes the document's opening is never the
   * same twice (its `generated_at` moves), which is how a document past `ROADMAP_MAX_BUFFER` still
   * floods: the cure is the sentence's, in `dispatcher-command.ts`. This server has no logger; a
   * module that must say something takes a closure from its composition root.
   */
  const said = new Set<string>();
  const logErrorOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    console.error(`[Roadmap] ${message}`);
  };

  const watcher = createPolledLane<RoadmapPicture, RoadmapStateEvent>({
    // One subprocess, and the lane's own rules cover what it does with it: a tick that arrives while
    // this read is still out is SKIPPED, and a read that throws (another build's document, a store
    // mid-move) leaves the last good picture on the screen with one line in the journal.
    snapshot: () => readRoadmapState(dependencies),
    frame: (picture) => ({ kind: 'roadmap_state', ...picture, at: Date.now() }),
    // The read's own clock is stamped at second resolution on every read: compared whole, the
    // picture would differ from itself on every tick and the lane would speak on every one of them.
    // The frame still carries it (`frame` above), so this changes when the lane speaks, never what.
    serialize: (picture) => JSON.stringify({ ...picture, generated_at: undefined }),
    broadcast,
    pollMs: POLL_MS,
    logError: logErrorOnce,
  });

  const router = createRoadmapRouter({
    // A read waits, bounded, for this boot's first reading rather than being handed a picture nobody
    // has read; past the bound it is told so, and the landing's own frame fills the screen.
    current: () => watcher.whenLanded(FIRST_READ_WAIT_MS),
    relay: (act: RoadmapAct, argv: readonly string[], body: unknown) => relayRoadmapWrite(act, argv, body, dependencies),
    poke: () => watcher.poke(),
  });

  return {
    router,
    start: () => watcher.start(),
    stop: () => watcher.stop(),
  };
}
