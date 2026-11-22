import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import type { AgentLaunchResult } from '@/shared/types.js';
import { expandHome } from '@/shared/utils.js';

import { createAgentLaunchRouter } from './agent-launch.routes.js';
import { createAgentLaunchService, type AgentLaunchService } from './agent-launch.service.js';

/**
 * The launch table's CLI, unless the operator moved it. The env name is the runner-switch idiom
 * (`PLAN_RUNNER_BIN`, `HEAL_REFLEX_BIN`): pointing a probe or a second install at a hermetic tree
 * moves the CLI and this lane together rather than splitting them. A `~` is expanded here rather
 * than left for the spawn, because `execFile` does not know the tilde either and a path it cannot
 * resolve is a CLI that never answers.
 */
const DEFAULT_BIN = path.join(os.homedir(), '.claude', 'scripts', 'launch-table');

export type AgentLaunchModule = { router: Router };

/**
 * The one service, built on first use. The environment is read here and nowhere below it, which is
 * what lets the lane be proven against a scratch CLI without a real table behind it. The router asks through it.
 */
let service: AgentLaunchService | null = null;

function launchService(): AgentLaunchService {
  service ??= createAgentLaunchService({
    bin: expandHome(process.env.LAUNCH_TABLE_BIN || DEFAULT_BIN),
  });
  return service;
}

/**
 * Builds the agent-launch lane for the server entrypoint: the three routes and the one CLI behind them.
 *
 * This is the whole composition — no watcher, no timer, no socket. The table changes when the
 * operator presses a save in Settings → Agents → Edit Agent Chains or edits the file by hand, and the CLI is spawned per
 * request; nothing here polls, because the client reads when it opens and after each save.
 */
export function createAgentLaunchModule(): AgentLaunchModule {
  return { router: createAgentLaunchRouter(launchService()) };
}

/**
 * One launch-table row's Claude side as a launch would read it now, through the same CLI door the routes use. The R&D
 * spike route asks `rnd.spike` here for the model its chat starts on, so the table stays the one home of that word.
 */
export function resolveLaunchRow(name: string): Promise<AgentLaunchResult<Record<string, unknown>>> {
  return launchService().resolve(name, 'claude');
}
