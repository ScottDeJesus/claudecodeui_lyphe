import type { Router } from 'express';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import { SETTLE_MS, createSettledCall } from '@/shared/settled-call.service.js';
import type { UniverseActivityEvent, UniverseMapEvent } from '@/shared/types.js';

import { createActivityCoalescer } from './universe-activity.service.js';
import { createUniverseCrawlService } from './universe-crawl.service.js';
import { readHeads } from './universe-heads.service.js';
import { createHeadsWatch } from './universe-heads.watch.js';
import { createJournalTap } from './universe-journal.tap.js';
import { createUniverseMapService } from './universe-map.service.js';
import { readRegistry } from './universe-registry.service.js';
import { universeReposPath } from './universe-state.service.js';
import { createUniverseRouter } from './universe.routes.js';
import { createTranscriptTap } from './universe-transcript.tap.js';

/**
 * How long a crawl that did not land waits before the map is judged again.
 *
 * A failed or refused crawl leaves the map stale, and nothing on disk will announce that the crawler can
 * now succeed (a source that was unreadable, a slot that was busy). So that one answer arms one more
 * judgement this much later: a deadline set by a failure, not a tick — a map that is fresh arms nothing.
 */
const CRAWL_RETRY_MS = 30_000;

export type UniverseModule = {
  router: Router;
  start(): void;
  stop(): void;
};

/**
 * Builds the universe lane for the server entrypoint: the held map, the one route that serves it,
 * and the watcher that hears a repo's HEAD move and announces the new map over the socket.
 *
 * The watcher is the files git keeps each HEAD in, watched (`universe-heads.watch.ts`): a commit, a
 * checkout or a `gc` renames one of them into place, the watch hears it, and the burst settles
 * (`SETTLE_MS`) into one `reconcile`. It is NOT the shared poll lane (`shared/polled-lane.service.ts`),
 * and the difference is not taste: that lane's contract is a `snapshot()` that is cheap and never
 * throws, and what this lane must do on a change is shell a crawler and wait for it. A snapshot that
 * launches a command is a command inside a query. So the judgement is written out here: read the
 * heads, compare, and only on a real change await the crawl and broadcast.
 *
 * The frame goes out over `connectedClients` — every open `/ws` socket — and not over the raw
 * `wss.clients` set, for the reason `dispatch-souls.module.ts` gives: the other sockets on this
 * server would parse it and drop it, or hand it to a plugin frontend with no business seeing it.
 */
export function createUniverseModule(): UniverseModule {
  const map = createUniverseMapService();
  const crawl = createUniverseCrawlService();

  /**
   * Where the readers report. Deliberately NOT the once-per-message throttle the souls lane
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

  /** Whether `start()` has run and `stop()` has not. */
  let started = false;
  /** One `reconcile` at a time; a move that settles while one runs makes it run once more. */
  let reconciling = false;
  let reconcileAgain = false;
  /** The one pending judgement after a crawl that did not land, or `null`. */
  let crawlRetry: NodeJS.Timeout | null = null;

  const armCrawlRetry = (): void => {
    if (crawlRetry !== null || !started) return;
    crawlRetry = setTimeout(() => {
      crawlRetry = null;
      void reconcileSerially();
    }, CRAWL_RETRY_MS);
    crawlRetry.unref();
  };

  /**
   * One judgement: is the held map built from the heads these repos have now, and if not, does a
   * crawl fix that.
   *
   * The comparison is against the MAP and not against the last event this watch happened to hear,
   * and that is the whole of the watcher's honesty. A map is stale exactly when the heads it was
   * built from are no longer the repos' heads — a fact on disk — so a process that has just booted
   * makes the same judgement as one that has been up for a month: a map built before its last
   * restart is stale and gets rebuilt, and a fresh one announces nothing. A HEAD move that lands
   * while a crawl is in flight is not lost either: its settled move asks for another run, which
   * `reconcileSerially` makes once this one ends, and the held map still carries the old sha.
   */
  const reconcile = async (): Promise<void> => {
    // A repo whose HEAD cannot be read is not news about itself — there is nothing to crawl either —
    // so it is left out rather than counted as a difference forever. A repo that appears in the
    // registry and NOT in the map is the opposite case and does count: that is what makes adding one
    // entry to `repos.json` rebuild the map with the new galaxy in it. And a map with nothing in it is
    // stale by definition — no crawl has ever landed — so it gets built.
    const live = Object.entries(readHeads()).filter((entry): entry is [string, string] => entry[1] !== null);
    const built = new Map(map.currentMap().repos.map((repo) => [repo.id, repo.head]));
    const moved = live.filter(([id, sha]) => built.get(id) !== sha).map(([id]) => id);

    if (built.size > 0 && moved.length === 0) return;

    // `null` is "nothing landed" — already running, timed out, or failed — and the line saying why
    // is the crawl service's. The map stays held, and stays stale, so one judgement is armed for later.
    if ((await crawl.rebuild(false)) === null) {
      armCrawlRetry();
      return;
    }

    // The frame's `mapId` is the HELD map's, not the crawl's answer: it is what the next GET of
    // `/api/universe/map` will serve, and a client that refetches on this frame has to find the map
    // it was told about. They agree in every ordinary case — a crawl that lands is what `reload()`
    // adopts.
    const fresh = map.reload();
    console.log(`[Universe] map ${fresh.mapId} rebuilt: ${built.size === 0 ? 'no map was held' : `HEAD moved in ${moved.join(', ')}`}`);
    broadcast({ kind: 'universe_map', mapId: fresh.mapId, builtAt: fresh.builtAt, at: Date.now() });
  };

  const reconcileSerially = async (): Promise<void> => {
    if (reconciling) {
      reconcileAgain = true;
      return;
    }
    reconciling = true;
    try {
      do {
        reconcileAgain = false;
        await reconcile();
      } while (reconcileAgain && started);
    } catch (error) {
      logError(`[Universe] reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reconciling = false;
    }
  };

  const settledMove = createSettledCall({
    run: () => {
      void reconcileSerially();
    },
    settleMs: SETTLE_MS,
  });

  const heads = createHeadsWatch({
    registryFile: universeReposPath(),
    repos: () => readRegistry().map(({ id, path }) => ({ id, path })),
    onMove: () => settledMove.request(),
    logError,
  });

  return {
    router: createUniverseRouter({ currentMap: () => map.currentMap() }),

    start: () => {
      if (started) return;
      started = true;
      // The watch is armed before the first judgement, so a HEAD that moves during it is heard.
      heads.start();
      void reconcileSerially();

      // The taps and the window they feed. Started after the server is listening, with the watcher:
      // what they produce is for sockets this process can only now accept, and a tap that ran before
      // that would spend its first seconds pushing rows nobody could receive.
      journal.start();
      transcript.start();
      activity.start();
    },

    stop: () => {
      if (!started) return;
      started = false;
      heads.stop();
      settledMove.cancel();
      if (crawlRetry !== null) clearTimeout(crawlRetry);
      crawlRetry = null;

      // The journal child is the one thing here that outlives this process if it is not killed, and
      // the reason `stop()` is called on the shutdown path rather than left to the operating system.
      journal.stop();
      transcript.stop();
      activity.stop();
    },
  };
}
