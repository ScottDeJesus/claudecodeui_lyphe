import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { broadcastToAll } from '@/modules/websocket/index.js';
import { createFileLane, createPacedHint } from '@/shared/index.js';


import { createHealRouter } from './heal.routes.js';
import { createHealService, type HealService } from './heal.service.js';

/** The reflex's ledger, the name its own `db_path()` honours, unless moved with `HEAL_LEDGER_PATH`. */
const DEFAULT_LEDGER = '~/.claude/state/heal_reflex/friction.db';

/**
 * At most one `heal_changed` a minute: the ledger moves when an ending indexes or a chain lands, and
 * each frame costs every open tab one summary process.
 */
const HEAL_HINT_GAP_MS = 60_000;

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

/**
 * What `createHealModule` hands the server entrypoint: the router to mount and the lane's one `service` (its
 * `summary` and `kind`, through the worker `HEAL_REFLEX_BIN` names). The entrypoint passes `service` on to the
 * companion's house (`CompanionHouse.heal`), so her `read_heal` and `list_alerts` read the heal summary through the
 * same worker and its one binary rule.
 */
export type HealModule = { router: Router; service: HealService };

/**
 * Builds the heal lane for the server entrypoint: the seven routes and the one worker behind them.
 *
 * Beside the routes it arms one thing: a watch on the ledger's directory whose commits tell a paced
 * hint, which sends `heal_changed` to every socket through `broadcastToAll` — at most one frame a
 * minute, the gap kept by one unref'd timer armed only by a commit. The reflex runs on its own, fired
 * by events outside this server — the harness's endings, a heal walker's exit, and the nightly slot's
 * systemd calendar unit — and this lane is a window onto what it wrote plus a door to its verbs;
 * the worker is spawned per request, and a tab reads again when the frame tells it.
 *
 * The environment is read here and nowhere below it, which is what lets the lane be proven against a
 * scratch worker without a real ledger behind it.
 */
export function createHealModule(): HealModule {
  const bin = expandHome(process.env.HEAL_REFLEX_BIN || DEFAULT_BIN);
  const service = createHealService({ bin });
  startLedgerHint(expandHome(process.env.HEAL_LEDGER_PATH || DEFAULT_LEDGER));

  return {
    service,
    router: createHealRouter({
      summary: () => service.summary(),
      kind: (kind) => service.kind(kind),
      sessions: (ids) => service.sessions(ids),
      ignore: () => service.ignore(),
      addIgnore: (tool, pattern, reason) => service.addIgnore(tool, pattern, reason),
      cycle: () => service.cycle(),
      stopCycle: () => service.stopCycle(),
    }),
  };
}

/**
 * Arms the ledger's watch. Only a CHANGE of the database or its WAL is news: every reader that opens
 * the ledger creates and removes the WAL, and only a commit writes to it.
 */
function startLedgerHint(ledgerPath: string): void {
  const hint = createPacedHint({ kind: 'heal_changed', minGapMs: HEAL_HINT_GAP_MS, send: broadcastToAll });
  const ledgerName = path.basename(ledgerPath);
  const watched = new Set([ledgerName, `${ledgerName}-wal`]);
  createFileLane({
    dir: path.dirname(ledgerPath),
    names: watched,
    changeOnly: watched,
    tell: () => hint.tell(),
    logError: (message) => console.error(`[heal] ${message}`),
  }).start();
}
