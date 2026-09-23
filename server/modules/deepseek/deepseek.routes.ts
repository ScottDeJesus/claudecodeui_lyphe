import express from 'express';

import type {
  DeepseekUsageFault,
  DeepseekUsageRange,
  DeepseekUsageResult,
  DeepseekUsageService,
} from './deepseek-usage.service.js';
import type { createDeepseekService } from './deepseek.service.js';

/**
 * The windows the ledger's reader tallies. A range is a token the reader itself knows, so the fence
 * is a closed set rather than a shape: anything outside it is refused before it can reach argv,
 * which is the one place a query string could otherwise become a flag.
 */
const RANGE = /^(today|7d|30d|all)$/;

/**
 * The window asked for when the caller names none: the day in progress, which is the question the
 * spend view exists to answer first.
 */
const DEFAULT_RANGE: DeepseekUsageRange = 'today';

/** How many feed rows the view gets when the caller names none, and the bounds a caller may name. */
const DEFAULT_FEED = 50;
const FEED_MIN = 0;
const FEED_MAX = 500;

/**
 * How a refused question becomes a status, in the shape of the Jev lane's `STATUS_FOR_FAULT`.
 *
 * A refusal is not a server fault: the reader is a separate thing on this host, and each reason says
 * exactly which way it was separate. Turning one into a 200 with an empty body would replace the one
 * useful thing in the answer — that nothing was read — with silence the view would draw as data.
 */
const STATUS_FOR_FAULT: Record<DeepseekUsageFault, number> = {
  unreachable: 503,   // the reader is not on this host, or was torn down before it answered
  unreadable: 502,    // the reader answered, and not with the object its contract promises
};

/**
 * One answer, written: the value itself, or the reader's own sentence under the status its reason
 * earns. The sentence travels UNTOUCHED — it is the answer.
 */
function emit(response: express.Response, answer: DeepseekUsageResult): void {
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
function range(value: unknown): DeepseekUsageRange | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && RANGE.test(value) ? (value as DeepseekUsageRange) : null;
}

/**
 * The requested feed length, or the default when none was named. A feed count is a plain decimal
 * integer: `5.5`, `-1`, `1e3` and an empty string are each refused rather than coerced, because a
 * coerced count is a number the view shows that nobody asked for.
 */
function feed(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= FEED_MIN && count <= FEED_MAX ? count : null;
}

/**
 * Creates the DeepSeek routes for `deepseek.module.ts`: the account's balance, and the ledger's own
 * usage reading beside it.
 *
 * Both handlers validate and translate, and do nothing else: no store is opened here, no path is
 * named here, no child is started here, and no route hands the reader a string it did not first hold
 * to a token shape. The service owns the one transport, and it is a process — the reader's own
 * command.
 */
export function createDeepseekRouter(
  deepseekService: ReturnType<typeof createDeepseekService>,
  usageService: DeepseekUsageService,
): express.Router {
  const router = express.Router();

  router.get('/balance', async (_request, response, next) => {
    try {
      response.json(await deepseekService.balance());
    } catch (error) {
      next(error);
    }
  });

  /**
   * The ledger's whole usage reading over one window at one feed length.
   *
   * A malformed window or feed is answered HERE — before the reader is asked, and with the one
   * status that says the question was wrong rather than the answer — so a crafted query can never
   * reach argv at all.
   */
  router.get('/usage', async (request, response, next) => {
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
    try {
      emit(
        response,
        await usageService.usage(requestedRange ?? DEFAULT_RANGE, requestedFeed ?? DEFAULT_FEED),
      );
    } catch (error) {
      // The service resolves every fault it can name, so reaching here means something this lane has
      // no word for. It belongs to the app's error handler, not to a body of our own.
      next(error);
    }
  });

  return router;
}
