import { cerberusRunsDb } from '@/modules/database/index.js';

import { endRun } from './run-ending.js';
import { wardenLinks, type CerberusHelloReport } from './warden-links.js';

/**
 * Holds center's idea of a node's live runs against what its warden says it still has, once per `hello`.
 *
 * A run center counts live is one whose end it has not heard. Most of the time the warden is simply
 * still running it, or still owes center the frames that end it; the hello names both (`active.runs`:
 * the child still runs, `active.owed`: it is over and its `run.*` frames wait on the warden's outbox).
 * A run NEITHER list names is lost — nothing more will ever arrive for it — and there are two ways
 * that happens: the warden's PROCESS restarted (the child died with it, and so did the outbox that held
 * the run's frames), or the run's `run.start` never reached the warden (the link dropped with the frame
 * in flight, while the process lived on). Either way the run ends `failed`:
 *
 *   - ACCEPTED (`started_at` set): "The warden restarted while it ran; the output ends where the link did."
 *   - NEVER ACCEPTED: "The warden never started it."
 *
 * A run in `owed` is left alone: its frames are resent after the `welcome` and end it themselves. That
 * list is what lets center conclude without a clock; a warden that does not report it (`owedRuns` null:
 * a build older than the list) cannot tell a lost run from one that ended on its own while the link was
 * down, so for it only a run that belongs to a process that is gone is ended, told by the process's
 * start, `hello.startedAt`: a run accepted before it, or never accepted and asked for before it. Both
 * are brought onto the warden's clock with the node's offset (run times are center's clock).
 *
 * A hello that does not say what runs it holds (`active.runs` null: a warden older than the runner) is
 * concluded nothing from. The end is stamped on center's clock — it is center's decision, not the
 * warden's report.
 *
 * Consumers: `runs.service.ts` (`reconcileRunsOnHello`, registered with `wardenLinks.onHello`).
 */

const RESTARTED_NOTE = 'The warden restarted while it ran; the output ends where the link did.';
const NEVER_STARTED_NOTE = 'The warden never started it.';

/** Ends every run of `node` that its warden cannot be running or owe frames for. */
export function reconcileRunsOnHello(node: string, hello: CerberusHelloReport): void {
  if (hello.activeRuns === null) return;
  const processStart = hello.startedAt;
  const accountsForOwed = hello.owedRuns !== null;
  if (!accountsForOwed && processStart === null) return;

  const named = new Set([...hello.activeRuns, ...(hello.owedRuns ?? [])]);
  // `clockOffsetMs` is center's clock minus the warden's: subtracting it puts a center time on the warden's.
  const offsetMs = wardenLinks.clockOffsetMs(node);
  const now = Date.now();

  for (const run of cerberusRunsDb.activeForNode(node)) {
    if (named.has(run.id)) continue;
    const accepted = run.started_at !== null;
    const lost = accountsForOwed || (processStart !== null && (run.started_at ?? run.requested_at) - offsetMs < processStart);
    if (lost) endRun(run, 'failed', null, now, accepted ? RESTARTED_NOTE : NEVER_STARTED_NOTE);
  }
}
