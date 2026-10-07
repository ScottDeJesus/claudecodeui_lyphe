import crypto from 'node:crypto';

import { cerberusRunsDb } from '@/modules/database/index.js';
import type { CerberusRunStartBody, CerberusRunView } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { waitForCoveringAck } from './catalog-ack.js';
import { ONE_OFF_TIMEOUT_S, catalogSetFor, liveEntry } from './catalog.service.js';
import { findDiagnosis, oneOffLapsesAt, proposalOf } from './diagnosis/diagnosis-proposal.js';
import { runViewById } from './read-model/run-views.js';
import { endRun, hintRun } from './run-ending.js';
import { registerRunFrames } from './run-frames.js';
import { reconcileRunsOnHello } from './run-reconcile.js';
import { wardenLinks } from './warden-links.js';

/**
 * Center's half of a run: asking a warden to run a fix, and the one place that knows whether a check
 * has a run going.
 *
 * `startRun` is the only door a run opens by — a person's press (`by: 'you'`, from the route) and
 * Cerberus's own rule (`by: 'auto'`, from `auto-run.ts`) alike — so the refusals live in one place:
 *
 *   404 `CERBERUS_UNKNOWN_ENTRY`      no live entry by that id (a retired one is gone from every list);
 *   404 `CERBERUS_UNKNOWN_DIAGNOSIS`  no diagnosis by that id;
 *   409 `CERBERUS_NO_PROPOSAL`        the diagnosis proposed no fix (or has not finished, or failed);
 *   409 `CERBERUS_ONE_OFF_EXPIRED`    the diagnosis's one-off is past its hour — the warden no longer holds it;
 *   400 `CERBERUS_BAD_RUN`            neither or both of an entry and a diagnosis named;
 *   409 `CERBERUS_RUN_ACTIVE`         the check already has a run that has not ended (or one being asked for);
 *   409 `CERBERUS_NODE_SILENT`        the node has no open link, so nothing could be started — a
 *                                     `run.start` is never queued for a warden that is away.
 *
 * THE ACKED SET. The warden verifies a `run.start` against the catalog it ACKED, so the run names that
 * version. A fix written a moment ago is not in the acked set until the warden answers its
 * `catalog.set`, and a set published after the acked one is about to replace it: `startRun` waits up to
 * 10 s until the node's NEWEST set is acked and holds the id (`catalog-ack.ts`, ended by the ack itself),
 * and if that does not come records the run `failed` with that reason rather than throwing —
 * a run that was asked for and could not be sent is a run, and it counts against an entry's limit like
 * one. Only the id is waited for: a command that has changed since is the warden's refusal to make, and
 * the run carries the entry's CURRENT command, so the warden's three checks stay the only judge.
 *
 * A DIAGNOSIS'S ONE-OFF is run the same way and verified the same way. `startRun({ diagnosisId })` takes
 * the command and the check from the diagnosis (`proposal.cmd` — the exact command, not the `general`
 * form a promotion saves), sends `proposalId` = the diagnosis id with `entryId` null, and records
 * `runs.diagnosis`; the warden finds that id in the one-offs of the set it acked and compares the
 * command byte for byte, exactly as it does for an entry. Nothing here touches `catalog`: running a
 * proposal once leaves the catalog alone, its entries and its change rows, and only the diagnosis's own
 * set (which already holds the one-off) is waited for. A run of a one-off is always `by: 'you'` in
 * practice — Cerberus's own rule only runs entries — and its recheck is always asked (`run-frames.ts`).
 *
 * ONE RUN PER CHECK. While `startRun` waits for an ack no row exists yet, so a second ask for the same
 * check in that time would read "no active run". `starting` holds the checks being asked for; the 409
 * reads it as well as the store, and `checkHasRun` is how `auto-run.ts` asks the same question.
 *
 * Consumers: `cerberus.routes.ts` (`startRun` for `POST /catalog/:id/run`, `getRun` for
 * `GET /runs/:id`), `diagnosis/diagnosis.routes.ts` (`startRun` for `POST /diagnoses/:id/run`),
 * `auto-run.ts` (`startRun`, `checkHasRun`), `cerberus.module.ts` (`registerRunsService`).
 */

/** How long a run waits for the warden to ack a catalog that holds its fix. */
const ACK_WAIT_MS = 10_000;

/** The checks a `startRun` is in the middle of asking for, keyed `<node>/<check>`. */
const starting = new Set<string>();

function badRun(message: string): AppError {
  return new AppError(message, { code: 'CERBERUS_BAD_RUN', statusCode: 400 });
}

/** Whether the check has a run that has not ended, or one `startRun` is still asking a warden for. */
export function checkHasRun(node: string, check: string): boolean {
  return starting.has(`${node}/${check}`) || cerberusRunsDb.activeForCheck(node, check) !== null;
}

function runActive(entryName: string, node: string): AppError {
  return new AppError(`"${entryName}" cannot start: that check already has a fix running on ${node}.`, {
    code: 'CERBERUS_RUN_ACTIVE',
    statusCode: 409,
  });
}

function nodeSilent(node: string): AppError {
  return new AppError(`Cerberus has no link to ${node} right now, so the fix cannot be started there.`, {
    code: 'CERBERUS_NODE_SILENT',
    statusCode: 409,
  });
}

/** What a run is asked to run: a live catalog entry, or a diagnosis's proposal as its one-off. */
type RunTarget = {
  /** The entry's id for a catalog run; null for a one-off. */
  entry: string | null;
  /** The diagnosis's id for a one-off; null for a catalog run. */
  diagnosis: string | null;
  /** The id the warden finds it by — the entry's slug, or the diagnosis's id. One table holds both there. */
  id: string;
  name: string;
  node: string;
  check: string;
  cmd: string;
  timeout: number;
};

/** The live entry a run would run, or a 404 `CERBERUS_UNKNOWN_ENTRY`. Read afresh after a wait: its command is whatever it is NOW. */
function entryTarget(entryId: string): RunTarget {
  const entry = liveEntry(entryId);
  return { entry: entry.id, diagnosis: null, id: entry.id, name: entry.name, node: entry.node, check: entry.check_key, cmd: entry.cmd, timeout: entry.timeout };
}

/**
 * The one-off a diagnosis holds: its proposal's name and exact command. Refused (see the header) when
 * the diagnosis is unknown, proposed nothing, or its hour is over — the same moment the warden drops
 * the one-off at, so the tab's button and the warden's verdict agree.
 */
function oneOffTarget(diagnosisId: string): RunTarget {
  const diagnosis = findDiagnosis(diagnosisId);
  const proposal = proposalOf(diagnosis);
  const lapsesAt = oneOffLapsesAt(diagnosis);
  if (lapsesAt === null || lapsesAt <= Date.now()) {
    throw new AppError(`The proposal of the diagnosis of ${diagnosis.node}/${diagnosis.check_key} can no longer be run: its hour is over.`, {
      code: 'CERBERUS_ONE_OFF_EXPIRED',
      statusCode: 409,
    });
  }
  return {
    entry: null,
    diagnosis: diagnosis.id,
    id: diagnosis.id,
    name: proposal.name,
    node: diagnosis.node,
    check: diagnosis.check_key,
    cmd: proposal.cmd,
    timeout: ONE_OFF_TIMEOUT_S,
  };
}

/**
 * Asks the warden of the target's node to run it — a catalog entry (`entryId`) or a diagnosis's
 * one-off (`diagnosisId`), one of the two — and answers the new run's id. The row is written, then the
 * signed `run.start` goes down the link; the warden's answer arrives as frames (`run-frames.ts`).
 * Throws the refusals in the file header.
 */
export async function startRun(input: { entryId?: string; diagnosisId?: string; by: 'auto' | 'you' }): Promise<string> {
  const { entryId, diagnosisId, by } = input;
  if ((entryId === undefined) === (diagnosisId === undefined)) throw badRun('A run names an entry or a diagnosis, one of the two.');
  const resolve = (): RunTarget => (entryId !== undefined ? entryTarget(entryId) : oneOffTarget(diagnosisId as string));

  const requestedAt = Date.now();
  const first = resolve();
  const slot = `${first.node}/${first.check}`;
  if (checkHasRun(first.node, first.check)) throw runActive(first.name, first.node);
  if (!wardenLinks.isLinked(first.node)) throw nodeSilent(first.node);

  starting.add(slot);
  try {
    const acked = await waitForCoveringAck(first.node, first.id, ACK_WAIT_MS);

    // Read again after a wait: an entry may have been retired and a one-off may have lapsed.
    const target = resolve();
    const run = {
      id: crypto.randomBytes(8).toString('hex'),
      entry: target.entry,
      diagnosis: target.diagnosis,
      node: target.node,
      check_key: target.check,
      by,
      cmd: target.cmd,
      catalog_version: acked ?? catalogSetFor(target.node)?.version ?? 0,
      requested_at: requestedAt,
    };
    cerberusRunsDb.insert(run);
    hintRun(run);

    if (acked === null) {
      endRun(
        run,
        'failed',
        null,
        Date.now(),
        `The warden on ${target.node} did not confirm the catalog holding “${target.name}” within ${ACK_WAIT_MS / 1000} seconds, so it was not asked to run it.`
      );
      return run.id;
    }

    const body: CerberusRunStartBody = {
      runId: run.id,
      catalogVersion: acked,
      entryId: target.entry,
      proposalId: target.diagnosis,
      cmd: target.cmd,
      timeout: target.timeout,
      by,
    };
    // A link that closed in the wait, or between the check above and the socket: the run is recorded as
    // what it was — asked for and never sent — and the person reads why.
    if (!wardenLinks.send(target.node, 'run.start', body)) {
      endRun(run, 'failed', null, Date.now(), `The link to ${target.node} closed before the run could be sent.`);
    }
    return run.id;
  } finally {
    starting.delete(slot);
  }
}

/** One run with its lines, for `GET /runs/:id`; a 404 `CERBERUS_UNKNOWN_RUN` when none carries the id. */
export function getRun(id: string): CerberusRunView {
  const view = runViewById(id);
  if (!view) throw new AppError(`No run "${id}" exists.`, { code: 'CERBERUS_UNKNOWN_RUN', statusCode: 404 });
  return view;
}

/**
 * Registers what center takes from a warden about runs — the four `run.*` frames, and each `hello`'s
 * list of the runs the warden still holds. Called once at the module's start, before the gateway binds.
 */
export function registerRunsService(): void {
  registerRunFrames();
  wardenLinks.onHello(reconcileRunsOnHello);
}
