/**
 * Signed, single-use tokens behind ntfy's tap-to-answer buttons.
 *
 * A button on the phone is a bare POST to `/api/ntfy/act?t=<token>`: the ntfy
 * app holds no CloudCLI login, so the token IS the credential. It names one
 * pending permission request, the user it belongs to and the one decision the
 * button stands for — all under an HMAC-SHA256 signature, so a token minted for
 * "Deny" can never be replayed as "Approve". A token works once, and its
 * sibling buttons die with it: consuming any token of a request deletes that
 * request.
 *
 * This file is the crypto and the bookkeeping only. It knows decision SHAPES
 * (`allow`, `deny`, `revise`, `opt:<n>`) and nothing about tools or what an
 * option means — that mapping lives in `ntfy-action-decisions.service.ts`,
 * which imports this file and never the reverse.
 */

import crypto from 'crypto';

import { appConfigDb } from '@/modules/database/index.js';

// Consumed by the ntfy action decisions (which mint each shape) and the act route (which logs its kind).
export type NtfyActionDecision = 'allow' | 'deny' | 'revise' | `opt:${number}`;

// Consumed by the ntfy action decisions and the act route: one permission request a phone may still answer.
export type PendingAction = {
  requestId: string;
  userId: string;
  sessionId: string | null;
  toolName: string;
  input: unknown;
  expiresAt: number;
};

/**
 * A refused token, and whether it was a GUESS — a token whose shape or signature
 * proves this instance never minted it. A refusal that carried our own signature
 * (spent, expired, its request gone) is not a guess: its holder really did hold a
 * token of ours. The act route counts guesses only, so a stranger's noise can
 * never stand between the phone and its own button.
 */
type ConsumeRefusal = { ok: false; status: 400 | 401 | 410; reason: string; forged: boolean };

type ConsumeResult = { ok: true; action: PendingAction; decision: NtfyActionDecision } | ConsumeRefusal;

type TokenPayload = { r: string; u: string; d: string; e: number; n: string };

const SECRET_CONFIG_KEY = 'ntfy_action_secret';
const MAX_TOKEN_CHARS = 2048;
/** Every shape `mintActionToken` will sign; a signed payload holding anything else is refused. */
const DECISION_PATTERN = /^(allow|deny|revise|opt:(0|[1-9][0-9]{0,2}))$/;

/** Requests a phone may still answer, by request id. */
const pendingActions = new Map<string, PendingAction>();

/**
 * Nonces already spent, each kept until its own token's expiry. Past that
 * moment the expiry check refuses the token before the nonce is ever looked
 * up, so forgetting the nonce then reopens nothing.
 */
const consumedNonces = new Map<string, number>();

let cachedSecret: string | null = null;

/**
 * The instance's signing secret, created in `app_config` on first use — the
 * `jwt_secret` pattern. Cached for the life of the process: rotating it means
 * deleting the row and restarting, which voids every outstanding button, the
 * right outcome for a rotation.
 */
function actionSecret(): string {
  if (cachedSecret) return cachedSecret;
  let secret = appConfigDb.get(SECRET_CONFIG_KEY);
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    appConfigDb.set(SECRET_CONFIG_KEY, secret);
  }
  cachedSecret = secret;
  return secret;
}

function sign(payloadSegment: string): string {
  return crypto.createHmac('sha256', actionSecret()).update(payloadSegment).digest('base64url');
}

/**
 * Compares the signature as base64url TEXT, not decoded bytes: the last
 * character of a base64 string carries padding bits, so decoding would accept
 * several spellings of one signature. `timingSafeEqual` throws on buffers of
 * unequal length, so a wrong length is answered first — as a wrong signature,
 * never as a thrown 500.
 */
function signatureMatches(payloadSegment: string, signatureSegment: string): boolean {
  const expected = Buffer.from(sign(payloadSegment));
  const provided = Buffer.from(signatureSegment);
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

function decodePayload(payloadSegment: string): TokenPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { r, u, d, e, n } = parsed as Record<string, unknown>;
    if (typeof r !== 'string' || typeof u !== 'string' || typeof d !== 'string' || typeof n !== 'string') return null;
    if (typeof e !== 'number' || !Number.isFinite(e)) return null;
    return { r, u, d, e, n };
  } catch {
    return null;
  }
}

/** Forgets requests and spent nonces whose time is up. Runs on every register and consume. */
function pruneExpired(now: number): void {
  for (const [requestId, action] of pendingActions) {
    if (action.expiresAt <= now) pendingActions.delete(requestId);
  }
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) consumedNonces.delete(nonce);
  }
}

function refuse(status: 400 | 401 | 410, reason: string, forged: boolean): ConsumeRefusal {
  return { ok: false, status, reason, forged };
}

// Consumed by the ntfy action decisions, which register a request before minting its buttons' tokens.
export function registerPendingAction(action: Omit<PendingAction, 'expiresAt'> & { ttlMs: number }): void {
  const now = Date.now();
  pruneExpired(now);
  pendingActions.set(action.requestId, {
    requestId: action.requestId,
    userId: action.userId,
    sessionId: action.sessionId,
    toolName: action.toolName,
    input: action.input,
    expiresAt: now + action.ttlMs,
  });
}

/**
 * Retires a request no phone may answer any more, spending none of its tokens:
 * every button of it answers 410 from this moment on.
 *
 * Consumed by whoever learns the request was settled elsewhere — the in-app
 * answer path. That is the ONE thing that closes the window in which a
 * question's four-hour button stays live in ntfy's message cache after the
 * browser already answered, and the call has to come from the Claude runtime,
 * which reaches this module only through `modules/notifications/index.ts`: the
 * re-export there is the one line this phase's manifest does not reach.
 */
export function forgetPendingAction(requestId: string): void {
  pendingActions.delete(requestId);
}

/**
 * Mints the token for one button: `<base64url JSON payload>.<base64url HMAC of
 * that segment>`. Consumed by the ntfy action decisions. The token expires with
 * its request, so the request must be registered first; minting for an unknown
 * request, or for a decision this file would refuse, throws.
 */
export function mintActionToken(requestId: string, userId: string | number, decision: NtfyActionDecision): string {
  const action = pendingActions.get(requestId);
  if (!action) throw new Error('mintActionToken: the request is not pending');
  if (!DECISION_PATTERN.test(decision)) throw new Error('mintActionToken: unknown decision shape');

  const payload: TokenPayload = {
    r: requestId,
    u: String(userId),
    d: decision,
    e: action.expiresAt,
    n: crypto.randomBytes(8).toString('hex'),
  };
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadSegment}.${sign(payloadSegment)}`;
}

/**
 * Verifies a tapped token and, when it holds, spends it. Consumed by the act route.
 *
 * Checked in this order, so nothing an unsigned payload says is ever read:
 * shape (400) → signature over the raw payload segment (401) → payload fields
 * (400) → expiry and decision shape (401) → spent nonce, unknown request or a
 * different user (410). On success the nonce is recorded and the request
 * deleted BEFORE the caller acts on it, so a throw downstream can never leave
 * a reusable token behind. Each refusal also reports whether it was `forged` —
 * refused at or before the signature — which is the only kind the route counts.
 */
export function consumeActionToken(token: string): ConsumeResult {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return refuse(400, 'malformed token', true);
  const segments = token.split('.');
  if (segments.length !== 2 || !segments[0] || !segments[1]) return refuse(400, 'malformed token', true);
  const [payloadSegment, signatureSegment] = segments;

  if (!signatureMatches(payloadSegment, signatureSegment)) return refuse(401, 'bad signature', true);

  const payload = decodePayload(payloadSegment);
  // Past the signature: this instance signed it, so nothing below is a guess.
  if (!payload) return refuse(400, 'malformed payload', false);

  const now = Date.now();
  if (payload.e <= now) return refuse(401, 'expired', false);
  if (!DECISION_PATTERN.test(payload.d)) return refuse(401, 'unknown decision', false);

  pruneExpired(now);
  if (consumedNonces.has(payload.n)) return refuse(410, 'already answered', false);
  const action = pendingActions.get(payload.r);
  if (!action || action.userId !== payload.u) return refuse(410, 'no longer pending', false);

  consumedNonces.set(payload.n, payload.e);
  pendingActions.delete(payload.r);
  return { ok: true, action, decision: payload.d as NtfyActionDecision };
}
