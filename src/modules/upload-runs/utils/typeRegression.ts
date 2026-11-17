import type { HealSessionsAnswer } from '@/modules/heal';
import type { UploadRunSummary, UploadType } from '@/shared/upload-runs-types';

/**
 * Per upload type, whether a stumble a landed heal had already fixed has come back in one of its runs: true when a run of
 * the type ran in a Claude session that holds a friction row carrying a `regression`. A test run is left out, as it is
 * from every count of the type; a run with no Claude session or no type names nothing to join on.
 *
 * Used by `useUploadsRead`, which hands the result to the By upload type rows as `read.regression`.
 */
export function typeRegression(answer: HealSessionsAnswer, runs: UploadRunSummary[]): Record<UploadType, boolean> {
  const returned = new Set(answer.items.filter((item) => item.regression !== null).map((item) => item.session));
  const regression: Record<UploadType, boolean> = { initial: false, final: false };
  for (const run of runs) {
    if (run.dry_run || run.upload_type === null || run.claude_session_id === null) continue;
    if (returned.has(run.claude_session_id)) regression[run.upload_type] = true;
  }
  return regression;
}
