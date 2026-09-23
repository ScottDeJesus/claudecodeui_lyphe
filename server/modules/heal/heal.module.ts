import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { createHealRouter } from './heal.routes.js';
import { createHealService } from './heal.service.js';

/**
 * The heal reflex's worker, unless the operator moved it. The env name is the runner-switch idiom
 * (`PLAN_RUNNER_BIN`): pointing a probe or a second install at a hermetic tree moves the worker and
 * this lane together rather than splitting them.
 *
 * Both halves are absolute from the start. A `~` in either is expanded here rather than left for the
 * spawn, because `spawn` does not know the tilde either and a path it cannot resolve is a worker
 * that never answers.
 */
const DEFAULT_BIN = path.join(os.homedir(), '.claude', 'scripts', 'heal-reflex');

/**
 * `~` expanded the way the shared helper does it, kept local on purpose: this module imports through
 * relative paths only, so the file type-checks under EITHER tree's config — `@/` means `server/` to
 * the build and `src/` to the repository root, and only one of those is this lane's neighbour.
 */
function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export type HealModule = { router: Router };

/**
 * Builds the heal lane for the server entrypoint: the six routes and the one worker behind them.
 *
 * This is the whole composition — no watcher, no timer, no socket. The reflex runs on its own, fired
 * by the harness's endings, and this lane is a window onto what it wrote plus a door to its verbs;
 * nothing here polls, because the client polls and the worker is spawned per request.
 *
 * The environment is read here and nowhere below it, which is what lets the lane be proven against a
 * scratch worker without a real ledger behind it.
 */
export function createHealModule(): HealModule {
  const bin = expandHome(process.env.HEAL_REFLEX_BIN || DEFAULT_BIN);
  const service = createHealService({ bin });

  return {
    router: createHealRouter({
      summary: () => service.summary(),
      kind: (kind) => service.kind(kind),
      ignore: () => service.ignore(),
      addIgnore: (tool, pattern, reason) => service.addIgnore(tool, pattern, reason),
      cycle: () => service.cycle(),
      stopCycle: () => service.stopCycle(),
    }),
  };
}
