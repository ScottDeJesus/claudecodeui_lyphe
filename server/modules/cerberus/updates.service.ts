import crypto from 'node:crypto';

import {
  cerberusNodesDb,
  cerberusUpdatesDb,
  getCerberusConnection,
  type CerberusUpdateRow,
} from '@/modules/database/index.js';
import type {
  CerberusPauseWindow,
  CerberusUpdateStep,
  CerberusUpdateView,
  CerberusWardenRelease,
  CerberusWardens,
} from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { hintUpdateMoved } from './cerberus-broadcast.js';
import { advanceUpdates, onHelloForUpdates, onUpdateProgress, reportedWardenVersion, setOfferAddress } from './update-driver.js';
import { wardenLinks } from './warden-links.js';
import { readLatestBuild } from './warden-release.js';

/**
 * Center's half of a warden update: which release is on offer, starting a batch of nodes to take it, and
 * the one thing the read model asks of an update, the spans its node is paused.
 *
 * A BATCH is the nodes a person picked in one `POST /updates`: one `updates` row each, all `queued`,
 * written in one transaction so a batch is whole or absent, and taken ONE AT A TIME by the driver
 * (`update-driver.ts`) in the order they were named. The refusals, all before anything is written:
 *
 *   400 `CERBERUS_BAD_UPDATE`     no node named;
 *   404 `CERBERUS_UNKNOWN_NODE`   a node that is not enrolled;
 *   409 `CERBERUS_NO_RELEASE`     nothing is built (`dist-warden/latest.json`, or `CERBERUS_WARDEN_DIST`'s);
 *   409 `CERBERUS_UPDATE_RUNNING` an update of an earlier batch has not ended — checked inside the write's
 *                                 transaction, so two presses cannot both pass it.
 *
 * A node already on the release is NOT refused: its offer is answered "Already on <v>" and ends
 * `updated` on that step (see `CerberusUpdateOfferBody`). The release is `latest.json` as it stands when the
 * batch is started, read from disk each time: a build is live the moment it lands.
 *
 * PAUSED is never written. `pauseWindows` works the span of a restart out from the steps — the update's
 * `restarting` step to its end — and caps it at the 90 s a node may be unheard before it is silent, so a
 * rollback that takes longer is a real silence and reads as one.
 *
 * Consumers: `cerberus.routes.ts` (`startBatch`, `getBatch`, `wardensStatus`), the read model
 * (`pauseWindows`) and `cerberus.module.ts` (`registerUpdatesService`).
 */

/** The longest a restart reads as a pause: a node's silence threshold (`warden-links.ts`), after which it is silent. */
const PAUSE_LIMIT_MS = 90_000;

function randomId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** `major.minor.patch` as numbers, or `null` for any other text. */
function versionParts(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Whether a node's version is older than the release: a null or unreadable version counts as older. */
function isBehind(nodeVersion: string | null, releaseVersion: string): boolean {
  const mine = nodeVersion === null ? null : versionParts(nodeVersion);
  const theirs = versionParts(releaseVersion);
  if (mine === null || theirs === null) return true;
  for (let place = 0; place < 3; place += 1) {
    if (mine[place] !== theirs[place]) return mine[place] < theirs[place];
  }
  return false;
}

/** One `updates` row with its steps, as the tab reads it. */
function toUpdateView(row: CerberusUpdateRow): CerberusUpdateView {
  return {
    id: row.id,
    batch: row.batch,
    node: row.node,
    from: row.from_version,
    to: row.to_version,
    startedAt: row.started_at,
    // The column holds 'queued' or a word the driver stored after checking it is one of the six.
    step: (row.step ?? 'queued') as CerberusUpdateView['step'],
    endedAt: row.ended_at,
    result: row.result,
    steps: cerberusUpdatesDb.steps(row.id).map((step) => ({ at: step.at, step: step.step as CerberusUpdateStep, text: step.text })),
  };
}

/** The release `dist-warden/latest.json` names, as the tab shows it; `null` when nothing is built. Read from disk on every call. */
async function latestRelease(): Promise<CerberusWardenRelease | null> {
  const build = await readLatestBuild();
  return build ? { version: build.version, note: build.note, builtAt: build.builtAt } : null;
}

/**
 * Writes a batch — one queued update per named node, in the order named, a node named twice once — and
 * starts its first turn. Answers the batch's id and its updates as they stand. Throws the refusals in the
 * file header.
 */
export async function startBatch(requested: string[]): Promise<{ batch: string; updates: CerberusUpdateView[] }> {
  const nodes = [...new Set(requested)];
  if (nodes.length === 0) throw new AppError('Name at least one node to update.', { code: 'CERBERUS_BAD_UPDATE', statusCode: 400 });
  for (const node of nodes) {
    if (!cerberusNodesDb.get(node)) throw new AppError(`No node "${node}" is enrolled.`, { code: 'CERBERUS_UNKNOWN_NODE', statusCode: 404 });
  }
  const build = await readLatestBuild();
  if (build === null) {
    throw new AppError('No warden has been built — run npm run build:warden', { code: 'CERBERUS_NO_RELEASE', statusCode: 409 });
  }

  const batch = randomId();
  const startedAt = Date.now();
  getCerberusConnection().transaction(() => {
    if (cerberusUpdatesDb.running().length > 0) {
      throw new AppError('A warden update is already running — wait for it to end.', { code: 'CERBERUS_UPDATE_RUNNING', statusCode: 409 });
    }
    for (const node of nodes) {
      cerberusUpdatesDb.insert({
        id: randomId(),
        batch,
        node,
        from_version: reportedWardenVersion(node),
        to_version: build.version,
        started_at: startedAt,
        step: 'queued',
      });
    }
  })();

  hintUpdateMoved({ nodes });
  advanceUpdates();
  return { batch, updates: cerberusUpdatesDb.forBatch(batch).map(toUpdateView) };
}

/** The updates of one batch, in the order they run; a 404 `CERBERUS_UNKNOWN_BATCH` when no update carries the id. */
export function getBatch(batch: string): CerberusUpdateView[] {
  const rows = cerberusUpdatesDb.forBatch(batch);
  if (rows.length === 0) throw new AppError(`No update batch "${batch}" exists.`, { code: 'CERBERUS_UNKNOWN_BATCH', statusCode: 404 });
  return rows.map(toUpdateView);
}

/**
 * `GET /wardens`: the release on offer, every enrolled node's version against it, and the batch that
 * is running — every update of it, the ended ones too, until the whole batch has ended.
 */
export async function wardensStatus(): Promise<CerberusWardens> {
  const latest = await latestRelease();
  const live = cerberusUpdatesDb.running()[0];
  return {
    latest,
    nodes: cerberusNodesDb.list().map((row) => {
      const version = reportedWardenVersion(row.id);
      return { node: row.id, version, behind: latest !== null && isBehind(version, latest.version) };
    }),
    running: live ? cerberusUpdatesDb.forBatch(live.batch).map(toUpdateView) : [],
  };
}

/**
 * The spans of `[from, to)` in which `node`'s warden was restarting for an update, oldest first: each
 * runs from the update's first `restarting` step to its end, cut off 90 s after it begins (an update
 * still live has no end yet, so its span is that long). A span is reported whole, not cut to the window,
 * and only when it touches it.
 */
export function pauseWindows(node: string, from: number, to: number): CerberusPauseWindow[] {
  const windows: CerberusPauseWindow[] = [];
  for (const span of cerberusUpdatesDb.pauseWindows(node, from, to)) {
    const end = Math.min(span.to_at ?? Number.POSITIVE_INFINITY, span.from_at + PAUSE_LIMIT_MS);
    // The store judged the span by its uncut end; once cut it may no longer reach the window.
    if (end > from) windows.push({ from: span.from_at, to: end });
  }
  return windows;
}

/**
 * Arms the updates: takes `update.progress` from the wardens, hears every `hello` for the update it
 * ends, and picks up the batch a restarted center left half done. `listen` is `CERBERUS_LISTEN`, the
 * address an offer's `url` is built from (null when no gateway is configured). Called once at the
 * module's start, before the gateway binds, so the first warden to dial in finds all of it in place.
 */
export function registerUpdatesService(listen: string | null): void {
  setOfferAddress(listen);
  wardenLinks.registerHandler('update.progress', onUpdateProgress);
  wardenLinks.onHello(onHelloForUpdates);
  advanceUpdates();
}
