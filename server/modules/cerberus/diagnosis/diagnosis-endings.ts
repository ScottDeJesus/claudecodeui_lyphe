import type { CerberusDiagnosisRow } from '@/modules/database/index.js';

/**
 * The words a diagnosis's ending is stored with when it was Cerberus's own restart that ended it, and the
 * one question that tells such an ending from every other.
 *
 * A restart is not the diagnosis's failure. `stopDiagnoses` (a clean shutdown) fails every diagnosis
 * still running in the process with this sentence, and the boot sweep ends a row `running` with no loop
 * behind it with the same one, so the row reads the same whichever way the process went down.
 *
 * WHY A HANDOVER'S ENDING COUNTS FOR NOTHING. The dev server restarts on every save, and a handover starts
 * a new process beside the old one: there were 135 handover boots in the 24 hours before the auto-diagnosis
 * was designed (measured 2026-11-04), some of them seconds apart. Every one of them stops whatever was running. With no cap on
 * how often a red may be read, a restart must never cost a red its reading, so a diagnosis a restart cut
 * short is neither a reading nor a failure: `auto-diagnosis-plan.ts` ignores it when it counts a trouble's
 * failed tries, and the check is diagnosed again.
 *
 * Consumers: `diagnosis.service.ts` (stores the sentence) and `auto-diagnosis-plan.ts` (`endedByRestart`).
 */

/** The sentence a diagnosis a restart ended carries as its `error`. Stored, so it never changes word. */
export const RESTART_SENTENCE = 'Cerberus restarted while the diagnosis was running, so it was stopped. Ask again.';

/** Whether a restart, and nothing the diagnosis did, ended the row. */
export function endedByRestart(row: Pick<CerberusDiagnosisRow, 'status' | 'error'>): boolean {
  return row.status === 'failed' && row.error === RESTART_SENTENCE;
}
