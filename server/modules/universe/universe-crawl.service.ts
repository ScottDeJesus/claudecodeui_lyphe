import { execFile } from 'node:child_process';

import { expandHome } from '@/shared/utils.js';

/**
 * The crawl, invoked.
 *
 * The crawler is a Python process that walks four repos and rewrites the map, so this is run as a
 * CHILD and never inline: it is a command whose length is the estate's, and the event loop carrying
 * every chat websocket in the app is not where it belongs. One at a time, too — two crawlers would
 * race on the same output files, and the second would be doing the first's work — which is why the
 * in-flight guard lives HERE and not with the caller: a caller who forgets it is a caller who
 * starts a second crawl.
 */

/** The crawler, unless the operator moved it. The wrapper at this path is the crawler's own entry point. */
const DEFAULT_BIN = '~/.claude/scripts/universe-crawl';

/**
 * Ceiling for one crawl. A full re-crawl of the estate is seconds; this is three minutes, which is
 * far past any honest crawl and short enough that a wedged child does not hold the lane's only
 * crawl slot until the process restarts.
 */
const CRAWL_TIMEOUT_MS = 180_000;

/**
 * Ceiling on what the child may say. The crawler's one summary line does not approach this; the
 * warnings it prints per repo are unbounded in principle, and a child that overruns its buffer is
 * killed rather than allowed to grow the server's heap.
 */
const CRAWL_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

/**
 * The crawl's own summary line — `mapId <12 hex> repos <n> warnings <n>` (`scripts/universe/cli.py`).
 *
 * Read from stdout rather than from `index.json` on disk, because that line is the crawler's
 * declared answer to "what did you just build" and the file is its working state: asking the file
 * would mean this service also knowing the state layout, and reading a map the child had not yet
 * finished writing.
 */
const MAP_ID_LINE = /^mapId ([0-9a-f]{12})\b/m;

export type UniverseCrawlService = {
  /**
   * Crawls and resolves with the new `mapId`, or with `null` when the crawl did not land — already
   * running, timed out, exited non-zero, or answered without a map id. `null` and only `null` means
   * "no new map"; the reason it failed is on the log line this lane wrote for it. Never rejects.
   */
  rebuild(full: boolean): Promise<string | null>;
};

export function createUniverseCrawlService(): UniverseCrawlService {
  const binary = expandHome(process.env.UNIVERSE_CRAWL_BIN || DEFAULT_BIN);

  /** The crawl in flight, or `null`. Also the guard: a non-null value refuses every new start. */
  let inFlight: Promise<string | null> | null = null;

  const runCrawl = (full: boolean): Promise<string | null> =>
    new Promise((resolve) => {
      const args = full ? ['build', '--full'] : ['build'];
      execFile(
        binary,
        args,
        { timeout: CRAWL_TIMEOUT_MS, maxBuffer: CRAWL_MAX_BUFFER_BYTES, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error) {
            // A killed child (the timeout) and a failed one arrive here the same way; the signal
            // says which. Either way nothing landed, and the caller's map is still the held one.
            const detail = error.killed ? `killed after ${CRAWL_TIMEOUT_MS / 1000} s` : error.message;
            console.error(`[Universe] crawl failed: ${detail}${stderr.trim() ? ` — ${stderr.trim()}` : ''}`);
            resolve(null);
            return;
          }
          const mapId = MAP_ID_LINE.exec(stdout)?.[1];
          if (mapId === undefined) {
            console.error(`[Universe] crawl printed no map id: ${stdout.trim() || '(no output)'}`);
            resolve(null);
            return;
          }
          if (stderr.trim()) console.error(`[Universe] crawl warnings: ${stderr.trim()}`);
          resolve(mapId);
        },
      );
    });

  return {
    rebuild: (full) => {
      if (inFlight !== null) {
        console.error('[Universe] a crawl is already running; this rebuild was refused rather than stacked');
        return Promise.resolve(null);
      }
      // Clear the slot when the crawl settles, before any caller's continuation runs, so the next
      // rebuild is accepted the moment this one is over.
      inFlight = runCrawl(full).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
