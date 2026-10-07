// The warden's half of the wire contract in `server/shared/cerberus-types.ts` (`CerberusEnvelope`,
// `CerberusSignedFrame`, `CerberusHelloBody`, `CerberusNodeCert`) and of the upgrade handshake in
// `server/modules/cerberus/warden-auth.ts`: what a frame looks like, how center's frames are
// checked, which headers open a socket, and how to learn WHY center refused one.
//
// Shared by `link.mjs` (the long-lived link) and `enroll.mjs` (the one-shot enrollment), so the two
// can never disagree about a header or a signature.
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import { hostFacts, signConnect, version } from './state.mjs';

/** The path center's gateway takes a websocket upgrade on. */
const WS_PATH = '/cerberus/ws';

/** How long a refusal read may wait for center's answer. */
const REFUSAL_TIMEOUT_MS = 5000;

/** The longest refusal line kept: center's are short sentences, and an unknown peer's body is not trusted with more. */
const MAX_REFUSAL_CHARS = 200;

const startedAt = Date.now() - Math.round(process.uptime() * 1000);

/**
 * `text` as one printable line of at most `limit` characters. Words from a peer that has not yet
 * been trusted (a refusal before the key is pinned) reach a person's terminal, so a control
 * character — an escape sequence, a carriage return — never survives the trip.
 */
export function oneLine(text, limit = MAX_REFUSAL_CHARS) {
  return [...String(text).split('\n')[0]].filter((character) => character >= ' ' && character !== '\x7f').join('').trim().slice(0, limit);
}

/** `http://host:port` → `ws://host:port/cerberus/ws` (`https` → `wss`). */
export function centerSocketUrl(center) {
  return `${center.replace(/\/+$/, '').replace(/^http/, 'ws')}${WS_PATH}`;
}

/** The envelope every frame the warden sends is wrapped in (`CerberusEnvelope`). Frames from the warden are not signed: its link was authenticated once, at the upgrade. */
export function makeEnvelope(node, type, seq, body) {
  return { type, id: crypto.randomBytes(6).toString('hex'), node, seq, at: Date.now(), body };
}

/**
 * The `hello` body (`CerberusHelloBody`). `known` is what the warden holds that center versions:
 * `{ checksVersion, catalogVersion, active }`, each defaulting to "nothing yet". `update` is the update
 * this process was started after (`update.mjs`), left out of the body when there is none.
 */
export function buildHello({ checksVersion = null, catalogVersion = null, active = { runs: [], diags: [] }, update } = {}) {
  return { version, startedAt, facts: hostFacts(), checksVersion, catalogVersion, active, ...(update ? { update } : {}) };
}

// --- the upgrade headers --------------------------------------------------------------------------

let lastAt = 0;

/** How far ahead of the clock `at` may be pushed to stay unique before it is taken to be a clock that stepped back. */
const MAX_AT_BUMP_MS = 1000;

/**
 * The headers of a connect for `node`: a fresh `at` and the node key's signature over it. Center
 * refuses a (node, at) pair it has seen in the last two minutes, so `at` increases within this
 * process even when two attempts land in one millisecond — but never runs away from the clock: one
 * that was hours ahead when it was first read and then stepped back must not keep signing the old future.
 */
export function connectHeaders(node, home) {
  const now = Date.now();
  lastAt = lastAt - now > MAX_AT_BUMP_MS ? now : Math.max(now, lastAt + 1);
  return {
    'X-Cerberus-Node': node,
    'X-Cerberus-At': String(lastAt),
    'X-Cerberus-Sig': signConnect(node, lastAt, home),
  };
}

/** The headers of an enrollment: the one-time token, the name it was minted for and the key the node will sign with. */
export function enrollHeaders(name, token, publicKeyBase64) {
  return { 'X-Cerberus-Enroll': token, 'X-Cerberus-Node': name, 'X-Cerberus-Key': publicKeyBase64 };
}

// --- checking what center says ---------------------------------------------------------------------

let cachedKey = null; // { text, key } — a link verifies thousands of frames against one key

function publicKeyOf(keyBase64) {
  if (cachedKey?.text !== keyBase64) {
    cachedKey = { text: keyBase64, key: crypto.createPublicKey({ key: Buffer.from(keyBase64, 'base64'), format: 'der', type: 'spki' }) };
  }
  return cachedKey.key;
}

/** Whether `signatureBase64` is `keyBase64`'s ed25519 signature of the UTF-8 bytes of `text`. False, never a throw, for anything malformed. */
export function verifySignature(keyBase64, text, signatureBase64) {
  try {
    return crypto.verify(null, Buffer.from(text, 'utf8'), publicKeyOf(keyBase64), Buffer.from(signatureBase64, 'base64'));
  } catch {
    // A key or signature that is not even well formed is a failed check like any other.
    return false;
  }
}

/**
 * Whether `frame` is a `{ env, sig }` whose `sig` is center's signature over the exact bytes of
 * `env`. The bytes, never a re-serialisation of them: a parse and a stringify can respace the same
 * object into different text, and a signature over different text proves nothing.
 */
export function verifyFrame(frame, centerKeyBase64) {
  if (typeof frame !== 'object' || frame === null) return false;
  if (typeof frame.env !== 'string' || typeof frame.sig !== 'string') return false;
  return verifySignature(centerKeyBase64, frame.env, frame.sig);
}

// --- why a connect was refused -------------------------------------------------------------------

/**
 * Asks center why it refused a connect. A websocket client learns only that the upgrade failed; the
 * 401's body holds the sentence a person can act on (`token used`, `clock skew 75 s`). So this makes
 * the same request by hand — `url` and `headers` as a connect would send them, `headers` freshly
 * built because center remembers the `at` it has already seen — and reads the answer.
 *
 * Resolves, never rejects: `{ status, reason }` where `status` is the HTTP status (null when nothing
 * answered) and `reason` is one line — a 401's body, else a description of what happened. A 101
 * means center would have accepted: that socket is destroyed at once (center writes nothing for a
 * socket that never sends `hello`, and this one never will).
 */
export function readRefusal(url, headers) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url.replace(/^ws/, 'http'));
    } catch (error) {
      resolve({ status: null, reason: `${url} is not a URL (${error.message})` });
      return;
    }
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'GET',
      timeout: REFUSAL_TIMEOUT_MS,
      headers: {
        ...headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      },
    });
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      resolve({ status: 101, reason: 'center accepted the connection' });
    });
    request.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 1024) body += chunk;
      });
      response.on('end', () => {
        const line = oneLine(body);
        resolve({ status: response.statusCode, reason: line || `HTTP ${response.statusCode}` });
      });
      response.on('error', (error) => resolve({ status: response.statusCode, reason: error.message }));
    });
    request.on('timeout', () => request.destroy(new Error(`no answer within ${REFUSAL_TIMEOUT_MS / 1000} s`)));
    request.on('error', (error) => resolve({ status: null, reason: error.code ?? error.message }));
    request.end();
  });
}
