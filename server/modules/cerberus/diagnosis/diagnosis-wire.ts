import crypto from 'node:crypto';

import type {
  CerberusDiagCallBody,
  CerberusDiagCloseBody,
  CerberusDiagOpenBody,
  CerberusDiagResultBody,
  CerberusDiagTool,
} from '@/shared/cerberus-types.js';

import { wardenLinks } from '../warden-links.js';

/**
 * Center's half of the diagnosis wire: the session it opens on a node's warden, the reads it sends
 * down it, and the answers it routes back — `diag.open` / `diag.opened`, `diag.call` / `diag.result`,
 * `diag.close`. The frames are `CerberusDiagOpenBody` and its four siblings in `cerberus-types.ts`,
 * whose banner is the contract; none rides the outbox and none is resent.
 *
 * ROUTING IS BY `callId`. Every `diag.call` gets an id of its own, and `diag.result` is matched to it
 * — and only if the frame names the node the call went to and the diagnosis it was for, so one warden
 * can never answer another node's read. A result that matches nothing (a read killed at 10 s that
 * raced the close, a diagnosis that already failed) is dropped without a word: the wire's banner says
 * center keeps no state for one. A frame that is not the shape it was sent in is logged and dropped. An
 * answer's text is held to the contract's 64 KB here as well (`truncated` then true): the warden caps
 * what it sends, and center does not trust that with the model's context.
 *
 * NOTHING HERE FAILS A DIAGNOSIS. A call whose frame could not be put on the link, or that nobody
 * answered, REJECTS, and `diagnosis-tools.ts` turns that into an answer the agent reads and works
 * around; it is the service's own link-lost handling that ends a diagnosis (`abandonCallsOf` then
 * lets go of what it was still waiting for). Every wait here ends on the frame it waits for or on a
 * deadline, and is `unref`'d: a process asked to exit is not held for a warden.
 *
 * Consumers: `diagnosis-deps.ts` (`callNode`), `diagnosis.service.ts` (`openNodeSession`,
 * `closeNodeSession`, `abandonCallsOf`) and the module's start (`registerDiagnosisFrames`).
 */

/** How long a `diag.open` waits for its `diag.opened`: a warden answers at once, so silence means it does not know the frame. */
const OPEN_WAIT_MS = 5000;

/**
 * How long a call is held for its answer. The warden kills a read at 10 s and always answers, and the
 * tool gives up on its side at 15 s, so past this nobody is waiting and the entry is let go.
 */
const CALL_DEADLINE_MS = 20_000;

/** The most text of one `diag.result` that reaches the agent: the contract's cap (`CerberusDiagResultBody`), in UTF-8 bytes. */
const MAX_RESULT_BYTES = 65_536;

/** What a read of the node answers: the three fields of a `diag.result` the agent reads. */
export type NodeReadAnswer = Pick<CerberusDiagResultBody, 'ok' | 'text' | 'truncated'>;

type PendingCall = {
  diagId: string;
  node: string;
  resolve: (answer: NodeReadAnswer) => void;
  reject: (reason: Error) => void;
  deadline: NodeJS.Timeout;
};

type PendingOpen = { node: string; resolve: (opened: boolean) => void; deadline: NodeJS.Timeout };

const pendingCalls = new Map<string, PendingCall>();
const pendingOpens = new Map<string, PendingOpen>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * How a session open came out: `opened` (the warden's receipt), `no_link` (the frame could not be put
 * on a link — the node dropped between the check and the send) or `no_answer` (the warden never
 * answered: a release from before diagnoses ignores a frame it does not know).
 */
export type SessionOpening = 'opened' | 'no_link' | 'no_answer';

/** Sends `diag.open` and waits for the warden's `diag.opened` — or the deadline. */
export function openNodeSession(node: string, diagId: string, check: string): Promise<SessionOpening> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      pendingOpens.delete(diagId);
      resolve('no_answer');
    }, OPEN_WAIT_MS);
    deadline.unref();
    pendingOpens.set(diagId, {
      node,
      resolve: (opened) => resolve(opened ? 'opened' : 'no_link'),
      deadline,
    });
    if (!wardenLinks.send(node, 'diag.open', { diagId, check } satisfies CerberusDiagOpenBody)) {
      clearTimeout(deadline);
      pendingOpens.delete(diagId);
      resolve('no_link');
    }
  });
}

/**
 * Lets go of an open still being waited for — the diagnosis ended before the warden answered. Its waiter
 * is released as `no_link` so the loop that awaits it carries on (and finds its diagnosis already over)
 * instead of waiting for a receipt nobody will read.
 */
function forgetOpen(diagId: string): void {
  const pending = pendingOpens.get(diagId);
  if (!pending) return;
  clearTimeout(pending.deadline);
  pendingOpens.delete(diagId);
  pending.resolve(false);
}

/** Sends `diag.close`; answers whether it went. A warden that never hears it ends the session on `link.down`. */
export function closeNodeSession(node: string, diagId: string): boolean {
  forgetOpen(diagId);
  return wardenLinks.send(node, 'diag.close', { diagId } satisfies CerberusDiagCloseBody);
}

/**
 * Sends one read to the node and resolves with its answer. Rejects when the frame could not be put on
 * the link, when nobody answered within `CALL_DEADLINE_MS`, or when `abandonCallsOf` let go of it.
 */
export function callNode(node: string, diagId: string, tool: CerberusDiagTool, args: Record<string, unknown>): Promise<NodeReadAnswer> {
  return new Promise((resolve, reject) => {
    const callId = crypto.randomBytes(6).toString('hex');
    const deadline = setTimeout(() => {
      pendingCalls.delete(callId);
      reject(new Error(`${node} did not answer the read`));
    }, CALL_DEADLINE_MS);
    deadline.unref();
    pendingCalls.set(callId, { diagId, node, resolve, reject, deadline });

    const body: CerberusDiagCallBody = { diagId, callId, tool, args };
    if (!wardenLinks.send(node, 'diag.call', body)) {
      clearTimeout(deadline);
      pendingCalls.delete(callId);
      reject(new Error(`the link to ${node} is closed`));
    }
  });
}

/** Lets go of every read still waiting on `diagId`'s node: each rejects with `reason`. The diagnosis ended; nobody needs the answers. */
export function abandonCallsOf(diagId: string, reason: Error): void {
  forgetOpen(diagId);
  for (const [callId, pending] of [...pendingCalls]) {
    if (pending.diagId !== diagId) continue;
    clearTimeout(pending.deadline);
    pendingCalls.delete(callId);
    pending.reject(reason);
  }
}

function onOpened(node: string, body: unknown): void {
  if (!isRecord(body) || typeof body.diagId !== 'string') {
    console.warn(`[Cerberus] node ${node} sent a "diag.opened" frame that names no diagnosis; ignored`);
    return;
  }
  const pending = pendingOpens.get(body.diagId);
  // A receipt for an open nobody waits for any more (it timed out, or the diagnosis ended) says nothing now.
  if (!pending || pending.node !== node) return;
  clearTimeout(pending.deadline);
  pendingOpens.delete(body.diagId);
  pending.resolve(true);
}

function onResult(node: string, body: unknown): void {
  if (!isRecord(body) || typeof body.diagId !== 'string' || typeof body.callId !== 'string' || typeof body.ok !== 'boolean' || typeof body.text !== 'string') {
    console.warn(`[Cerberus] node ${node} sent a "diag.result" frame that is not a result; ignored`);
    return;
  }
  const pending = pendingCalls.get(body.callId);
  if (!pending || pending.node !== node || pending.diagId !== body.diagId) return;
  clearTimeout(pending.deadline);
  pendingCalls.delete(body.callId);
  const held = holdToContractCap(body.text);
  pending.resolve({ ok: body.ok, text: held.text, truncated: body.truncated === true || held.cut });
}

/**
 * `text` held to the contract's 64 KB (UTF-8 bytes) — and `cut` saying whether it was. The warden already
 * caps what it sends; the gateway admits frames of 8 MiB, and a warden that missed its cap would otherwise
 * put sixteen reads of that into one model's context. A cut through the middle of a multi-byte character
 * leaves a replacement character at the end, which is dropped.
 */
function holdToContractCap(text: string): { text: string; cut: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES) return { text, cut: false };
  const head = Buffer.from(text, 'utf8').subarray(0, MAX_RESULT_BYTES).toString('utf8');
  return { text: head.replace(/�$/, ''), cut: true };
}

/** Registers the two frames a warden answers a diagnosis with. Called once at the module's start, before the gateway binds: a second registration throws. */
export function registerDiagnosisFrames(): void {
  wardenLinks.registerHandler('diag.opened', onOpened);
  wardenLinks.registerHandler('diag.result', onResult);
}
