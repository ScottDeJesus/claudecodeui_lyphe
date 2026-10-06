// `enroll`: how a machine becomes a node — the warden's side of the enrollment handshake in
// `server/modules/cerberus/warden-auth.ts` (the headers) and `warden-enrollment.ts` (the certificate).
//
//   1. A home that already holds an `identity.json` is refused BEFORE anything is written: a second
//      enrollment would replace the keys center knows, and the node could never connect again.
//   2. The ed25519 key pair is generated and BOTH halves written before the socket opens. Were the
//      process to die after center wrote the node but before its `welcome` arrived, the key center
//      holds must still be on disk — which is also why a key already in the home (an earlier attempt
//      that never finished) is reused and never replaced.
//   3. The socket opens with `X-Cerberus-Enroll`, `X-Cerberus-Node` and `X-Cerberus-Key`; the first
//      frame is `hello`. The `welcome` must arrive within 10 s and carry `cert.centerKey`, and the
//      frame must verify against THAT key: it is how the warden learns whom to trust from now on, so
//      what it checks is that the key signs for itself, that the certificate names this node and the
//      fingerprint of the key it generated, and that the certificate's own signature holds.
//   4. `identity.json` is written (0600) and the verb succeeds.
//
// RECOVERY. When the home already holds a key (step 2), the node may well exist at center already —
// its `welcome` having been lost on the wire, with the token spent. Center hands the certificate to
// a plain CONNECT's `welcome` as well, so that case is tried first with the key the home holds; if
// center says it does not know the node (or the key), the token is used as usual.
import { log } from './log.mjs';
import { ensureHome, fingerprint, generateNodeKeys, hasNodeKey, publicKeyBase64, readIdentity, writeIdentity } from './state.mjs';
import {
  buildHello,
  centerSocketUrl,
  connectHeaders,
  enrollHeaders,
  makeEnvelope,
  oneLine,
  readRefusal,
  verifyFrame,
  verifySignature,
} from './wire.mjs';

const WELCOME_TIMEOUT_MS = 10_000;
const SOCKET_OPEN = 1;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why `cert` cannot be trusted as this node's certificate, or null when it can. */
function certProblem(cert, name, ownFingerprint) {
  if (!isRecord(cert) || typeof cert.centerKey !== 'string') return 'The welcome carried no center key';
  if (cert.node !== name || cert.fingerprint !== ownFingerprint) return "The certificate is not for this node's key";
  const text = `cerberus-cert\n${cert.node}\n${cert.fingerprint}\n${cert.issuedAt}`;
  if (!Number.isSafeInteger(cert.issuedAt) || !verifySignature(cert.centerKey, text, cert.sig)) {
    return "The certificate's signature does not hold";
  }
  return null;
}

/** The sentence for a connect that never opened, from what `readRefusal` learned. */
function sentenceFor(center, { status, reason }) {
  if (status === 401) return reason;
  if (status === null) return `Cerberus at ${center} did not answer (${reason})`;
  if (status === 101) return 'The connection to Cerberus failed';
  return `Cerberus at ${center} answered HTTP ${status}: ${reason}`;
}

/**
 * Opens one socket with `headersFor()`, says `hello`, and waits for the `welcome`.
 * Resolves `{ ok: true, cert }`, or `{ ok: false, reason }` with the sentence to show the person.
 */
function handshake({ center, name, headersFor, ownFingerprint }) {
  return new Promise((resolve) => {
    const url = centerSocketUrl(center);
    let settled = false;
    let opened = false;
    let centersWords = null; // an `error` frame's message: unsigned before the key is pinned, so it is only ever shown
    let socket = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        socket?.close();
      } catch {
        // Already closed: nothing to wait for.
      }
      resolve(result);
    };
    const deadline = setTimeout(
      () => finish({ ok: false, reason: centersWords ?? `No welcome from Cerberus within ${WELCOME_TIMEOUT_MS / 1000} s` }),
      WELCOME_TIMEOUT_MS
    );

    function onMessage(data) {
      let frame;
      let env;
      try {
        frame = JSON.parse(data);
        env = JSON.parse(frame.env);
      } catch {
        return; // not a frame; the deadline decides
      }
      if (!isRecord(env) || env.node !== name) return;
      if (env.type === 'error' && isRecord(env.body)) centersWords = oneLine(env.body.message);
      if (env.type !== 'welcome') return;
      const cert = isRecord(env.body) ? env.body.cert : null;
      if (!isRecord(cert) || typeof cert.centerKey !== 'string') return finish({ ok: false, reason: 'The welcome carried no certificate' });
      if (!verifyFrame(frame, cert.centerKey)) return finish({ ok: false, reason: 'The welcome is not signed by the key it carries' });
      const problem = certProblem(cert, name, ownFingerprint);
      finish(problem ? { ok: false, reason: problem } : { ok: true, cert });
    }

    socket = new WebSocket(url, { headers: headersFor() });
    socket.addEventListener('open', () => {
      opened = true;
      if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify(makeEnvelope(name, 'hello', null, buildHello())));
    });
    socket.addEventListener('message', (event) => onMessage(event.data));
    socket.addEventListener('error', () => {}); // `close` follows and decides
    socket.addEventListener('close', async () => {
      if (settled) return;
      if (opened) return finish({ ok: false, reason: centersWords ?? 'The connection closed before a welcome' });
      // The socket never opened: only the refusal's own body says why.
      const refusal = await readRefusal(url, headersFor());
      finish({ ok: false, reason: sentenceFor(center, refusal) });
    });
  });
}

/**
 * Runs the enrollment and answers the process's exit code. Everything a person needs to read is
 * printed here, in the verb's own voice (no `[warden]` prefix: that is for the daemon's log).
 */
export async function runEnroll({ center, name, token }) {
  const existing = readIdentity();
  if (existing) {
    console.log(`This home is already enrolled as ${existing.node} with ${existing.center}`);
    return 1;
  }

  const home = ensureHome();
  const keyAlreadyHere = hasNodeKey(home);
  if (keyAlreadyHere) log('reusing the key an earlier enrollment attempt left in this home');
  else generateNodeKeys(home);
  const ownFingerprint = fingerprint(home);

  let outcome = { ok: false };
  if (keyAlreadyHere) {
    outcome = await handshake({ center, name, headersFor: () => connectHeaders(name, home), ownFingerprint });
    if (outcome.ok) log('center already knew this node and key; its certificate is recovered');
  }
  if (!outcome.ok) {
    const keyBase64 = publicKeyBase64(home);
    outcome = await handshake({ center, name, headersFor: () => enrollHeaders(name, token, keyBase64), ownFingerprint });
  }
  if (!outcome.ok) {
    console.log(outcome.reason);
    return 1;
  }

  const { cert } = outcome;
  writeIdentity({ node: name, center, centerKey: cert.centerKey, cert, enrolledAt: cert.issuedAt }, home);
  console.log(`Enrolled as ${name} with Cerberus at ${center}`);
  return 0;
}
