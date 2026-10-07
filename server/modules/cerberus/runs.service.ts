import crypto from 'node:crypto';

import { cerberusRunsDb } from '@/modules/database/index.js';
import type { CerberusRunStartBody, CerberusRunView } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

import { waitForCoveringAck } from './catalog-ack.js';
import { catalogSetFor, liveEntry } from './catalog.service.js';
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
 *   404 `CERBERUS_UNKNOWN_DIAGNOSIS`  a diagnosis's one-off is asked for before the plan that owns
 *                                     diagnoses exists to hold it — no id is known yet;
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
 * ONE RUN PER CHECK. While `startRun` waits for an ack no row exists yet, so a second ask for the same
 * check in that time would read "no active run". `starting` holds the checks being asked for; the 409
 * reads it as well as the store, and `checkHasRun` is how `auto-run.ts` asks the same question.
 *
 * Consumers: `cerberus.routes.ts` (`startRun` for `POST /catalog/:id/run`, `getRun` for
 * `GET /runs/:id`), `auto-run.ts` (`startRun`, `checkHasRun`), `cerberus.module.ts`
 * (`registerRunsService`).
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

/**
 * Asks the warden of the entry's node to run it, and answers the new run's id. The row is written,
 * then the signed `run.start` goes down the link; the warden's answer arrives as frames
 * (`run-frames.ts`). Throws the refusals in the file header.
 */
export async function startRun(input: { entryId?: string; diagnosisId?: string; by: 'auto' | 'you' }): Promise<string> {
  const { entryId, diagnosisId, by } = input;
  if ((entryId === undefined) === (diagnosisId === undefined)) throw badRun('A run names an entry or a diagnosis, one of the two.');
  if (entryId === undefined) {
    throw new AppError(`No diagnosis "${diagnosisId}" exists.`, { code: 'CERBERUS_UNKNOWN_DIAGNOSIS', statusCode: 404 });
  }

  const requestedAt = Date.now();
  const first = liveEntry(entryId);
  const slot = `${first.node}/${first.check_key}`;
  if (checkHasRun(first.node, first.check_key)) throw runActive(first.name, first.node);
  if (!wardenLinks.isLinked(first.node)) throw nodeSilent(first.node);

  starting.add(slot);
  try {
    const acked = await waitForCoveringAck(first.node, first.id, ACK_WAIT_MS);

    // Read again after a wait: the entry may have been retired, and its command is whatever it is NOW.
    const entry = liveEntry(entryId);
    const run = {
      id: crypto.randomBytes(8).toString('hex'),
      entry: entry.id,
      diagnosis: null,
      node: entry.node,
      check_key: entry.check_key,
      by,
      cmd: entry.cmd,
      catalog_version: acked ?? catalogSetFor(entry.node)?.version ?? 0,
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
        `The warden on ${entry.node} did not confirm the catalog holding “${entry.name}” within ${ACK_WAIT_MS / 1000} seconds, so it was not asked to run it.`
      );
      return run.id;
    }

    const body: CerberusRunStartBody = {
      runId: run.id,
      catalogVersion: acked,
      entryId: entry.id,
      proposalId: null,
      cmd: entry.cmd,
      timeout: entry.timeout,
      by,
    };
    // A link that closed in the wait, or between the check above and the socket: the run is recorded as
    // what it was — asked for and never sent — and the person reads why.
    if (!wardenLinks.send(entry.node, 'run.start', body)) {
      endRun(run, 'failed', null, Date.now(), `The link to ${entry.node} closed before the run could be sent.`);
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
