import express from 'express';

import type { AgentLaunchDefaultsChange, AgentLaunchResult, AgentLaunchRowChange } from '@/shared/types.js';

import type { AgentLaunchService } from './agent-launch.service.js';

/**
 * A row's name as the CLI takes one: a soul's slug or `metis`, the shape `~/.claude/agents/<name>.md`
 * and the table's `[soul.<slug>]` share. It is NOT a whitelist of the souls that exist — a new soul
 * must not need an edit here — and the CLI answers a name it does not know in its own sentence.
 */
const ROW_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What a model word, an effort word or a model key may look like. This is a TOKEN fence and not the
 * vocabulary — which words the table accepts is Python's to say, and it says so in a sentence the
 * window shows. The fence exists because these strings become argv, and a word that begins with `-`
 * would be read by the CLI's parser as one of its own flags instead of as this flag's value.
 */
const WORD = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/**
 * How many models one `effort` map may name. Every entry becomes argv, and the table's vocabulary has
 * a handful of models, so this is a generous transport bound, not the vocabulary: without one, a body
 * of tens of thousands of shape-valid keys would overrun the OS's argv limit and be answered as a CLI
 * that could not be asked, blaming the CLI for the caller's body.
 */
const EFFORT_MAP_MAX_ENTRIES = 16;

/** A failed call's status by reason. A refusal is the operator's own mistake, so it is a 4xx and never a server fault. */
const STATUS_FOR_FAULT: Record<Extract<AgentLaunchResult<never>, { ok: false }>['reason'], number> = {
  refused: 400,       // the CLI said no, in a sentence: an unknown name or word, a write over a malformed table
  unreachable: 503,   // the CLI is not on this host, was cut, or crashed before it answered
  unreadable: 502,    // the CLI answered, and not with the object its contract promises
};

/** What a body's parse came to: the typed change the service takes, or the route's own sentence for the 400. */
type Parsed<T> = { change: T } | { error: string };

/** A plain JSON object, as opposed to an array, a scalar or nothing at all. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first key of `body` outside `allowed`, or null. A misspelt key is refused rather than dropped without a word. */
function unknownKey(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  return Object.keys(body).find((key) => !allowed.includes(key)) ?? null;
}

/** A row's body — `{ model?: string | null, effort?: string | null }` — with at least one field. */
function parseRowChange(body: unknown): Parsed<AgentLaunchRowChange> {
  if (!isRecord(body)) return { error: 'the body must be a JSON object' };
  const stray = unknownKey(body, ['model', 'effort']);
  if (stray !== null) return { error: `\`${stray.slice(0, 64)}\` is not a field of a row; a row takes model and effort` };
  const change: AgentLaunchRowChange = {};
  for (const field of ['model', 'effort'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    // `null` is "clear this pin": the row falls back to the table's defaults.
    if (value !== null && (typeof value !== 'string' || !WORD.test(value))) {
      return { error: `\`${field}\` must be a word, or null to clear the pin` };
    }
    change[field] = value;
  }
  if (Object.keys(change).length === 0) return { error: 'name at least one of model and effort' };
  return { change };
}

/** The defaults' body — `{ model?: string, effort?: { [model]: string | null }, deepseek_effort?: string }` — with at least one field. */
function parseDefaultsChange(body: unknown): Parsed<AgentLaunchDefaultsChange> {
  if (!isRecord(body)) return { error: 'the body must be a JSON object' };
  const stray = unknownKey(body, ['model', 'effort', 'deepseek_effort']);
  if (stray !== null) {
    return { error: `\`${stray.slice(0, 64)}\` is not a field of the defaults; they take model, effort and deepseek_effort` };
  }
  const change: AgentLaunchDefaultsChange = {};
  for (const field of ['model', 'deepseek_effort'] as const) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !WORD.test(value)) return { error: `\`${field}\` must be a word` };
    change[field] = value;
  }
  if (body.effort !== undefined) {
    if (!isRecord(body.effort)) return { error: '`effort` must map a model to an effort word, or to null for no effort flag' };
    const entries = Object.entries(body.effort);
    if (entries.length > EFFORT_MAP_MAX_ENTRIES) {
      return { error: `\`effort\` names ${entries.length} models; a map takes at most ${EFFORT_MAP_MAX_ENTRIES}` };
    }
    const efforts: Record<string, string | null> = {};
    for (const [model, effort] of entries) {
      if (!WORD.test(model) || (effort !== null && (typeof effort !== 'string' || !WORD.test(effort)))) {
        return { error: '`effort` must map a model to an effort word, or to null for no effort flag' };
      }
      efforts[model] = effort;
    }
    // An empty map changes nothing, so it is no field of the body.
    if (Object.keys(efforts).length > 0) change.effort = efforts;
  }
  if (Object.keys(change).length === 0) return { error: 'name at least one of model, effort and deepseek_effort' };
  return { change };
}

/**
 * One answer, written: the census itself, or the CLI's own sentence under the status its reason earns.
 * The sentence travels UNTOUCHED — it is the answer, and the window shows it as it stands.
 */
function emit(response: express.Response, answer: AgentLaunchResult<Record<string, unknown>>): void {
  if (answer.ok) {
    response.json(answer.value);
    return;
  }
  response.status(STATUS_FOR_FAULT[answer.reason]).json({ error: answer.message });
}

/**
 * The launch table's three routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers check the SHAPE of what arrives and translate it, and do nothing else: no file is
 * opened here, no vocabulary is held here, and no word reaches the CLI without first being held to a
 * token shape. The service owns the one transport, and it is a process — the CLI itself. A PUT answers
 * with the census the CLI printed after its write, read back off the table, never with the input.
 */
export function createAgentLaunchRouter(
  dependencies: Pick<AgentLaunchService, 'census' | 'setRow' | 'setDefaults'>,
): express.Router {
  const router = express.Router();

  /** One relayed question. A handler that answers itself — a malformed name or body — does so before calling this. */
  const relay = (operation: () => Promise<AgentLaunchResult<Record<string, unknown>>>): express.RequestHandler =>
    async (_request, response, next) => {
      try {
        emit(response, await operation());
      } catch (error) {
        // The service resolves every fault it can name, so reaching here means something this lane
        // has no word for. It belongs to the app's error handler, not to a body of our own.
        next(error);
      }
    };

  /** The whole census the window reads: the defaults, one row per soul and Metis, each row's lanes. */
  router.get('/', relay(() => dependencies.census()));

  /** Pin or clear one row's model and effort. */
  router.put('/rows/:name', (request, response, next) => {
    // `params` is the repeated-parameter dictionary, so a value here is a string OR an array of
    // them; this route names one row, and anything that is not one string names no row.
    const name = request.params.name;
    if (typeof name !== 'string' || !ROW_NAME.test(name)) {
      response.status(400).json({ error: 'a row name is lowercase letters, digits and underscores, beginning with a letter' });
      return;
    }
    const parsed = parseRowChange(request.body);
    if ('error' in parsed) {
      response.status(400).json({ error: parsed.error });
      return;
    }
    void relay(() => dependencies.setRow(name, parsed.change))(request, response, next);
  });

  /** Change the table's defaults: the default model, each model's default effort, the DeepSeek effort. */
  router.put('/defaults', (request, response, next) => {
    const parsed = parseDefaultsChange(request.body);
    if ('error' in parsed) {
      response.status(400).json({ error: parsed.error });
      return;
    }
    void relay(() => dependencies.setDefaults(parsed.change))(request, response, next);
  });

  return router;
}
