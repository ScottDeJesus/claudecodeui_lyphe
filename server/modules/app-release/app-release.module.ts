import { Router } from 'express';

import { broadcastToAll } from '@/modules/websocket/index.js';
import { createPolledLane } from '@/shared/polled-lane.service.js';

import { readLatestRelease } from './app-release.service.js';

/** The repository whose releases the app offers as updates, unless `APP_RELEASE_REPO` names another. */
const DEFAULT_RELEASE_REPO = 'siteboon/claudecodeui';
/**
 * The one clock here, a decision: GitHub offers a release webhook only to a public URL this server
 * does not have, so the newest release is asked for. Every six hours, because a release lands a few
 * times a month; the interval paces SUCCESSFUL reads only (a failed one is retried sooner, below).
 */
const RELEASE_POLL_MS = 21_600_000;
/**
 * A failed read (a 502, an unauthenticated rate limit, the timeout) is retried after this long, the
 * wait doubling on each failure up to RELEASE_RETRY_MAX_MS and reset by a success: left to the
 * interval, one bad answer at boot would keep the update notice dark for six hours.
 */
const RELEASE_RETRY_FIRST_MS = 30_000;
const RELEASE_RETRY_MAX_MS = 1_800_000;
/** How long a request waits for this boot's first reading before it is told none has landed. */
const FIRST_READ_WAIT_MS = 5_000;
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Builds the app-release lane for the server entrypoint: one read of the newest release per host,
 * sent to every open tab as `app_release_state` when it changes, and GET / answering the last one.
 *
 * The environment is read HERE and nowhere below it; a slug that is not `owner/name` stops the boot,
 * because it would otherwise become part of a URL.
 */
export function createAppReleaseModule(): Router {
  const repo = process.env.APP_RELEASE_REPO || DEFAULT_RELEASE_REPO;
  if (!REPO_SLUG.test(repo)) {
    throw new Error(`APP_RELEASE_REPO must be owner/name, got ${JSON.stringify(repo)}`);
  }

  // One retry timer at a time, armed by a failed read and firing once: it pokes the lane, whose
  // ordinary tick reads again (and arms the next retry if that read fails too).
  let retryDelayMs = RELEASE_RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const armRetry = (): void => {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      lane.poke();
    }, retryDelayMs);
    retryTimer.unref();
    retryDelayMs = Math.min(retryDelayMs * 2, RELEASE_RETRY_MAX_MS);
  };
  const readReleaseOrArmRetry = async () => {
    try {
      const release = await readLatestRelease(repo);
      retryDelayMs = RELEASE_RETRY_FIRST_MS;
      return release;
    } catch (error) {
      armRetry();
      throw error;
    }
  };

  const lane = createPolledLane({
    pollMs: RELEASE_POLL_MS,
    snapshot: readReleaseOrArmRetry,
    frame: (release) => ({ kind: 'app_release_state', at: Date.now(), ...release }),
    broadcast: broadcastToAll,
    logError: (message) => console.error(`[app-release] ${message}`),
  });
  lane.start();

  const router = Router();
  router.get('/', async (_req, res) => {
    const reading = await lane.whenLanded(FIRST_READ_WAIT_MS);
    if (reading === null) {
      res.status(503).json({ error: 'The newest release has not been read yet' });
      return;
    }
    res.json(reading);
  });
  return router;
}
