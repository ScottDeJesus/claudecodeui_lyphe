import express from 'express';

import type { HealFault, HealResult, HealService } from './heal.service.js';

/**
 * What a kind may look like: the door's own word, as the hooks write it — `rail-deny`,
 * `script-nudge-blocked`, `fix-pass-open`, `phase-athena`. A kind is a token the ledger wrote, not
 * a path and not a sentence, and the fence is stated at the door because a value that reaches a
 * spawn is a value an operator types. It is NOT a whitelist of the kinds that exist: a new hook
 * naming a new kind must not need an edit here.
 */
const KIND = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** A tool name as the hooks write it — `Bash`, `Monitor`, `Read` — or `*` for every tool. */
const TOOL = /^(\*|[A-Za-z][A-Za-z0-9_-]{0,63})$/;

/**
 * How much of one typed string this route will carry. A pattern is a Python regular expression and a
 * reason is prose, so the bound is generous and stated rather than inherited from a body-parser
 * default; an empty one is refused, because a pattern that matches nothing is an ignore row that
 * does nothing while looking like a safeguard.
 */
const TEXT_MAX = 400;

/** One typed field off a request body: present, non-blank, and within the bound above. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= TEXT_MAX ? trimmed : null;
}

/**
 * How a refused question becomes a status, in the shape of the plan-runner lane's `statusForVerb`.
 *
 * A refusal is not a server fault: the worker is a separate thing on this host, and each reason says
 * exactly which way it was separate. Turning one into a 200 with an empty body would replace the one
 * useful thing in the answer — that nothing was read — with silence the tab would show as data.
 */
const STATUS_FOR_FAULT: Record<HealFault, number> = {
  unreachable: 503,   // the worker is not on this host, or was torn down before it answered
  unreadable: 502,    // the worker answered, and not with the object its contract promises
};

/**
 * One answer, written: the value itself, or the worker's own sentence under the status its reason
 * earns. The sentence travels UNTOUCHED, the way a runner refusal does — it is the answer.
 */
function emit<T>(response: express.Response, answer: HealResult<T>): void {
  if (answer.ok) {
    response.json(answer.value);
    return;
  }
  response.status(STATUS_FOR_FAULT[answer.reason]).json({ error: answer.message });
}

/**
 * The heal lane's six routes. Auth is the mount's `authenticateToken`, in `server/index.ts`.
 *
 * These handlers validate and translate, and do nothing else: no store is opened here, no path is
 * named here, and no route hands the worker a string it did not first hold to a token shape. The
 * service owns the one transport, and it is a process — the worker's own command.
 */
export function createHealRouter(
  dependencies: Pick<HealService, 'summary' | 'kind' | 'ignore' | 'addIgnore' | 'cycle' | 'stopCycle'>,
): express.Router {
  const router = express.Router();

  /** One relayed question. A handler that answers itself — a malformed kind, an empty pattern —
   * does so before calling this, and its own status stands. */
  const relay = <T>(operation: () => Promise<HealResult<T>>): express.RequestHandler =>
    async (_request, response, next) => {
      try {
        emit(response, await operation());
      } catch (error) {
        // The service resolves every fault it can name, so reaching here means something this lane
        // has no word for. It belongs to the app's error handler, not to a body of our own.
        next(error);
      }
    };

  /** The whole summary the tab reads: counts, kind rows, heal cards, cycles, ignore table. */
  router.get('/summary', relay(() => dependencies.summary()));

  /**
   * The rows filed under one door's word. Keyed on the KIND and never on the cause class: a heal is
   * scoped to a kind, the triage counts a kind, and a class is NULL until something judges the
   * row — so a route keyed on the class would answer nothing for most of the ledger's life.
   *
   * A kind that is not a token names no kind, and gets the same answer an unknown one gets, without
   * a lookup — exactly as the plan-runner lane answers a malformed run id.
   */
  router.get('/kind/:kind', async (request, response, next) => {
    // `params` is the repeated-parameter dictionary, so a value here is a string OR an array of
    // them; this route names one kind, and anything that is not one string names no kind.
    const kind = request.params.kind;
    if (typeof kind !== 'string' || !KIND.test(kind)) {
      response.status(404).json({ error: 'no such kind' });
      return;
    }
    try {
      emit(response, await dependencies.kind(kind));
    } catch (error) {
      next(error);
    }
  });

  /** The ignore table: what is deliberately not pain, seeded rows included. */
  router.get('/ignore', relay(() => dependencies.ignore()));

  /**
   * Add one ignore row and sweep the live rows its pattern already matches, answering both counts so
   * the tab can say how many EXISTING rows the operator's new pattern just cleared.
   */
  router.post('/ignore', (request, response, next) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const tool = text(body.tool);
    const pattern = text(body.pattern);
    const reason = text(body.reason);
    if (!tool || !TOOL.test(tool) || !pattern || !reason) {
      response.status(400).json({ error: 'tool, pattern and reason must each be a non-empty string' });
      return;
    }
    void relay(() => dependencies.addIgnore(tool, pattern, reason))(request, response, next);
  });

  /**
   * The cycle's two doors. Both RELAY the worker's own object with 200 — a refusal is an ANSWER, not
   * an error: `{"started": false, "why": "heal switch off"}` is exactly what the panel has
   * to show, and a 4xx here would put the fleet's own sentence where the tab prints "something went
   * wrong". A fault (the worker not on this host, or not speaking its JSON contract) still answers
   * 503/502 through `emit`, because that is not the worker refusing — it is nothing having answered.
   */
  router.post('/cycle', relay(() => dependencies.cycle()));
  router.post('/cycle/stop', relay(() => dependencies.stopCycle()));

  return router;
}
