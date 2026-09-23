import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { createJevRouter } from './jev.routes.js';
import { createJevService } from './jev.service.js';

/**
 * The Jev reader, unless the operator moved it. The env name is the runner-switch idiom
 * (`HEAL_REFLEX_BIN`): pointing a probe or a second install at a hermetic tree moves the reader and
 * this lane together rather than splitting them.
 *
 * Both halves are absolute from the start. A `~` in either is expanded here rather than left for the
 * spawn, because the spawn does not know the tilde either and a path it cannot resolve is a reader
 * that never answers.
 */
const DEFAULT_BIN = path.join(os.homedir(), '.claude', 'scripts', 'jev');

/**
 * `~` expanded the way the shared helper does it, kept local on purpose: this module imports through
 * relative paths only, so the file type-checks under EITHER tree's config — `@/` means `server/` to
 * the build and `src/` to the repository root, and only one of those is this lane's neighbour.
 */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export type JevModule = { router: Router };

/**
 * Builds the Jev lane for the server entrypoint: the two routes and the one reader behind them.
 *
 * This is the whole composition — no watcher, no timer, no socket. The reader runs per request, and
 * nothing here caches its answer between polls: the read costs about 0.1 s, and a cache would be a
 * staleness bug whose cure belongs in the reader that already owns the data (never in this lane).
 *
 * The environment is read HERE and nowhere below it, which is what lets the lane be proven against a
 * scratch reader — a caller that sets `JEV_BIN` before calling this gets the reader it named.
 */
export function createJevModule(): JevModule {
  const bin = expandHome(process.env.JEV_BIN || DEFAULT_BIN);
  const service = createJevService({ bin });

  return {
    router: createJevRouter({
      summary: (range, feed) => service.summary(range, feed),
      clearCache: () => service.clearCache(),
    }),
  };
}
