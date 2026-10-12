import {
  cerberusNodesDb,
  cerberusUpdatesDb,
  getCerberusConnection,
  type CerberusUpdateResult,
  type CerberusUpdateRow,
} from '@/modules/database/index.js';
import type { CerberusUpdateOfferBody, CerberusUpdateStep } from '@/shared/cerberus-types.js';

import { hintUpdateMoved } from './cerberus-broadcast.js';
import { wardenReleaseUrl } from './warden-files.js';
import { wardenLinks, type CerberusHelloReport } from './warden-links.js';
import { readLatestBuild, type WardenBuild } from './warden-release.js';

/**
 * The updates driver: takes the live updates of a batch ONE AT A TIME, offers each its release, and
 * ends each in words. The rows are the truth (`updates` and `update_steps`); what this file keeps in
 * memory is only WHICH update is being worked on and the clock that gives it up.
 *
 * THE TURN. The oldest live update (`running()[0]`, which is the order the batch was written) is the
 * ACTIVE one. `advanceUpdates` makes it active, signs an `update.offer` for it and puts it on the
 * node's link; when it ends, whatever way, the next one is made active. A node's offer is never
 * queued: an offer that finds no link is simply not sent, and the node's next `hello` — the event that
 * says it is back — sends it, for as long as the active update has heard nothing from its warden.
 * The same rule recovers a center that restarted mid-batch: `registerUpdatesService` calls
 * `advanceUpdates` at start, and the node's reconnect does the rest.
 *
 * HOW AN UPDATE ENDS — exactly once, the first end winning (the store's `end` answers whether this
 * call ended it):
 *   - the warden says `failed` (a step of its own): `failed`, its sentence the note;
 *   - the warden says `verified` while its reported version is already the release: `updated` — an
 *     offer for what it already runs never restarts it, so no hello will follow;
 *   - the node's next `hello` names the update: `{ to }` ends it `updated`, `{ failed, reason }` —
 *     the launcher having taken the new release back — ends it `rolled_back` with the reason;
 *   - three minutes pass with no step: `failed`, "No word from the warden for 3 min". The clock is
 *     one deadline per active update, reset by every step it stores — not a poll of anything. After a
 *     `waiting` step it is the warden's own give-up (10 minutes) plus a margin instead, and reads "…for 10
 *     min": `waiting` is the warden's promise of another step, so a fix that runs for five minutes is a
 *     warden doing what it should, not one gone quiet.
 * An end that is not the warden's own word (a rollback, the silence) is also written as the update's
 * last step, filed under `failed`, so the dialog's list of steps says how it ended.
 *
 * THE ONE AMENDMENT. Center ends an update `updated` on the hello that names the new release, but the
 * launcher's probation ends only when the release has answered its welcome and written its own mark: a
 * release that dies between the two is taken back, and the old release's hello then carries `failed` for
 * an update that is already over. A `failed` hello for an update that ended `updated` less than
 * `LATE_ROLLBACK_WINDOW_MS` ago (the launcher's 60 s probation and its restart, with room), whose release
 * is the one that `failed` names, amends it: `rolled_back`, with the same sentence a live rollback files
 * (`cerberusUpdatesDb.rolledBackAfterUpdated`, one transaction). Nothing else reopens an ended update.
 *
 * THE NODE IS CLOSED TO NEW WORK while its update is the active one (`cerberusUpdatesDb.activeNode()`):
 * a warden does not restart under its own work, and a `run.start` or `diag.open` sent after its last idle
 * check would be killed by the clean stop. `runs.service.ts`, `auto-run.ts` and the diagnosis service each
 * hold their start to it; this file only keeps the update active until it ends.
 *
 * Consumers: `updates.service.ts` (`advanceUpdates`, `setOfferAddress`, the two frame handlers and
 * `reportedWardenVersion`).
 */

/** How long the active update may go without a step before it is given up. */
const SILENCE_LIMIT_MS = 3 * 60 * 1000;
/**
 * The same, after a `waiting` step. The warden waits for the fixes it sees running for up to 10 minutes
 * (`WAIT_LIMIT_MS` in `warden/src/update.mjs`) and always ends the wait with a step of its own —
 * `uploading`, or `failed` "Gave up waiting…" — so center's deadline is that limit plus a margin for the
 * frame's trip. Each repeated `waiting` (the count of fixes moved) restarts it; the warden's own limit
 * does not restart, so its give-up still comes first.
 */
const WAITING_LIMIT_MS = 10 * 60 * 1000 + 30_000;
/**
 * How long after an update ended `updated` a hello's `failed` for it still turns it `rolled_back`: the
 * launcher's probation (60 s, ended by the new release's own mark) and its restart onto the old release,
 * with room to spare.
 */
const LATE_ROLLBACK_WINDOW_MS = 120_000;

const STEP_WORDS: ReadonlySet<string> = new Set<CerberusUpdateStep>([
  'waiting',
  'uploading',
  'verified',
  'swapping',
  'restarting',
  'failed',
]);

/** `CERBERUS_LISTEN` as the module read it; null when the gateway is not configured (no warden can be linked then). */
let listenAddress: string | null = null;
/** The update being worked on, or null. Only `advanceUpdates` sets it and only `endUpdate` clears it. */
let activeUpdateId: string | null = null;
let silenceTimer: NodeJS.Timeout | null = null;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The node's warden version as center last heard it — the open link's, else the one its last hello
 * stored; null for a node that has never said. Consumers: this file, and `updates.service.ts` for a
 * batch's `from` and the fleet's `behind`.
 */
export function reportedWardenVersion(node: string): string | null {
  return wardenLinks.states().get(node)?.version ?? cerberusNodesDb.get(node)?.warden_version ?? null;
}

/**
 * Starts the one deadline of the active update, replacing the last. The limit follows the update's newest
 * stored step (`WAITING_LIMIT_MS` after a `waiting`, else `SILENCE_LIMIT_MS`), so a center that restarts
 * while a warden waits for a fix arms the long one too, and the note says how long the silence was.
 */
function armSilenceTimer(updateId: string): void {
  const limitMs = cerberusUpdatesDb.steps(updateId).at(-1)?.step === 'waiting' ? WAITING_LIMIT_MS : SILENCE_LIMIT_MS;
  const note = `No word from the warden for ${Math.floor(limitMs / 60_000)} min`;
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    silenceTimer = null;
    // A timer's throw would end the process: this one is the net under every other way an update ends.
    try {
      endUpdate(updateId, 'failed', note, note);
    } catch (error) {
      console.error(`[Cerberus] could not end update ${updateId} after its silence: ${describe(error)}`);
    }
  }, limitMs);
  silenceTimer.unref();
}

/**
 * Ends the update with `result`, once. `closingText`, when given, is written first as its last step
 * under `failed` (an end that is not the warden's own word); both happen in one transaction, so an
 * update never shows its last step and still runs. Answers whether THIS call ended it. The screens
 * are hinted and the next update's turn begins only on a real end.
 */
function endUpdate(updateId: string, result: CerberusUpdateResult, note: string | null, closingText: string | null): boolean {
  const row = cerberusUpdatesDb.get(updateId);
  if (!row) return false;
  const now = Date.now();
  const ended = getCerberusConnection().transaction(() => {
    if (closingText !== null && cerberusUpdatesDb.insertStep(updateId, now, 'failed', closingText)) {
      cerberusUpdatesDb.setStep(updateId, 'failed');
    }
    return cerberusUpdatesDb.end(updateId, result, now, note);
  })();
  // Ended by this call or already over (another process on the same store got there first): either way
  // an update that is not live has no turn left to hold.
  if (activeUpdateId === updateId) {
    activeUpdateId = null;
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  if (ended) {
    console.log(`[Cerberus] the update of ${row.node} to ${row.to_version} ended ${result}${note ? `: ${note}` : ''}`);
    hintUpdateMoved({ nodes: [row.node] });
  }
  advanceUpdates();
  return ended;
}

/** Puts the signed offer for `build` on the node's link; false when the node has no link now. */
function sendOffer(row: CerberusUpdateRow, build: WardenBuild): boolean {
  const url = listenAddress === null ? null : wardenReleaseUrl(listenAddress, build.file);
  if (url === null) {
    const note = 'Cerberus has no warden address to offer a release from (CERBERUS_LISTEN)';
    endUpdate(row.id, 'failed', note, note);
    return false;
  }
  const offer: CerberusUpdateOfferBody = {
    updateId: row.id,
    version: build.version,
    url,
    sha256: build.sha256,
    size: build.size,
    note: build.note,
  };
  return wardenLinks.send(row.node, 'update.offer', offer);
}

/**
 * Offers the update's release to its node, as the release stands on disk NOW. An update queued for a
 * release that is no longer the latest ends `failed` and says so: the offer is signed over the hash of
 * the build that is there, and a release that moved on while the batch waited is a decision for a
 * person, not for the driver.
 */
async function offerUpdate(row: CerberusUpdateRow): Promise<void> {
  try {
    const build = await readLatestBuild();
    if (activeUpdateId !== row.id) return; // ended while the release was being read
    if (build === null || build.version !== row.to_version) {
      const note = build === null
        ? 'No warden release is built any more'
        : `Warden ${row.to_version} is no longer the release on offer (${build.version} is)`;
      endUpdate(row.id, 'failed', note, note);
      return;
    }
    sendOffer(row, build);
  } catch (error) {
    console.error(`[Cerberus] could not offer update ${row.id} to ${row.node}: ${describe(error)}`);
  }
}

/**
 * Starts the next update's turn when none is active: the oldest live update becomes the active one, its
 * silence clock starts, and its offer goes out. Called when a batch is written, when an update ends and
 * at start; a call while an update is active does nothing.
 */
export function advanceUpdates(): void {
  if (activeUpdateId !== null) return;
  const next = cerberusUpdatesDb.running()[0];
  if (!next) return;
  armSilenceTimer(next.id);
  activeUpdateId = next.id;
  void offerUpdate(next);
}

/** Remembers the gateway address offers are built from. Consumers: `updates.service.ts`, at the module's start. */
export function setOfferAddress(listen: string | null): void {
  listenAddress = listen;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `update.progress`: stores the step against its update, then acts on what it says. The update is
 * center's and the frame a claim: it is honoured only for an update this node was offered. A frame that
 * is not the shape it was sent in, or is about another node's update, is logged and ignored — and
 * acked by the link, because a frame that was never going to be understood would otherwise be resent
 * for ever. A step for an update that has ended, or one stored already, is a no-op.
 */
export function onUpdateProgress(node: string, body: unknown): void {
  const shaped = isRecord(body) && typeof body.updateId === 'string' && typeof body.text === 'string' && typeof body.step === 'string' && STEP_WORDS.has(body.step);
  if (!shaped) {
    console.warn(`[Cerberus] ignored an update.progress frame of node ${node}: it is not a step of an update`);
    return;
  }
  const { updateId, step, text } = body as { updateId: string; step: CerberusUpdateStep; text: string };
  const row = cerberusUpdatesDb.get(updateId);
  if (!row || row.node !== node) {
    console.warn(`[Cerberus] ignored an update.progress frame of node ${node}: ${row ? `the update belongs to ${row.node}` : 'center holds no such update'}`);
    return;
  }

  // Center's own clock at the moment it stores the step, never the envelope's.
  const stored = getCerberusConnection().transaction(
    () => cerberusUpdatesDb.insertStep(updateId, Date.now(), step, text) && cerberusUpdatesDb.setStep(updateId, step)
  )();
  if (!stored) return;

  if (activeUpdateId === updateId) armSilenceTimer(updateId);
  if (step === 'failed') endUpdate(updateId, 'failed', text, null);
  // "In an update that goes on, the warden is still on `from` at its `verified`."
  else if (step === 'verified' && reportedWardenVersion(node) === row.to_version) endUpdate(updateId, 'updated', null, null);
  else hintUpdateMoved({ nodes: [node] });
}

/** The sentence a rollback files as the update's last step: the release it went back to, and why. */
function rollbackText(row: CerberusUpdateRow, reason: string): string {
  const back = row.from_version ? `Rolled back to ${row.from_version}` : 'Rolled back';
  return `${back} · ${reason}`;
}

/**
 * A `failed` hello for an update that is already over. Only an update that ended `updated` within the
 * window, and whose release is the one the launcher says it took back, is amended; the store's guard
 * repeats the same two tests in the statement itself, so a second process or a resent hello cannot
 * amend it twice.
 */
function amendLateRollback(row: CerberusUpdateRow, update: { failed: string; reason: string }): void {
  const now = Date.now();
  const since = now - LATE_ROLLBACK_WINDOW_MS;
  if (row.result !== 'updated' || row.ended_at === null || row.ended_at < since || update.failed !== row.to_version) return;
  if (!cerberusUpdatesDb.rolledBackAfterUpdated(row.id, now, rollbackText(row, update.reason), since, update.reason)) return;
  console.log(`[Cerberus] the update of ${row.node} to ${row.to_version} was taken back after it ended updated: ${update.reason}`);
  hintUpdateMoved({ nodes: [row.node] });
}

/**
 * Ends the update a hello names, when it is a live one of this node's — or, for a `failed` hello, amends
 * one that ended `updated` moments ago; anything else is a repeat or a stranger's and ends nothing.
 */
function settleFromHello(node: string, update: NonNullable<CerberusHelloReport['update']>): void {
  const row = cerberusUpdatesDb.get(update.updateId);
  if (!row || row.node !== node) return;
  if (row.ended_at !== null) {
    if ('failed' in update) amendLateRollback(row, update);
    return;
  }
  if ('to' in update) {
    if (update.to === row.to_version) endUpdate(row.id, 'updated', null, null);
    return;
  }
  if (update.failed !== row.to_version) return;
  endUpdate(row.id, 'rolled_back', update.reason, rollbackText(row, update.reason));
}

/**
 * A warden's `hello`: ends the update it names, and — when the node's own update is the active one and
 * has heard nothing from the warden yet — sends the offer again, because the link it first went into
 * may not have been there.
 */
export function onHelloForUpdates(node: string, hello: CerberusHelloReport): void {
  if (hello.update) settleFromHello(node, hello.update);
  const active = activeUpdateId === null ? null : cerberusUpdatesDb.get(activeUpdateId);
  if (active && active.node === node && active.ended_at === null && cerberusUpdatesDb.steps(active.id).length === 0) {
    void offerUpdate(active);
  }
}
