import { isRecord } from '@/shared/document-fields.js';
import type { CerberusNodeHost, CerberusNodeHostLastTurn } from '@/shared/cerberus-types.js';
import type { IdleCheck } from '@/shared/types.js';

/** A list of strings, or `[]` for anything else — a warden from before the field sends none. */
function readTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** The meta's idle-check record when it is two finite numbers, else null (the registry applies the same test on the node). */
function readIdleCheck(value: unknown): IdleCheck | null {
  if (!isRecord(value)) return null;
  const { at, tries } = value;
  return typeof at === 'number' && Number.isFinite(at) && typeof tries === 'number' && Number.isFinite(tries) ? { at, tries } : null;
}

/**
 * The warden's record of a host's last finished turn, or null when it is absent or has no usable `endedAt`. `request`
 * is kept only when it is a record: it is handed to the API's own token reading, which judges what is in it.
 */
function readLastTurn(value: unknown): CerberusNodeHostLastTurn | null {
  if (!isRecord(value) || typeof value.endedAt !== 'number' || !Number.isFinite(value.endedAt)) return null;
  const request = isRecord(value.request) ? (value.request as CerberusNodeHostLastTurn['request']) : null;
  return { endedAt: value.endedAt, modelUsage: value.modelUsage ?? null, request };
}

/**
 * One listed host, made into exactly a `CerberusNodeHost`: a field of the wrong type becomes its
 * empty value, so a consumer walking the cache never meets `undefined` or a string where a list is
 * expected. Null when the two fields everything keys on — `hostId`, `appSessionId` — are not strings.
 *
 * `releasedCalls`, `liveTasks`, `idleCheck` and `lastTurn` are the fields a re-adopted node chat needs to be
 * released and compacted as a local one is; a warden that predates one lists none of it, which reads as the empty
 * value and leaves that chat as it was. The one exception is `liveTasks`, which reads as `null`: "no task listed"
 * and "this warden cannot say" are different answers, and only the first may let a compaction end the process
 * (`compaction/node-task-ledger.ts`).
 *
 * consumer: node-sessions.ts (`sessions.listed`)
 */
export function readNodeHost(value: unknown): CerberusNodeHost | null {
  if (!isRecord(value) || typeof value.hostId !== 'string' || typeof value.appSessionId !== 'string') return null;
  const text = (field: unknown): string | null => (typeof field === 'string' ? field : null);
  const finite = (field: unknown): number | null => (typeof field === 'number' && Number.isFinite(field) ? field : null);
  return {
    hostId: value.hostId,
    appSessionId: value.appSessionId,
    userId: typeof value.userId === 'string' || typeof value.userId === 'number' ? value.userId : null,
    cwd: text(value.cwd),
    startedAt: finite(value.startedAt) ?? 0,
    turnCompleteSent: value.turnCompleteSent === true,
    heldForBackgroundWork: value.heldForBackgroundWork === true,
    deferredTools: readTextList(value.deferredTools),
    releasedCalls: readTextList(value.releasedCalls),
    liveTasks: Array.isArray(value.liveTasks) ? readTextList(value.liveTasks) : null,
    idleCheck: readIdleCheck(value.idleCheck),
    profile: isRecord(value.profile) ? value.profile : null,
    cliVersion: text(value.cliVersion),
    cliPid: Number.isSafeInteger(value.cliPid) ? (value.cliPid as number) : null,
    lastTurnFinishedAt: finite(value.lastTurnFinishedAt),
    lastTurn: readLastTurn(value.lastTurn),
  };
}
