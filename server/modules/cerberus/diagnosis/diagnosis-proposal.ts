import { CERBERUS_ONE_OFF_TTL_MS, cerberusDiagnosesDb, type CerberusDiagnosisRow } from '@/modules/database/index.js';
import type { CerberusDiagnosisView } from '@/shared/cerberus-types.js';
import { AppError } from '@/shared/utils.js';

/**
 * A diagnosis's proposal and the refusals about it, in one place: the run of its one-off
 * (`runs.service.ts`) and its promotion into the catalog (`diagnosis-promotion.ts`) both begin by
 * asking "is there a diagnosis, and did it propose a fix?", and both must answer in the same words.
 *
 *   404 `CERBERUS_UNKNOWN_DIAGNOSIS`  no diagnosis carries the id;
 *   409 `CERBERUS_NO_PROPOSAL`        it proposed no fix — or has not finished, or failed;
 *   409 `CERBERUS_ONE_OFF_EXPIRED`    its one-off's hour is over (`oneOffLapsesAt`).
 *
 * A proposal is `{ name, cmd, general }`, stored as JSON by the store's `end`, which refuses any other
 * shape — so a row that has one is a row this file can read.
 *
 * Consumers: `runs.service.ts` (`findDiagnosis`, `proposalOf`, `oneOffLapsesAt`), `catalog.service.ts`
 * (`proposalOf`, `oneOffLapsesAt`, for the set's one-offs), `diagnosis-promotion.ts` (`findDiagnosis`,
 * `proposalOf`), `diagnosis.service.ts` (`unknownDiagnosis`) and `read-model/diagnosis-views.ts`
 * (`oneOffLapsesAt`).
 */

/** The 404 for an id that names no diagnosis. */
export function unknownDiagnosis(id: string): AppError {
  return new AppError(`No diagnosis "${id}" exists.`, { code: 'CERBERUS_UNKNOWN_DIAGNOSIS', statusCode: 404 });
}

/** The diagnosis's row, or a 404 `CERBERUS_UNKNOWN_DIAGNOSIS`. */
export function findDiagnosis(id: string): CerberusDiagnosisRow {
  const diagnosis = cerberusDiagnosesDb.get(id);
  if (!diagnosis) throw unknownDiagnosis(id);
  return diagnosis;
}

/** The proposal of a diagnosis that made one, or a 409 `CERBERUS_NO_PROPOSAL` saying why there is none. */
export function proposalOf(diagnosis: CerberusDiagnosisRow): NonNullable<CerberusDiagnosisView['proposal']> {
  if (diagnosis.proposal === null) {
    const why =
      diagnosis.status === 'running'
        ? 'is still reading, so it has proposed nothing yet'
        : diagnosis.status === 'failed'
          ? 'failed, so it proposed nothing'
          : 'ended without proposing a fix';
    throw new AppError(`The diagnosis of ${diagnosis.node}/${diagnosis.check_key} ${why}.`, { code: 'CERBERUS_NO_PROPOSAL', statusCode: 409 });
  }
  return JSON.parse(diagnosis.proposal) as NonNullable<CerberusDiagnosisView['proposal']>;
}

/**
 * When the diagnosis's one-off lapses (epoch ms): an hour after it ended — the same sum the catalog
 * set gives the warden as `expiresAt`, so the tab's button, center's refusal and the warden's verdict
 * agree. `null` for a diagnosis that has not ended or proposed nothing.
 */
export function oneOffLapsesAt(diagnosis: Pick<CerberusDiagnosisRow, 'proposal' | 'ended_at'>): number | null {
  return diagnosis.proposal === null || diagnosis.ended_at === null ? null : diagnosis.ended_at + CERBERUS_ONE_OFF_TTL_MS;
}
