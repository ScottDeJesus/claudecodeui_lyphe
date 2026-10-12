import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { cerberusEnrollDb, cerberusNodesDb } from '@/modules/database/index.js';

import { canonicalEd25519PublicKey, verifyNodeSignature } from './center-key.js';

/**
 * Who may open a warden link — decided from the upgrade request's headers alone, BEFORE the socket
 * is upgraded, so a peer that cannot prove itself never gets a websocket to send frames on.
 *
 * Two ways in, told apart by one header:
 *
 *   ENROLL — `X-Cerberus-Enroll` is the one-time token as printed (`XXXX-XXXX-XXXX`), `X-Cerberus-Node`
 *   the name it was minted for, `X-Cerberus-Key` the base64 SPKI DER of the ed25519 key the new node
 *   will sign with. The token's sha256 must name an unused, unexpired row whose `name` is the node
 *   header, and no node of that name may exist yet. This only checks; the token is SPENT later, by the
 *   link, inside the one transaction that also writes the node (`warden-link.ts`) — two sockets that
 *   present one token both pass here and exactly one wins there.
 *
 *   CONNECT — `X-Cerberus-Node`, `X-Cerberus-At` (epoch ms) and `X-Cerberus-Sig`, the base64 ed25519
 *   signature over `cerberus-connect\n<node>\n<at>`. The node must exist, `|now − at| ≤ 60 000`, the
 *   signature must verify against the public key stored at enrollment, and the (node, at) pair must
 *   not have been presented in the last 120 s — the window in which a captured header could still
 *   pass the clock check, so a replay of one is refused.
 *
 * ONLY the `X-Cerberus-*` headers are read. A user's `Authorization` header or `token` query string
 * means nothing here: this listener carries no user route, and a person's login must never open a
 * warden link — a request bearing only one is refused as an unknown node.
 *
 * Every refusal is one plain line from a closed set (`WardenRefusal`); the gateway writes it as the
 * body of a 401. It answers a reason a person can act on (the token is spent, the clock is off) and
 * nothing about WHY a signature failed.
 *
 * Consumers: `warden-gateway.ts` (the upgrade handler).
 */

/** How far a connect header's `at` may be from this clock, either way. */
const MAX_CLOCK_SKEW_MS = 60_000;

/** How long a (node, at) pair stays remembered: twice the skew window, after which it could not pass anyway. */
const REPLAY_MEMORY_MS = 120_000;

/** One whole number of milliseconds with a single spelling, so the signed text and the remembered pair agree. */
const EPOCH_MS_TEXT = /^(?:0|[1-9]\d{0,14})$/;

/**
 * Why an upgrade was refused — the closed set of lines a 401 body may carry. `clock skew N s` names
 * how far off the connecting clock is, in whole seconds, so the operator of the node can see it.
 */
export type WardenRefusal =
  | 'token used'
  | 'token expired'
  | 'unknown token'
  | 'name does not match the token'
  | 'unknown node'
  | 'bad signature'
  | `clock skew ${number} s`
  | 'replayed signature';

/**
 * The verdict on an upgrade request. `connect` names the node (it exists); `enroll` carries what the
 * link needs to write the node: its `name`, its canonical `publicKey` (base64 SPKI DER), the
 * `tokenHash` to spend and the token's `desc`. Consumers: `warden-gateway.ts` (answers 401 for
 * `refused`, else hands the rest to `warden-link.ts`).
 */
export type WardenAuthResult =
  | { kind: 'connect'; node: string }
  | { kind: 'enroll'; name: string; publicKey: string; tokenHash: string; desc: string | null }
  | { refused: WardenRefusal };

/** `${node}\n${at}` → when it was presented. Insertion order is time order, which `forgetExpiredPairs` leans on. */
const presentedPairs = new Map<string, number>();

function headerOf(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function forgetExpiredPairs(now: number): void {
  for (const [pair, presentedAt] of presentedPairs) {
    if (now - presentedAt <= REPLAY_MEMORY_MS) break;
    presentedPairs.delete(pair);
  }
}

function authenticateEnroll(req: IncomingMessage, token: string, now: number): WardenAuthResult {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = cerberusEnrollDb.find(tokenHash);
  if (!row) return { refused: 'unknown token' };
  if (row.used_at !== null) return { refused: 'token used' };
  if (row.expires_at <= now) return { refused: 'token expired' };
  if (row.name !== headerOf(req, 'x-cerberus-node')) return { refused: 'name does not match the token' };
  // A name already enrolled cannot be enrolled again: the token names a node that is no longer free.
  if (cerberusNodesDb.get(row.name)) return { refused: 'name does not match the token' };

  // A key that is not an ed25519 key can never sign a connect header; "bad signature" is the nearest
  // of the closed set, and the one line the installer's operator can act on (the key it generated).
  const publicKey = canonicalEd25519PublicKey(headerOf(req, 'x-cerberus-key') ?? '');
  if (!publicKey) return { refused: 'bad signature' };
  return { kind: 'enroll', name: row.name, publicKey, tokenHash, desc: row.desc };
}

function authenticateConnect(req: IncomingMessage, now: number): WardenAuthResult {
  const node = headerOf(req, 'x-cerberus-node');
  const row = node ? cerberusNodesDb.get(node) : null;
  if (!node || !row) return { refused: 'unknown node' };

  const atText = headerOf(req, 'x-cerberus-at');
  const signature = headerOf(req, 'x-cerberus-sig');
  if (!atText || !signature || !EPOCH_MS_TEXT.test(atText)) return { refused: 'bad signature' };

  const skewMs = Math.abs(now - Number(atText));
  // A refused skew is past the limit, so the line never prints the limit itself ("60 s" for 60.4 s
  // would read as an allowance): rounded, but never below the first second that is refused.
  if (skewMs > MAX_CLOCK_SKEW_MS) return { refused: `clock skew ${Math.max(MAX_CLOCK_SKEW_MS / 1000 + 1, Math.round(skewMs / 1000))} s` };

  // Signature BEFORE replay: only a header that really was signed may occupy a pair's slot, so a
  // stranger guessing at timestamps cannot lock the real node out of the one it will use.
  if (!verifyNodeSignature(row.public_key, `cerberus-connect\n${node}\n${atText}`, signature)) return { refused: 'bad signature' };

  forgetExpiredPairs(now);
  const pair = `${node}\n${atText}`;
  if (presentedPairs.has(pair)) return { refused: 'replayed signature' };
  presentedPairs.set(pair, now);
  return { kind: 'connect', node };
}

/**
 * Decides an upgrade request. `now` is the caller's clock, epoch milliseconds — passed in so one
 * request is judged against one instant. Reads the store; writes nothing but the replay memory.
 */
export function authenticateUpgrade(req: IncomingMessage, now: number): WardenAuthResult {
  const enrollToken = headerOf(req, 'x-cerberus-enroll');
  return enrollToken ? authenticateEnroll(req, enrollToken, now) : authenticateConnect(req, now);
}
