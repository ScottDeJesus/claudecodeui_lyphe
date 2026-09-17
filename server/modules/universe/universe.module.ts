import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { UniverseActivityEvent, UniverseMapEvent } from '@/shared/types.js';

import { createActivityCoalescer } from './universe-activity.service.js';
import { createUniverseCrawlService } from './universe-crawl.service.js';
import { readHeads } from './universe-heads.service.js';
import { createJournalTap } from './universe-journal.tap.js';
import { createUniverseMapService } from './universe-map.service.js';
import { readRegistry } from './universe-registry.service.js';
import { createUniverseRouter } from './universe.routes.js';
import { createTranscriptTap } from './universe-transcript.tap.js';

/**
 * How often the four repos' HEADs are read, in milliseconds.
 *
 * Compared against what the held map was built from, so this is the cost of the estate being quiet:
 * eight small file reads (a HEAD and a ref per repo) every thirty seconds, on the main thread, which
 * is why they are reads and not `git rev-parse` subprocesses. A HEAD that moves mid-interval is not
 * missed — the next tick sees it, and thirty seconds is well inside the time a client takes to
 * refetch a 1.4 MB map anyway.
 */
const HEADS_INTERVAL_MS = 30000;

export type UniverseModule = {
  router: Router;
  start(): void;
  stop(): void;
};

/**
 * Builds the universe lane for the server entrypoint: the held map, the one route that serves it,
 * and the watcher that notices a repo's HEAD moved and announces the new map over the socket.
 *
 * The watcher is a plain interval over `readHeads()` and NOT the shared poll lane
 * (`shared/polled-lane.service.ts`), and the difference is not taste. That lane's whole contract is
 * a `snapshot()` that is cheap and never throws, so it can run on every tick of every lane — and
 * what this lane must do on a change is shell a crawler and wait for it. A snapshot that launches a
 * command is a command inside a query; the lane would fire it on a cadence nobody chose, and a
 * crawl slower than the tick would stack. So the interval is written out here: read the heads,
 * compare, and only on a real change await the crawl and broadcast.
 *
 * The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
 * `wss.clients` set, for the reason `dispatch-souls.module.ts` gives: the other sockets on this
 * server would parse it and drop it, or hand it to a plugin frontend with no business seeing it.
 */
export function createUniverseModule(): UniverseModule {
  const map = createUniverseMapService();
  const crawl = createUniverseCrawlService();

  /**
   * Where the two readers report. Deliberately NOT the once-per-message throttle the souls lane
   * uses: each tap bounds its own repetition — the journal tap per distinct reason (re-armed by a
   * live line), the transcript tail per file — and a floor above them would be a second, weaker
   * throttle that silently swallows the first failure after a recovery.
   */
  const logError = (message: string): void => console.error(message);

  /** Both of this lane's frames go the same way, so one sender carries them. */
  const broadcast = (frame: UniverseMapEvent | UniverseActivityEvent): void => {
    const message = JSON.stringify(frame);
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(message);
    });
  };

  const activity = createActivityCoalescer({ broadcast, mapId: () => map.mapId() });

  /** Tap 1: the estate's journal, and Tap 2: the Claude transcripts, each feeding the same window. */
  const journal = createJournalTap({ registry: readRegistry, map, push: activity.push, logError });
  const transcript = createTranscriptTap({ map, push: activity.push, logError });

  /** The watcher's one piece of state: the interval, or `null` while it is not running. */
  let timer: NodeJS.Timeout | null = null;

  /**
   * One tick: is the held map built from the heads these repos have now, and if not, does a crawl
   * fix that.
   *
   * The comparison is against the MAP and not against the last thing this timer happened to see,
   * and that is the whole of the watcher's honesty. A map is stale exactly when the heads it was
   * built from are no longer the repos' heads — a fact on disk — so a process that has just booted
   * makes the same judgement as one that has been up for a month: a map built before its last
   * restart is stale and gets rebuilt, and a fresh one announces nothing, however many times the
   * interval ticks. It also means a HEAD move that lands while a crawl is in flight is retried on
   * the next tick rather than consumed: the held map still carries the old sha until a crawl lands,
   * so the difference is still there to be seen. A crawl that does not land is likewise retried,
   * which is what lets a source that failed come back; the crawl service's in-flight guard, not this
   * timer, is what keeps a slow crawl from stacking.
   */
  const reconcile = async (): Promise<void> => {
    // A repo whose HEAD cannot be read is not news about itself — there is nothing to crawl either —
    // so it is left out rather than counted as a difference on every tick forever. A repo that
    // appears in the registry and NOT in the map is the opposite case and does count: that is what
    // makes adding one entry to `repos.json` rebuild the map with the new galaxy in it. And a map
    // with nothing in it is stale by definition — no crawl has ever landed — so it gets built.
    const live = Object.entries(readHeads()).filter((entry): entry is [string, string] => entry[1] !== null);
    const built = new Map(map.currentMap().repos.map((repo) => [repo.id, repo.head]));

    if (built.size > 0 && !live.some(([id, sha]) => built.get(id) !== sha)) return;

    // `null` is "nothing landed" — already running, timed out, or failed — and the line saying why
    // is the crawl service's. Leaving the map held is the right answer to all three: the next tick
    // asks the same question again.
    if ((await crawl.rebuild(false)) === null) return;

    // The frame's `mapId` is the HELD map's, not the crawl's answer: it is what the next GET of
    // `/api/universe/map` will serve, and a client that refetches on this frame has to find the map
    // it was told about. They agree in every ordinary case — a crawl that lands is what `reload()`
    // adopts.
    const fresh = map.reload();
    broadcast({ kind: 'universe_map', mapId: fresh.mapId, builtAt: fresh.builtAt, at: Date.now() });
  };

  return {
    router: createUniverseRouter({ currentMap: () => map.currentMap() }),

    start: () => {
      if (timer !== null) return;
      // Unreferenced: watching HEADs is not a reason for this process to stay alive, and a dev
      // supervisor's handover must be able to retire a server that is only holding a route.
      timer = setInterval(() => {
        void reconcile();
      }, HEADS_INTERVAL_MS);
      timer.unref();

      // The taps and the window they feed. Started after the server is listening, with the watcher:
      // what they produce is for sockets this process can only now accept, and a tap that ran before
      // that would spend its first seconds pushing rows nobody could receive.
      journal.start();
      transcript.start();
      activity.start();
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;

      // The journal child is the one thing here that outlives this process if it is not killed, and
      // the reason `stop()` is called on the shutdown path rather than left to the operating system.
      journal.stop();
      transcript.stop();
      activity.stop();
    },
  };
}
