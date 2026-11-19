import express from 'express';

import { firstLine, runDispatcherCommand, type CommandDependencies } from '@/modules/dispatcher/index.js';

/** The dispatcher's command, composed once by the module root (`kanban-dispatch.module.ts`), so this router reads no environment. */
export type KanbanDispatchRouterDependencies = { commands: CommandDependencies };

/** Bounds `card_config` holds the two numbers to; checked here too so a bad request is a 400 and never reaches the dispatcher. */
const WIDTH_MIN = 1;
const WIDTH_MAX = 4;
const THRESHOLD_MIN = 0.5;
const THRESHOLD_MAX = 0.99;

/** Dispatcher exit codes: 0 printed a stored config, 2 refused the value. */
const EXIT_OK = 0;
const EXIT_REFUSED = 2;
const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_BAD_GATEWAY = 502;

type CardConfig = { width: number; threshold: number };
type CommandOutput = { exit: number | null; stdout: string; stderr: string };

/** Only plain JSON objects can carry the named fields; arrays and null cannot. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only two finite numbers count as a config; anything else is unreadable and must never reach the settings screen. */
function configOf(printed: string): CardConfig | null {
  try {
    const parsed: unknown = JSON.parse(printed);
    if (!isRecord(parsed)) return null;
    const { width, threshold } = parsed;
    if (typeof width !== 'number' || typeof threshold !== 'number') return null;
    return Number.isFinite(width) && Number.isFinite(threshold) ? { width, threshold } : null;
  } catch (error) {
    console.error(`kanban-dispatch: card config reply was not JSON: ${String(error)}`);
    return null;
  }
}

/** A 502 must say whether the dispatcher exited or never answered, so the operator knows which to chase. */
function dispatcherFailure(result: CommandOutput): string {
  const how = result.exit === null ? 'did not answer' : `exited ${result.exit}`;
  const detail = firstLine(result.stderr) || firstLine(result.stdout) || 'printed nothing it could read';
  return `dispatcher card config ${how}: ${detail}`;
}

/**
 * Maps the dispatcher's answer onto HTTP: a refusal is the caller's mistake, a readable config is a success, and anything else is the dispatcher failing.
 */
async function relay(dependencies: KanbanDispatchRouterDependencies, args: string[], response: express.Response): Promise<void> {
  const result = await runDispatcherCommand(dependencies.commands, ['card', 'config', ...args, '--json']);
  if (result.exit === EXIT_REFUSED) {
    response.status(STATUS_BAD_REQUEST).json({ error: firstLine(result.stdout) });
    return;
  }
  const config = result.exit === EXIT_OK ? configOf(result.stdout) : null;
  if (config) {
    response.status(STATUS_OK).json(config);
    return;
  }
  response.status(STATUS_BAD_GATEWAY).json({ error: dispatcherFailure(result) });
}

/** The dispatcher refuses any width outside these bounds, so the router checks first and the refusal becomes this request's 400. */
function isWidth(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= WIDTH_MIN && value <= WIDTH_MAX;
}

/** Same reasoning as the width check: out-of-bounds thresholds are rejected here, not by the dispatcher. */
function isThreshold(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= THRESHOLD_MIN && value <= THRESHOLD_MAX;
}

/** A field left out is not a fault, so one request may change just one number; a field sent with a bad value is. */
function settingsProblem(body: Record<string, unknown>): string | null {
  const { width, threshold } = body;
  if (width === undefined && threshold === undefined) return 'name width, threshold or both';
  if (width !== undefined && !isWidth(width)) return 'width must be a whole number from 1 to 4';
  if (threshold !== undefined && !isThreshold(threshold)) return 'threshold must be a number from 0.50 to 0.99';
  return null;
}

/** Only fields the caller sent become flags; the rest of the config stays as the dispatcher holds it. */
function flagsFor(body: Record<string, unknown>): string[] {
  const { width, threshold } = body;
  const flags: string[] = [];
  if (typeof width === 'number') flags.push('--width', String(width));
  if (typeof threshold === 'number') flags.push('--threshold', String(threshold));
  return flags;
}

/**
 * Builds the card-config router. It keeps no state and writes no file, because the dispatcher is the config's one writer; this router only relays.
 */
export function createKanbanDispatchRouter(dependencies: KanbanDispatchRouterDependencies): express.Router {
  const router = express.Router();

  router.get('/settings', async (_request, response, next) => {
    try {
      await relay(dependencies, [], response);
    } catch (error) {
      next(error);
    }
  });

  router.put('/settings', async (request, response, next) => {
    try {
      const body: unknown = request.body;
      if (!isRecord(body)) {
        response.status(STATUS_BAD_REQUEST).json({ error: 'the body must be a JSON object' });
        return;
      }
      const problem = settingsProblem(body);
      if (problem) {
        response.status(STATUS_BAD_REQUEST).json({ error: problem });
        return;
      }
      await relay(dependencies, flagsFor(body), response);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
