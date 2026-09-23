/**
 * The public act route behind ntfy's tap-to-answer buttons: `POST /api/ntfy/act?t=<token>`.
 *
 * Deliberately outside login. The phone's ntfy app holds no CloudCLI session,
 * so the signed single-use token is the whole credential; there is no JWT path
 * and there must never be one — it would be a second door to guard. Mounted
 * under its own public prefix in `server/index.ts`, never beneath the
 * authenticated `/api/notifications`, so no mount order can put a login in
 * front of the phone.
 *
 * The one thing the route defends against is a GUESSER: a caller throwing
 * tokens this instance never signed. Those are counted per client and refused
 * outright past a budget. Everything the signature vouches for — including a
 * spent or expired token — is answered on its merits, because the counter must
 * never be the reason a real button fails.
 */

import express from 'express';

import { describeDecision, toPermissionDecision } from '@/modules/notifications/services/ntfy-action-decisions.service.js';
import { consumeActionToken } from '@/modules/notifications/services/ntfy-action-token.service.js';
import type { NtfyActionDecision } from '@/modules/notifications/services/ntfy-action-token.service.js';

type ToolApprovalRuntime = {
  /** By the prompt's own key, which is what a token names — see `PendingAction.promptKey`. */
  resolveToolApproval(approvalKey: string, decision: { allow: boolean; updatedInput?: unknown; message?: string }): void;
};

/** Guesses one client may spend inside a window before it is refused outright. */
const MAX_GUESSES_PER_WINDOW = 20;
const GUESS_WINDOW_MS = 60_000;
/** Past this many tracked clients the oldest record is evicted, so a new client is always counted. */
const MAX_TRACKED_CLIENTS = 1000;
/** The button label echoed by a 200, cut where ntfy cuts it on the button itself. */
const MAX_LABEL_CHARS = 30;

/**
 * Which client a request counts against: the socket's address, and nothing a
 * caller gets to choose.
 *
 * `X-Forwarded-For` is deliberately NOT read. The API binds loopback only, so
 * every request — the phone's through the Vite proxy included — arrives from
 * `127.0.0.1`, and any finer answer to "which client is this" could only come
 * from a header the caller writes: reading one would hand a guesser an unlimited
 * budget for the price of rotating it. So every caller behind the proxy shares
 * one budget, which costs the phone nothing — a token this instance signed is
 * never refused by the counter, and a guesser who exhausts the shared budget
 * only earns other guessers a 429 in place of a 401.
 */
function clientKeyOf(req: express.Request): string {
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Counts guesses per client over a sliding window.
 *
 * Twenty guesses buy nothing against HMAC-SHA256, so this is a noise damper —
 * it keeps a guesser out of the journal — not the door's lock. The 429 itself
 * is not counted, so a lockout lifts one window after the last guess instead of
 * stretching forever under a steady stream. Tracking is bounded by evicting the
 * least recent record rather than by refusing to track a new client: a counter
 * that went blind under load would be worse than no counter at all.
 */
function createGuessCounter() {
  const guessesByClient = new Map<string, number[]>();

  function recentGuesses(client: string, now: number): number[] {
    const kept = (guessesByClient.get(client) ?? []).filter((at) => now - at < GUESS_WINDOW_MS);
    if (kept.length) guessesByClient.set(client, kept);
    else guessesByClient.delete(client);
    return kept;
  }

  /** Makes room for a new client by dropping whichever record has the oldest last guess. */
  function evictLeastRecent(): void {
    let oldestClient: string | null = null;
    let oldestAt = Infinity;
    for (const [client, guesses] of guessesByClient) {
      const lastGuess = guesses[guesses.length - 1] ?? 0;
      if (lastGuess < oldestAt) {
        oldestAt = lastGuess;
        oldestClient = client;
      }
    }
    if (oldestClient !== null) guessesByClient.delete(oldestClient);
  }

  return {
    isLockedOut(client: string): boolean {
      return recentGuesses(client, Date.now()).length >= MAX_GUESSES_PER_WINDOW;
    },
    record(client: string): void {
      const now = Date.now();
      if (guessesByClient.size >= MAX_TRACKED_CLIENTS && !guessesByClient.has(client)) {
        for (const known of [...guessesByClient.keys()]) recentGuesses(known, now);
        if (guessesByClient.size >= MAX_TRACKED_CLIENTS) evictLeastRecent();
      }
      guessesByClient.set(client, [...recentGuesses(client, now), now]);
    },
    /** Forgets a client's guesses: it has just proved it holds a token of ours. */
    forgive(client: string): void {
      guessesByClient.delete(client);
    },
  };
}

/** `opt:<n>` logs as `opt`: the kind of answer is worth a log line, the option index is not. */
function decisionKind(decision: NtfyActionDecision): string {
  return decision.startsWith('opt:') ? 'opt' : decision;
}

// Consumed by the server entrypoint, which mounts it at /api/ntfy/act with the provider runtime that settles approvals.
export function createNtfyActionRoutes(dependencies: { runtime: ToolApprovalRuntime }): express.Router {
  const router = express.Router();
  const guesses = createGuessCounter();

  router.post('/', (req, res) => {
    const client = clientKeyOf(req);

    // Every call ends here: one log line (never the token) and one plain-text answer.
    const answer = (status: number, text: string, detail: string): void => {
      console.info('[ntfy] action', status, detail);
      res.status(status).type('text/plain').send(text);
    };

    // The one refusal a client is charged for: a token this instance never signed.
    const refuseGuess = (status: number, reason: string): void => {
      if (guesses.isLockedOut(client)) return answer(429, 'too many attempts', 'locked out');
      guesses.record(client);
      return answer(status, reason, reason);
    };

    const token = typeof req.query.t === 'string' ? req.query.t : '';
    if (!token) return refuseGuess(400, 'missing token');

    const verdict = consumeActionToken(token);
    if (!verdict.ok && verdict.forged) return refuseGuess(verdict.status, verdict.reason);

    // Past the signature. This caller holds a token this instance minted, so it is not a
    // guesser: its record is dropped and nothing below is ever refused by the counter.
    // Clearing costs nothing a token-holder could not already have — replaying its own
    // token earns uncounted 410s all day — and it is what guarantees that a real button
    // works on the first tap no matter who else has been knocking.
    guesses.forgive(client);
    if (!verdict.ok) return answer(verdict.status, verdict.reason, verdict.reason);

    const decision = toPermissionDecision(verdict.action, verdict.decision);
    if (!decision) return answer(400, 'unknown option', decisionKind(verdict.decision));

    try {
      // By prompt, not by ask: this tap may name a push a predecessor process sent before a
      // handover, and the successor is asking that same question under its own request id now.
      dependencies.runtime.resolveToolApproval(verdict.action.promptKey, decision);
    } catch (error) {
      console.error('[ntfy] action could not be applied', error instanceof Error ? error.message : error);
      return answer(500, 'could not answer', decisionKind(verdict.decision));
    }
    // The label comes from the model's own tool input, so it is cut before it is echoed.
    const label = describeDecision(verdict.action, verdict.decision).slice(0, MAX_LABEL_CHARS);
    return answer(200, `Answered: ${label}`, decisionKind(verdict.decision));
  });

  return router;
}
