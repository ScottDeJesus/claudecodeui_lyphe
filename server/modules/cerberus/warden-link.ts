import crypto from 'node:crypto';

import type { RawData, WebSocket } from 'ws';

import { cerberusNodesDb } from '@/modules/database/index.js';
import { WS_OPEN_STATE, attachWebSocketHeartbeat } from '@/modules/websocket/index.js';
import type {
  CerberusEnvelope,
  CerberusResultWire,
  CerberusSignedFrame,
  CerberusWelcomeBody,
} from '@/shared/cerberus-types.js';

import { catalogForWelcome, markCatalogSent } from './catalog.service.js';
import { hintChanged } from './cerberus-broadcast.js';
import { signText } from './center-key.js';
import { checksSetFor } from './definitions.service.js';
import { ingest } from './ingest.service.js';
import type { WardenAuthResult } from './warden-auth.js';
import { enrollNode, issueCert } from './warden-enrollment.js';
import { wardenLinks, type CerberusWardenLink } from './warden-links.js';

/**
 * One warden's link: the conversation on one accepted socket, from `hello` to close.
 *
 * The socket arrives already authenticated (`warden-auth.ts`), so the link's node is known before
 * a word is spoken; what it waits for is the `hello` that says who the warden is NOW (version, host
 * facts, which checks it runs). Nothing but `hello` is accepted before it, and it must come within 10 s.
 *
 * ENROLLMENT — the `hello` of a node that has no row yet. `warden-enrollment.ts` spends the token and
 * writes the node in ONE transaction (two sockets with one token cannot both win); the link then
 * attaches and `welcome` carries the certificate and the checks. A refused enrollment sends `error`
 * and closes. CONNECT — an enrolled node: its hello is recorded, the link is attached (closing
 * any older link of the node) and `welcome` carries `ackedUpto`, the certificate again (so a warden
 * whose enrollment `welcome` was lost can still learn the key to pin), the checks only when the
 * warden's `checksVersion` differs from center's, and the catalog only when the node has a published
 * set that differs from the warden's `catalogVersion` (`catalog.service.ts` decides, and notes the
 * version the warden says it holds as acked).
 *
 * AFTER THE HANDSHAKE every frame counts as hearing the node (`wardenLinks.heard`), then is checked as
 * an envelope for THIS node. `heartbeat` keeps the clock offset, `checks.ack` the checks-acked
 * version, `result` goes through ingest and is acked once stored; a frame of any other type goes to
 * the handler a later plan registered for it, or is logged once per link and ignored (a newer warden
 * may speak frames this center does not). A frame the warden NUMBERED (its outbox: every `run.*`) shares
 * `result`'s counter, so it is judged against `acked_seq` the same way — a resend is answered and never
 * handled twice — and acked once its handler has returned; a frame whose handler threw is left unacked.
 *
 * After a connect's `welcome` the link announces the hello (`wardenLinks.announceHello`): the warden
 * says there which runs it still holds, which nothing else does.
 *
 * EVERY frame center sends goes through `send`: the envelope is serialised ONCE and signed as exactly
 * those bytes, so the warden verifies what it received and not a re-serialisation of it.
 *
 * Consumers: `warden-gateway.ts` (one `runWardenLink` per accepted upgrade).
 */

/** How long a socket may stay silent before its `hello`. */
const HELLO_DEADLINE_MS = 10_000;

/** Close codes of the 4000 range this link speaks; 4000 is `warden-links.ts`'s own ("replaced"). */
const CLOSE_HELLO_LATE = 4001;
const CLOSE_REFUSED = 4002;
const CLOSE_NOT_HELLO = 4003;

/** How many heartbeats the clock offset is the median of. */
const CLOCK_SAMPLES = 5;

type AdmittedUpgrade = Exclude<WardenAuthResult, { refused: unknown }>;

/** What center reads out of a `hello`: the parts it acts on, already checked for shape. */
type ReadHello = {
  version: string;
  facts: Record<string, unknown>;
  machineId: string | null;
  checksVersion: number | null;
  catalogVersion: number | null;
  /** When the warden process started, on its clock; null when it did not say. */
  startedAt: number | null;
  /** The runs whose child the warden still holds; null when it did not say (a build older than the runner). */
  activeRuns: string[] | null;
  /** The runs that are over but whose frames still wait on the warden's outbox; null when it does not report them. */
  owedRuns: string[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The median of a short list; an even count averages the two in the middle, rounded to a whole millisecond. */
function medianOf(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function readHello(body: unknown): ReadHello | null {
  if (!isRecord(body) || typeof body.version !== 'string' || !isRecord(body.facts)) return null;
  const checksVersion = body.checksVersion;
  if (checksVersion !== null && checksVersion !== undefined && !Number.isSafeInteger(checksVersion)) return null;
  const catalogVersion = body.catalogVersion;
  if (catalogVersion !== null && catalogVersion !== undefined && !Number.isSafeInteger(catalogVersion)) return null;
  const machineId = body.facts.machineId;
  const runs = isRecord(body.active) ? body.active.runs : undefined;
  const owed = isRecord(body.active) ? body.active.owed : undefined;
  const textList = (value: unknown): string[] | null =>
    Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : null;
  return {
    version: body.version,
    facts: body.facts,
    machineId: typeof machineId === 'string' ? machineId : null,
    checksVersion: (checksVersion as number | null | undefined) ?? null,
    catalogVersion: (catalogVersion as number | null | undefined) ?? null,
    // Lenient on purpose: a hello that cannot say what it holds is still a hello, and a listener that
    // is told "unknown" concludes nothing, where a refusal here would keep the warden from linking.
    startedAt: typeof body.startedAt === 'number' && Number.isFinite(body.startedAt) ? body.startedAt : null,
    activeRuns: textList(runs),
    owedRuns: textList(owed),
  };
}

/**
 * Starts the link on an authenticated socket. Everything from here is driven by the socket's own
 * events; nothing is returned because nothing outside needs to hold the link — `wardenLinks` does,
 * once the hello has been taken.
 */
export function runWardenLink(ws: WebSocket, admitted: AdmittedUpgrade): void {
  const node = admitted.kind === 'connect' ? admitted.node : admitted.name;
  const clockSamples: number[] = [];
  const unknownTypesLogged = new Set<string>();
  let helloTaken = false;
  let heartbeatsSeen = 0;
  let badFrameLogged = false;

  function send(type: string, body: unknown, id?: string): boolean {
    if (ws.readyState !== WS_OPEN_STATE) return false;
    const envelope: CerberusEnvelope<unknown> = {
      type,
      id: id ?? crypto.randomBytes(6).toString('hex'),
      node,
      seq: null,
      at: Date.now(),
      body,
    };
    const text = JSON.stringify(envelope);
    const frame: CerberusSignedFrame = { env: text, sig: signText(text) };
    ws.send(JSON.stringify(frame), (error) => {
      if (error) console.warn(`[Cerberus] could not send a "${type}" frame to node ${node}: ${error.message}`);
    });
    return true;
  }

  const link: CerberusWardenLink = {
    node,
    version: null,
    clockOffsetMs: null,
    send,
    close: (code, reason) => ws.close(code, reason),
  };

  /** Tells the warden why, then closes: `error` is the last frame of a refused link. */
  function refuse(message: string): void {
    send('error', { message });
    ws.close(CLOSE_REFUSED, message);
  }

  const helloDeadline = setTimeout(() => ws.close(CLOSE_HELLO_LATE, 'hello expected within 10 s'), HELLO_DEADLINE_MS);
  helloDeadline.unref();
  attachWebSocketHeartbeat(ws);

  function onHello(body: unknown, receivedAt: number): void {
    clearTimeout(helloDeadline);
    const hello = readHello(body);
    if (!hello) return refuse('hello is malformed');
    link.version = hello.version;

    if (admitted.kind === 'enroll') {
      const enrolled = enrollNode(admitted, hello, receivedAt);
      if ('refusal' in enrolled) return refuse(enrolled.refusal);
      helloTaken = true;
      wardenLinks.attach(link);
      wardenLinks.heard(node, receivedAt);
      send('welcome', { node, ackedUpto: 0, cert: enrolled.cert, checks: checksSetFor(node) } satisfies CerberusWelcomeBody);
      return;
    }

    const row = cerberusNodesDb.get(node);
    if (!row) return refuse('unknown node');
    cerberusNodesDb.recordHello(node, {
      warden_version: hello.version,
      machine_id: hello.machineId,
      facts: JSON.stringify(hello.facts),
    });
    helloTaken = true;
    wardenLinks.attach(link);
    wardenLinks.heard(node, receivedAt);
    // The certificate rides every connect's welcome as well: an enrollment whose own welcome was lost
    // would otherwise leave a warden that can connect but never learn the key it must pin.
    const welcome: CerberusWelcomeBody = {
      node,
      ackedUpto: row.acked_seq,
      cert: issueCert(node, row.cert_fingerprint, row.enrolled_at),
    };
    if (hello.checksVersion !== row.checks_version) welcome.checks = checksSetFor(node);
    const catalog = catalogForWelcome(node, hello.catalogVersion, receivedAt);
    if (catalog) welcome.catalog = catalog;
    if (send('welcome', welcome) && catalog) markCatalogSent(node, catalog.version);
    wardenLinks.announceHello(node, hello);
  }

  function onHeartbeat(env: CerberusEnvelope<unknown>, receivedAt: number): void {
    clockSamples.push(receivedAt - env.at);
    if (clockSamples.length > CLOCK_SAMPLES) clockSamples.shift();
    link.clockOffsetMs = medianOf(clockSamples);

    // A node's first heartbeat turns its tab row from "waiting" to reporting: the one beat worth a
    // look at the row before writing, and a hint after. Later beats cost the stamp's own gate.
    const firstEver = heartbeatsSeen === 0 && cerberusNodesDb.get(node)?.first_heartbeat_at === null;
    heartbeatsSeen += 1;
    cerberusNodesDb.recordHeartbeat(node, receivedAt);
    if (firstEver) hintChanged({ nodes: [node] });
  }

  function onChecksAck(body: unknown): void {
    const version = isRecord(body) ? body.version : undefined;
    if (typeof version === 'number' && Number.isSafeInteger(version)) cerberusNodesDb.setChecksAcked(node, version);
  }

  function onResult(env: CerberusEnvelope<unknown>): void {
    const seq = env.seq;
    if (seq === null || !Number.isSafeInteger(seq) || seq < 1) {
      console.warn(`[Cerberus] node ${node} sent a result frame without a usable seq; ignored`);
      return;
    }
    const row = cerberusNodesDb.get(node);
    // Already stored (a resend after a dropped ack): answer it, store nothing.
    if (row && seq <= row.acked_seq) {
      send('ack', { upto: seq });
      return;
    }
    // Ingest commits its own transaction; the ack goes out only after it has, and after the counter
    // a resend is judged against has moved. A crash between the two costs a resend that ingest skips.
    const results = isRecord(env.body) ? (env.body.results as CerberusResultWire[]) : [];
    ingest.ingestResults(node, seq, results);
    cerberusNodesDb.setAckedSeq(node, seq);
    send('ack', { upto: seq });
  }

  function routeFrame(env: CerberusEnvelope<unknown>, receivedAt: number): void {
    switch (env.type) {
      case 'heartbeat':
        return onHeartbeat(env, receivedAt);
      case 'checks.ack':
        return onChecksAck(env.body);
      case 'result':
        return onResult(env);
      default: {
        const handler = wardenLinks.handlerFor(env.type);
        if (!handler) {
          if (!unknownTypesLogged.has(env.type)) {
            unknownTypesLogged.add(env.type);
            console.warn(`[Cerberus] node ${node} sent a "${env.type}" frame this center does not know; ignored`);
          }
          return;
        }
        const seq = env.seq !== null && env.seq >= 1 ? env.seq : null;
        // Already handled (a resend after a dropped ack): answer it, handle nothing.
        if (seq !== null && seq <= (cerberusNodesDb.get(node)?.acked_seq ?? 0)) {
          send('ack', { upto: seq });
          return;
        }
        Promise.resolve(handler(node, env.body, env))
          .then(() => {
            if (seq === null) return;
            cerberusNodesDb.setAckedSeq(node, seq);
            send('ack', { upto: seq });
          })
          .catch((error) => {
            console.error(`[Cerberus] the "${env.type}" handler threw for node ${node}: ${error instanceof Error ? error.message : String(error)}`);
          });
      }
    }
  }

  /** The envelope in `data`, or the sentence saying why it is not one of this link's. */
  function readEnvelope(data: RawData, isBinary: boolean): CerberusEnvelope<unknown> | string {
    if (isBinary) return 'a binary frame';
    let parsed: unknown;
    try {
      // The default `binaryType` hands text frames over as one Buffer.
      parsed = JSON.parse((data as Buffer).toString('utf8'));
    } catch {
      return 'text that is not JSON';
    }
    if (!isRecord(parsed)) return 'JSON that is not an envelope';
    if (typeof parsed.type !== 'string' || typeof parsed.id !== 'string') return 'an envelope without a type and an id';
    if (parsed.node !== node) return `an envelope for another node (${JSON.stringify(parsed.node)})`;
    if (parsed.seq !== null && !Number.isSafeInteger(parsed.seq)) return 'an envelope whose seq is not a whole number or null';
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return 'an envelope whose at is not a time';
    if (!isRecord(parsed.body)) return 'an envelope whose body is not an object';
    return parsed as CerberusEnvelope<unknown>;
  }

  ws.on('message', (data, isBinary) => {
    const receivedAt = Date.now();
    const envelope = readEnvelope(data, isBinary);
    try {
      if (!helloTaken) {
        if (typeof envelope === 'string' || envelope.type !== 'hello') {
          ws.close(CLOSE_NOT_HELLO, 'hello expected first');
          return;
        }
        onHello(envelope.body, receivedAt);
        return;
      }
      wardenLinks.heard(node, receivedAt);
      if (typeof envelope === 'string') {
        if (!badFrameLogged) {
          badFrameLogged = true;
          console.warn(`[Cerberus] node ${node} sent ${envelope}; ignored`);
        }
        return;
      }
      routeFrame(envelope, receivedAt);
    } catch (error) {
      console.error(`[Cerberus] handling a frame of node ${node} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ws.on('error', (error) => {
    console.warn(`[Cerberus] the link of node ${node} errored: ${error.message}`);
  });

  ws.on('close', () => {
    clearTimeout(helloDeadline);
    wardenLinks.detach(link);
  });
}
