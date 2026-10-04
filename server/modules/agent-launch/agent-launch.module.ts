import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { expandHome } from '@/shared/utils.js';
import type { AgentLaunchResolved, AgentLaunchResult } from '@/shared/types.js';

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
 * what lets the lane be proven against a scratch CLI without a real table behind it. The router and
 * `resolveLaunchSide` both ask through it, so the two never disagree about which CLI they run.
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
 * The model and effort a launch of `name` takes on one side of the DeepSeek switch, asked of the
 * same CLI the routes run. Never throws: a failed ask is a result the caller turns into its own refusal.
 */
export function resolveLaunchSide(
  name: string,
  side: AgentLaunchResolved['side'],
): Promise<AgentLaunchResult<AgentLaunchResolved>> {
  return launchService().resolveSide(name, side);
}
