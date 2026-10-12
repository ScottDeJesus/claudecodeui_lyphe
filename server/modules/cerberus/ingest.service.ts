import {
  cerberusDefinitionsDb,
  cerberusResultsDb,
  getCerberusConnection,
  type CerberusActiveCheckRow,
  type CerberusLatestResultRow,
  type CerberusProbeRow,
} from '@/modules/database/index.js';
import type {
  CerberusCheckMemory,
  CerberusDocStatus,
  CerberusResultWire,
  CerberusStatus,
  CerberusStoredStatus,
} from '@/shared/cerberus-types.js';

import { checksReportingAtBoot } from './boot-vouch.js';
import { hintChanged } from './cerberus-broadcast.js';
import { CHECK_ID_PATTERN, SERVICE_ID_PATTERN } from './definition-document.js';
import { discoverComponent } from './definitions.service.js';

/**
 * Ingest: where a warden's results become rows — or, most of the time, deliberately do not.
 *
 * A healthy check repeats itself every 30 seconds for months, and storing each repeat would bury
 * the rows that say something: only a CHANGE is stored — a move of status or document status, or a
 * LAPSE — plus a KEEPALIVE copy every five minutes. A quiet stretch is continuity (the warden's
 * `prevAt` chain unbroken), worked out by the reader; a LAPSE — `prevAt` null, or a gap past
 * `staleAfter` — is itself a change. A VALUE that moves under an unchanged status is NOT a change:
 * the sentences the checks carry hold timings and counters, which would make nearly every result one
 * (measured: 97 % of the change rows). The store keeps such a value in its keep-alive only; the newest
 * one lives in memory (`newest`), and the read model shows it while it is newer than the stored row.
 *
 * THE STORAGE RULE, against `lastStored` (the check's last stored row, held in memory):
 *   - `at ≤ lastStored.at`        skip: a resend, or an older result than the store holds;
 *   - no `lastStored`, or status or doc status differ, or `prevAt` is null, or
 *     `at − prevAt > staleAfter`  CHANGE;
 *   - else `at − lastStored.at ≥ 300 000`, or a keepalive was asked for  KEEPALIVE, the result whole
 *     (its newest value and data); else nothing is stored.
 * A stored row's `prev_status` is `lastStored`'s status (`not_enabled` for a null one) and NULL when
 * there was none; every accepted result — stored or not — sets `lastReceivedAt` (at boot, a check
 * that was reporting just before it gets the boot's moment, so a handover does not blank the board)
 * and, when its `at` is newer than the one held, `newest` (empty at boot: the read model falls back
 * to the stored row until the check's next result); `since` moves when a stored row's status differs
 * from its `prev_status`.
 *
 * ONE TRANSACTION PER CALL, MEMORY AFTER IT. A frame is stored whole or not at all, and memory
 * advances only once it has committed, so a rolled-back frame's resend is judged against the truth.
 * A REFUSED result (a key the node does not own, a word outside the vocabulary, a field of the
 * wrong type, an `at` from the future) is dropped and logged once, never thrown: a frame that
 * threw would never be acked, and the warden would resend the same bad result for ever.
 *
 * Consumers: `warden-link.ts` (`ingestResults` for a `result` frame, acking after it returns),
 * `self-checks.service.ts` (center's own results, `seq` null; `reseedNode` before its first tick),
 * `warden-link.ts` (`reseedNode` at a connect's hello), the read model (`memory`), the boot
 * (`seedMemory`) and `auto-run.ts` (`onChange`).
 */

/** Every `keepalive` copy waits at least this long after the last stored row. */
const KEEPALIVE_AFTER_MS = 300_000;

/**
 * How far past this clock a result's `at` may be and still be believed. Further ahead is refused:
 * stored, it would become `lastStored` and every honest result after it would be skipped as older
 * until real time caught up, in a table nothing rewrites.
 */
const MAX_FUTURE_SKEW_MS = 300_000;

const STORED_STATUSES: readonly string[] = ['ok', 'warn', 'failing', 'denied'];
const DOC_STATUSES: readonly string[] = ['green', 'yellow', 'red', 'muted'];

/** The part of a check's last stored row the next result is judged against. */
type LastStored = { at: number; status: CerberusStoredStatus | null; docStatus: CerberusDocStatus | null };

/** A check's newest accepted result, stored or not: what the read model shows while it is newer than the stored row. */
type NewestResult = { at: number; value: string | null };

/** One status that moved (`from` null at first sight; `not_enabled` spells a null). Consumer: `auto-run.ts`, via `onChange`. */
export type CerberusStatusChange = { key: string; from: CerberusStatus | null; to: CerberusStatus; at: number };

/** What `ingest.onChange` listeners receive: one call per ingested frame, naming every check that moved. */
type StatusChangeListener = (change: { node: string; changed: CerberusStatusChange[] }) => void;

const lastStored = new Map<string, LastStored>();
const sinceByCheck = new Map<string, number>();
const lastReceivedByCheck = new Map<string, number>();
const newestByCheck = new Map<string, NewestResult>();
const listeners = new Set<StatusChangeListener>();
const refusalsLogged = new Set<string>();
/** Whether `seedMemory` has filled the maps above from the store: it runs once per process. */
let memorySeeded = false;

/** `<node>/<key>`: unambiguous because a node never holds a `/`, and the same spelling the hint uses. */
function memoryKey(node: string, key: string): string {
  return `${node}/${key}`;
}

/** Sets what memory holds of a check from the store's own newest row for it: `lastStored` and `since`. */
function rememberStoredRow(row: CerberusLatestResultRow): void {
  const slot = memoryKey(row.node, row.check_key);
  lastStored.set(slot, {
    at: row.at,
    status: row.status as CerberusStoredStatus | null,
    docStatus: row.doc_status as CerberusDocStatus | null,
  });
  sinceByCheck.set(slot, row.since);
}

function logRefusalOnce(node: string, key: string, reason: string): void {
  const signature = `${memoryKey(node, key)}: ${reason}`;
  if (refusalsLogged.has(signature)) return;
  if (refusalsLogged.size >= 500) refusalsLogged.clear(); // a stuck warden must not grow this for ever
  refusalsLogged.add(signature);
  console.warn(`[Cerberus] refused a result of ${node}: ${reason} (check ${JSON.stringify(key)})`);
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** The service part of a key, when the key is `<service>/<id>` in the grammar; else null. */
function serviceOfKey(key: unknown): string | null {
  if (typeof key !== 'string') return null;
  const slash = key.indexOf('/');
  if (slash < 0) return null;
  return SERVICE_ID_PATTERN.test(key.slice(0, slash)) && CHECK_ID_PATTERN.test(key.slice(slash + 1)) ? key.slice(0, slash) : null;
}

/**
 * Why a result is refused, or null when it is well formed and its words are in the vocabulary. An
 * ABSENT `value` or `docStatus` (a key JSON drops for an `undefined`) reads as null, as the other
 * optional fields do; `status` must be written, since a missing one is not "not enabled".
 */
function shapeRefusal(result: CerberusResultWire, now: number): string | null {
  if (!isWholeNumber(result.at)) return '`at` is not a whole number of milliseconds';
  if (result.at > now + MAX_FUTURE_SKEW_MS) return '`at` is more than five minutes ahead of this clock';
  if (typeof result.source !== 'string') return '`source` is not a probe key';
  if (result.status !== null && !STORED_STATUSES.includes(result.status)) return `status "${String(result.status)}" is not a status`;
  const docStatus = result.docStatus ?? null;
  if (docStatus !== null && !DOC_STATUSES.includes(docStatus)) return `doc status "${String(docStatus)}" is not a document status`;
  const value = result.value ?? null;
  if (value !== null && typeof value !== 'string') return '`value` is not text';
  return null;
}

type KeyOwner = { probe: CerberusProbeRow; component: boolean };

/**
 * Whether the node owns the key, and through which probe: the probe whose key it equals, or the
 * health_doc probe it is a component of (the key begins with that probe's service and a `/`).
 * Answers the reporting probe and whether the key is a component of it, or the sentence saying why
 * it is not the node's. A key that IS a probe's own key is that probe's alone (its results carry
 * the probe's key as `source`): the same key from the health document is refused, or the two
 * writers would interleave on one check and every flip would reach the auto-run listeners.
 */
function ownerOf(probes: Map<string, CerberusProbeRow>, key: string, source: string): KeyOwner | string {
  const own = probes.get(key);
  if (own) {
    return source === key ? { probe: own, component: false } : `the key is a probe's own, but the result's source is ${JSON.stringify(source)}`;
  }
  const documentProbe = probes.get(source);
  if (documentProbe && documentProbe.kind === 'health_doc' && key.startsWith(`${documentProbe.service}/`)) {
    return { probe: documentProbe, component: true };
  }
  return `the node has no probe ${JSON.stringify(source)} that reports it`;
}

/** A check's staleness in ms: `activeChecks`' rule, mirrored for a check with no row yet. */
function staleAfterMs(active: CerberusActiveCheckRow | undefined, probe: CerberusProbeRow): number {
  return (active?.stale_after_s ?? 3 * (probe.cadence ?? probe.every)) * 1000;
}

type FrameOutcome = {
  stored: number;
  /** Keys of the stored `change` rows: what on screen may now read differently. */
  changedKeys: string[];
  /** Keys of the components this frame filed; hinted after the commit, never before it. */
  discoveredKeys: string[];
  moved: CerberusStatusChange[];
  staged: {
    lastStored: Map<string, LastStored>;
    since: Map<string, number>;
    received: Map<string, number>;
    newest: Map<string, NewestResult>;
  };
};

/** The body of one frame's transaction: judges and inserts every result, and stages what memory will become. */
function storeFrame(node: string, seq: number | null, results: CerberusResultWire[], keepalive: boolean): FrameOutcome {
  const probes = new Map(cerberusDefinitionsDb.probesOf(node).map((probe) => [probe.key, probe]));
  const activeByKey = new Map(cerberusDefinitionsDb.activeChecks(node).map((check) => [check.key, check]));
  const outcome: FrameOutcome = {
    stored: 0,
    changedKeys: [],
    discoveredKeys: [],
    moved: [],
    staged: { lastStored: new Map(), since: new Map(), received: new Map(), newest: new Map() },
  };
  const now = Date.now();

  for (const result of results) {
    const key = result?.check;
    if (serviceOfKey(key) === null) {
      logRefusalOnce(node, String(key), 'the key is not <service>/<id>');
      continue;
    }
    const owner = ownerOf(probes, key, result.source);
    if (typeof owner === 'string') {
      logRefusalOnce(node, key, owner);
      continue;
    }
    const refusal = shapeRefusal(result, now);
    if (refusal) {
      logRefusalOnce(node, key, refusal);
      continue;
    }
    // After every test, so a refused result leaves no check behind; a retired component is revived.
    if (owner.component && !activeByKey.has(key)) {
      discoverComponent(node, key, owner.probe.key, now);
      outcome.discoveredKeys.push(key);
    }

    const slot = memoryKey(node, key);
    outcome.staged.received.set(slot, Math.max(outcome.staged.received.get(slot) ?? lastReceivedByCheck.get(slot) ?? result.at, result.at));
    const value = result.value ?? null;
    const heldNewest = outcome.staged.newest.get(slot) ?? newestByCheck.get(slot);
    if (!heldNewest || result.at > heldNewest.at) outcome.staged.newest.set(slot, { at: result.at, value });
    const last = outcome.staged.lastStored.get(slot) ?? lastStored.get(slot);
    if (last && result.at <= last.at) continue;

    const prevAt = isWholeNumber(result.prevAt) ? result.prevAt : null;
    const lapsed = prevAt === null || result.at - prevAt > staleAfterMs(activeByKey.get(key), owner.probe);
    const docStatus = result.docStatus ?? null;
    const changed = !last || result.status !== last.status || docStatus !== last.docStatus || lapsed;
    if (!changed && !keepalive && result.at - (last?.at ?? 0) < KEEPALIVE_AFTER_MS) continue;

    const previousStatus = last ? (last.status ?? 'not_enabled') : null;
    const shownStatus = result.status ?? 'not_enabled';
    const inserted = cerberusResultsDb.insert({
      node,
      check_key: key,
      at: result.at,
      source: result.source,
      seq,
      fetched_at: isWholeNumber(result.fetchedAt) ? result.fetchedAt : null,
      status: result.status,
      doc_status: docStatus,
      value,
      data: result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? JSON.stringify(result.data) : null,
      took_ms: isWholeNumber(result.tookMs) ? result.tookMs : null,
      prev_at: prevAt,
      prev_status: previousStatus,
      kind: changed ? 'change' : 'keepalive',
    });
    // A row already under this `at` was written behind memory's back (a handover's other process).
    if (!inserted) continue;

    outcome.stored += 1;
    outcome.staged.lastStored.set(slot, { at: result.at, status: result.status, docStatus });
    if (changed) outcome.changedKeys.push(key);
    if (previousStatus === null || previousStatus !== shownStatus) {
      outcome.staged.since.set(slot, result.at);
      outcome.moved.push({ key, from: previousStatus, to: shownStatus, at: result.at });
    }
  }
  return outcome;
}

/**
 * Judges and stores a warden's results for `node` in one transaction; answers how many rows it
 * stored and which checks changed. `seq` is null for center's own self-checks. Ack AFTER it returns.
 * `keepalive` stores an unchanged result now rather than after five quiet minutes (a clean stop's last word).
 */
function ingestResults(node: string, seq: number | null, results: CerberusResultWire[], keepalive = false): { stored: number; changed: string[] } {
  // A frame whose `results` is not a list is refused whole, and acked all the same.
  if (!Array.isArray(results)) {
    logRefusalOnce(node, '(frame)', '`results` is not a list');
    return { stored: 0, changed: [] };
  }
  const outcome = getCerberusConnection()
    .transaction(() => storeFrame(node, seq, results, keepalive))
    .immediate();

  // Committed: only now does memory move.
  for (const [slot, entry] of outcome.staged.lastStored) lastStored.set(slot, entry);
  for (const [slot, at] of outcome.staged.since) sinceByCheck.set(slot, at);
  for (const [slot, at] of outcome.staged.received) lastReceivedByCheck.set(slot, at);
  for (const [slot, entry] of outcome.staged.newest) newestByCheck.set(slot, entry);

  // A frame that rolled back threw above and hinted nothing.
  const hintedKeys = [...new Set([...outcome.changedKeys, ...outcome.discoveredKeys])];
  if (hintedKeys.length > 0) hintChanged({ nodes: [node], checks: hintedKeys.map((key) => memoryKey(node, key)) });
  if (outcome.moved.length > 0) {
    for (const listener of listeners) {
      try {
        listener({ node, changed: outcome.moved });
      } catch (error) {
        console.error(`[Cerberus] an ingest listener threw for node ${node}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { stored: outcome.stored, changed: outcome.changedKeys };
}

/**
 * Ingest's five doors: `ingestResults`; `onChange` (status moves; answers its unsubscribe);
 * `seedMemory` (once per process, before the first read or the module's `start()`, whichever comes
 * first: fills `lastStored` and `since` from the store, and `lastReceivedAt` with the boot's own
 * moment for each check that was reporting just before it — `boot-vouch.ts`); `reseedNode` (one
 * node's memory re-read from the store, at each of its hellos and before center's own first
 * self-check tick: the store, not this process, knows what a retiring process stored); and `memory`,
 * the read model's `CerberusCheckMemory` — `lastReceivedAt` is null for a check not vouched at boot
 * until a result of it arrives, and `newest` is null for every check until its first result of this
 * process (a boot does not seed it: the store holds no value newer than its own rows).
 */
export const ingest = {
  ingestResults,

  onChange(listener: StatusChangeListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  seedMemory(): void {
    // Once per process: a second pass would overwrite what real results have since written (and vouch
    // again for checks that have been quiet since). Set only after the store answered, so a failed read retries.
    if (memorySeeded) return;
    const latest = cerberusResultsDb.latestPerCheck();
    for (const { node, key, at } of checksReportingAtBoot(latest, Date.now(), KEEPALIVE_AFTER_MS)) {
      lastReceivedByCheck.set(memoryKey(node, key), at);
    }
    for (const row of latest) rememberStoredRow(row);
    memorySeeded = true;
  },

  /**
   * Re-reads one node's memory from the store, at its hello. A retiring process keeps its warden links
   * until it exits (center D12), so it stores rows after its successor has seeded, and the successor
   * never saw them: judged against that stale memory, a result is stamped with the wrong `prev_status`
   * and a `since` and an auto-run move that never happened follow. One process at a time holds a node's
   * link and the warden reconnects only after the old socket has closed, so at the hello the store
   * holds every row any process stored for the node. For each of the node's checks the store has a
   * row for, `lastStored` and `since` become the store's own and `lastReceivedAt` is RAISED to the
   * row's `at` where memory is older (never lowered: the boot vouch and live receipts stand); a check
   * of the node the store has no row for is dropped from every map. Opens no transaction: it reads.
   */
  reseedNode(node: string): void {
    const stored = new Set<string>();
    for (const row of cerberusResultsDb.latestPerCheck(node)) {
      const slot = memoryKey(row.node, row.check_key);
      stored.add(slot);
      rememberStoredRow(row);
      if ((lastReceivedByCheck.get(slot) ?? Number.NEGATIVE_INFINITY) < row.at) lastReceivedByCheck.set(slot, row.at);
    }
    const nodePrefix = `${node}/`;
    for (const perCheckMap of [lastStored, sinceByCheck, lastReceivedByCheck, newestByCheck]) {
      for (const slot of perCheckMap.keys()) {
        if (slot.startsWith(nodePrefix) && !stored.has(slot)) perCheckMap.delete(slot);
      }
    }
  },

  memory(node: string, key: string): CerberusCheckMemory {
    const slot = memoryKey(node, key);
    return {
      lastReceivedAt: lastReceivedByCheck.get(slot) ?? null,
      since: sinceByCheck.get(slot) ?? null,
      newest: newestByCheck.get(slot) ?? null,
    };
  },
};
