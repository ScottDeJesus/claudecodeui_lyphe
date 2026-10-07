import { cerberusRunsDb, type CerberusRunResult, type CerberusRunRow } from '@/modules/database/index.js';

import { hintChanged } from './cerberus-broadcast.js';

/**
 * Where a run's moves are told to the screens: the hint that names its check, and the one write that
 * ends it.
 *
 * A run ends exactly once. `endRun` is `markEnded`'s verdict made a function: the first end wins, so a
 * resent `run.end`, a refusal that crossed an end and a reconciliation of a run that already ended are
 * all answered `false` and tell no one anything. Every end — the warden's (`run.end`, `run.refused`) and
 * center's own (a run the warden lost, a run that could not be sent) — goes through here, so the screen
 * is hinted the same way whoever decided.
 *
 * Consumers: `run-frames.ts` (`hintRun` for a run's start, `endRun` for a refusal and an end — a batch of
 * output hints nothing), `run-reconcile.ts` (`endRun` for the runs a hello shows lost) and `runs.service.ts`
 * (`hintRun` for the request, `endRun` for the ends center decides).
 */

/** Tells the screens the run's check moved: its need, its sheet, its node's fixing mark. */
export function hintRun(run: Pick<CerberusRunRow, 'node' | 'check_key'>): void {
  hintChanged({ nodes: [run.node], checks: [`${run.node}/${run.check_key}`] });
}

/**
 * Ends the run at `endedAt` with `result`. Answers whether THIS call ended it; only then is the screen
 * hinted. `endedAt` is center's clock — the warden's reported time already brought onto it
 * (`run-frames.ts`), or `Date.now()` when center decided the end — and `note` is the one sentence for
 * a person when the command's own exit does not say why (a refusal's reason, a lost warden).
 */
export function endRun(
  run: Pick<CerberusRunRow, 'id' | 'node' | 'check_key'>,
  result: CerberusRunResult,
  exit: number | null,
  endedAt: number,
  note: string | null
): boolean {
  if (!cerberusRunsDb.markEnded(run.id, result, exit, endedAt, note)) return false;
  hintRun(run);
  return true;
}
