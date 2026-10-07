import { cerberusDiagnosesDb } from '@/modules/database/index.js';

import { sendDiagStep } from '../cerberus-broadcast.js';

/**
 * The steps of one running diagnosis: each stored, then pushed to every open browser.
 *
 * A STEP IS STORED BEFORE IT IS TOLD. `insertStep` is the one write (`diag_steps`, kept for good), and
 * only a step it wrote is pushed as `cerberus_diag_step` — uncoalesced, the way a run's output lines
 * are — so a sheet that reads the diagnosis again after a frame always finds at least what the frame
 * showed. A step the store refuses to take (the diagnosis has already ended: a note that crossed the
 * 3-minute ceiling) is told to no one, so no step can appear under a "Ready" pill.
 *
 * `n` counts up from 1 and `t` is the seconds since the diagnosis started, on center's clock, to a
 * tenth: two calls the agent makes in one turn are two steps a few hundredths apart, and a tenth
 * keeps their order readable without pretending to more.
 *
 * A write that fails is logged and costs the sheet one line, never the diagnosis: the steps are the
 * account of the work, and the work does not depend on its account.
 *
 * Consumers: `diagnosis.service.ts` (one log per diagnosis; the session's own lines) and
 * `diagnosis-deps.ts` (a line for each read and each note the agent makes).
 */

/** What the rest of the diagnosis holds of its step log: one verb. */
export type DiagnosisStepLog = {
  /** Files one line as the next step, and tells the browsers. Never throws. */
  say(text: string): void;
};

/** Starts the log of the diagnosis `diagId`, which began at `startedAt` (center's clock, epoch ms). */
export function createDiagnosisStepLog(diagId: string, startedAt: number): DiagnosisStepLog {
  let lastNumber = 0;
  return {
    say(text) {
      lastNumber += 1;
      const step = { n: lastNumber, t: Math.max(0, Math.round((Date.now() - startedAt) / 100) / 10), text };
      try {
        if (cerberusDiagnosesDb.insertStep(diagId, step.n, step.t, step.text)) sendDiagStep(diagId, step);
      } catch (error) {
        console.error(`[Cerberus] step ${step.n} of diagnosis ${diagId} could not be stored: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
