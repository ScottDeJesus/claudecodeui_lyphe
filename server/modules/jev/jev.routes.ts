import express from 'express';

import type { JevFault, JevRange, JevResult, JevService } from './jev.service.js';

/**
 * The windows the reader tallies. A range is a token the reader itself knows, so the fence is a
 * closed set rather than a shape: anything outside it is refused before it can reach argv, which is
 * the one place a query string could otherwise become a flag.
 */
const RANGE = /^(today|7d|30d|all)$/;

/** The window the panel asks for when the caller names none: the last week, the panel's own default. */
const DEFAULT_RANGE: JevRange = '7d';

/** How many feed rows the panel gets when the caller names none, and the bounds a caller may name. */
const DEFAULT_FEED = 50;
const FEED_MIN = 0;
const FEED_MAX = 500;

/**
 * How a refused question becomes a status, in the shape of the heal lane's `STATUS_FOR_FAULT`.
 *
 * A refusal is not a server fault: the reader is a separate thing on this host, and each reason says
 * exactly which way it was separate. Turning one into a 200 with an empty body would replace the one
 * useful thing in the answer — that nothing was read — with silence the panel would show as data.
 */
const STATUS_FOR_FAULT: Record<JevFault, number> = {
  unreachable: 503,   // the reader is not on this host, or was torn down before it answered
  unreadable: 502,    // the reader answered, and not with the object its contract promises
};

/**
 * One answer, written: the value itself, or the reader's own sentence under the status its reason
 * earns. The sentence travels UNTOUCHED — it is the answer.
 */
function emit<T>(response: express.Response, answer: JevResult<T>): void {
  if (answer.ok) {
    response.json(answer.value);
    return;
  }
  response.status(STATUS_FOR_FAULT[answer.reason]).json({ error: answer.message });
}

/**
 * The requested window, or the default when none was named.
 *
 * `query` values are strings, arrays of them, or nested dictionaries, so a value that is not one
 * string names no window — `?range=a&range=b` is refused rather than silently read as its first
 * element. Returns `null` for a window that was named and is not one of the four.
 */
function range(value: unknown): JevRange | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && RANGE.test(value) ? (value as JevRange) : null;
}

/**
 * The requested feed length, or the default when none was named. A feed count is a plain decimal
 * integer: `5.5`, `-1`, `1e3` and an empty string are each refused rather than coerced, because a
 * coerced count is a number the panel shows that nobody asked for.
 */
function feed(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= FEED_MIN && count <= FEED_MAX ? count : null;
}

/**
 * The Jev lane's two routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: no store is opened here, no path is
 * named here, and no route hands the reader a string it did not first hold to a token shape. The
 * service owns the one transport, and it is a process — the reader's own command.
 */
export function createJevRouter(
  dependencies: Pick<JevService, 'summary' | 'clearCache'>,
): express.Router {
  const router = express.Router();

  /** One relayed question. A handler that answers itself — a malformed range, an out-of-range feed
   * — does so before calling this, and its own status stands. */
  const relay = <T>(operation: () => Promise<JevResult<T>>): express.RequestHandler =>
    async (_request, response, next) => {
      try {
        emit(response, await operation());
      } catch (error) {
        // The service resolves every fault it can name, so reaching here means something this lane
        // has no word for. It belongs to the app's error handler, not to a body of our own.
        next(error);
      }
    };

  /** The whole summary the panel reads, over one window at one feed length. */
  router.get('/summary', async (request, response, next) => {
    const requestedRange = range(request.query.range);
    if (requestedRange === null) {
      response.status(400).json({ error: 'range must be one of today, 7d, 30d, all' });
      return;
    }
    const requestedFeed = feed(request.query.feed);
    if (requestedFeed === null) {
      response.status(400).json({ error: `feed must be an integer between ${FEED_MIN} and ${FEED_MAX}` });
      return;
    }
    const window = requestedRange ?? DEFAULT_RANGE;
    const length = requestedFeed ?? DEFAULT_FEED;
    try {
      emit(response, await dependencies.summary(window, length));
    } catch (error) {
      next(error);
    }
  });

  /**
   * Clear the reader's own cache — the panel's one mutation, and the only door here that changes
   * anything. It runs the existing `cache clear` verb, so "clear the cache" keeps one home.
   */
  router.post('/cache/clear', relay(() => dependencies.clearCache()));

  return router;
}
