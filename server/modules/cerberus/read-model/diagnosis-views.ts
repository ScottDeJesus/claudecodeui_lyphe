import { cerberusCatalogDb, cerberusDiagnosesDb, type CerberusDiagnosisRow } from '@/modules/database/index.js';
import type { CerberusActivity, CerberusCheckView, CerberusDiagnosisView, CerberusReadInputs } from '@/shared/cerberus-types.js';

import { whenDiagnosed } from '../diagnosis/diagnosis-promotion.js';
import { oneOffLapsesAt } from '../diagnosis/diagnosis-proposal.js';
import { scopeOfDiagnosis } from '../diagnosis/diagnosis-step-words.js';

import { clockOffsetOf, diagnosisRunViews } from './run-views.js';

/**
 * Diagnoses as the screen reads them: a row turned into `CerberusDiagnosisView`, and the questions the
 * read model asks of `diagnoses` — the one a need shows, the one a check's sheet shows, and the
 * "asked", "ready" and "failed" lines of What happened.
 *
 * THE CLOCKS. Every moment of a diagnosis is center's clock; the one time here that is not is a
 * check's `since` (a result's `at`, the warden's clock), which is brought onto center's with the node's
 * offset exactly as `run-views.ts` does for a need's run.
 *
 *   - A NEED'S DIAGNOSIS is the check's newest diagnosis asked since the check's `since` — running or
 *     ended, whatever its outcome. A check with no known `since` shows none: "Diagnose" is what its card
 *     says until someone asks again after it went bad. It carries its `steps` and its own `run` without lines.
 *   - A SHEET'S DIAGNOSIS is the check's newest, running or ended, reaching back the FURTHER of 24 hours
 *     and the check's `since`, so a sheet opened from a need always holds what its card said "See
 *     diagnosis" for, and a fix that worked still shows the diagnosis that proposed it after the check
 *     turned green. It carries `steps` and its `run` with `lines`.
 *
 * TWO WORDS ARE WORKED OUT, not stored. `when` is `whenDiagnosed`'s (the check's stored status as of the diagnosis's start,
 * the very word promotion writes into the entry), so the Promote dialog shows what will be written and not a guess from the
 * check's status now. `scope` is `node` or `history`, told from the diagnosis's first step (`scopeOfDiagnosis`): `diagnoses`
 * has no column for whether the node's reads were given.
 *
 * Everything is read from the store as it is now. `promotedTo` is the entry the diagnosis was promoted
 * into, retired or not; `oneOffExpiresAt` is when the warden's one-off lapses, whether or not that
 * moment has passed — the tab compares it with now. `evidence` and `proposal` are JSON in the store
 * (`end` refuses any other shape); a row that cannot be read anyway is logged and shown without them,
 * never a 500 on the tab.
 *
 * Consumers: `overview.ts` (`needDiagnoses`), `check-detail.ts` (`sheetDiagnosisOf`), `activity.ts`
 * (`diagnosisEvents`) and `diagnosis/diagnosis.service.ts` (`diagnosisViewById`, for `GET /diagnoses/:id`).
 */

/** How far back a check's sheet looks for the diagnosis it shows, at the least. */
const SHEET_DIAGNOSIS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The JSON text of a column, or `fallback` — logged — when it is not what the store promises. */
function readJson<T>(row: CerberusDiagnosisRow, column: 'evidence' | 'proposal', isShape: (value: unknown) => value is T, fallback: T): T {
  const text = row[column];
  if (text === null) return fallback;
  try {
    const value: unknown = JSON.parse(text);
    if (isShape(value)) return value;
  } catch {
    // Falls through to the log below, with the same fallback.
  }
  console.error(`[Cerberus] diagnosis ${row.id} has a ${column} this center cannot read: ${text}`);
  return fallback;
}

const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

const isProposal = (value: unknown): value is NonNullable<CerberusDiagnosisView['proposal']> =>
  typeof value === 'object' &&
  value !== null &&
  ['name', 'cmd', 'general'].every((key) => typeof (value as Record<string, unknown>)[key] === 'string');

/**
 * The rows as views, in the order given: steps per diagnosis, and the runs and promotions of all of them
 * each in one statement. `withRunLines` attaches every output line of each run — for a diagnosis read alone.
 */
function diagnosisViews(rows: CerberusDiagnosisRow[], withRunLines: boolean): CerberusDiagnosisView[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const runs = diagnosisRunViews(ids, withRunLines);
  const promoted = cerberusCatalogDb.promotedFrom(ids);

  return rows.map((row) => {
    const steps = cerberusDiagnosesDb.steps(row.id);
    return {
      id: row.id,
      node: row.node,
      check: row.check_key,
      askedBy: row.asked_by,
      model: row.model,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      summary: row.summary,
      evidence: readJson(row, 'evidence', isTextList, []),
      proposal: row.proposal === null ? null : readJson(row, 'proposal', isProposal, null),
      error: row.error,
      steps,
      when: whenDiagnosed(row),
      scope: scopeOfDiagnosis(row.node, steps[0]?.text),
      oneOffExpiresAt: oneOffLapsesAt(row),
      run: runs.get(row.id) ?? null,
      promotedTo: promoted.get(row.id) ?? null,
    };
  });
}

/** One diagnosis with its steps and its run's lines, or `null` when none carries the id. */
export function diagnosisViewById(id: string): CerberusDiagnosisView | null {
  const row = cerberusDiagnosesDb.get(id);
  return row ? diagnosisViews([row], true)[0] : null;
}

/**
 * The diagnosis each of the given needs shows, keyed `<node>/<key>`; a need with none is absent. The
 * checks' newest diagnoses are looked up one by one (an indexed read each) and turned into views together.
 */
export function needDiagnoses(checks: CerberusCheckView[], inputs: CerberusReadInputs): Map<string, CerberusDiagnosisView> {
  const chosen: { mark: string; row: CerberusDiagnosisRow }[] = [];
  for (const check of checks) {
    if (check.since === null) continue;
    const row = cerberusDiagnosesDb.latestForCheck(check.node, check.key, check.since + clockOffsetOf(check.node, inputs));
    if (row) chosen.push({ mark: `${check.node}/${check.key}`, row });
  }
  const views = diagnosisViews(chosen.map((pick) => pick.row), false);
  return new Map(chosen.map((pick, index) => [pick.mark, views[index]]));
}

/** The diagnosis a check's sheet shows — its newest within the bound in the file header — with steps and the run's lines, or `null`. */
export function sheetDiagnosisOf(check: CerberusCheckView, inputs: CerberusReadInputs): CerberusDiagnosisView | null {
  const day = inputs.now - SHEET_DIAGNOSIS_WINDOW_MS;
  const bound = check.since === null ? day : Math.min(day, check.since + clockOffsetOf(check.node, inputs));
  const row = cerberusDiagnosesDb.latestForCheck(check.node, check.key, bound);
  return row ? diagnosisViews([row], true)[0] : null;
}

/**
 * The "asked" and "ready" / "failed" lines of the diagnoses `cerberusDiagnosesDb.recent(before, limit)`
 * returns: `asked` at the request with no summary, then at the end `ready` with the diagnosis's own
 * summary or `failed` with the sentence that says why. Only moments strictly before `before` — an end that
 * has not happened by then belongs to a later page. `labelOf` is the check's plain label as it reads now.
 */
export function diagnosisEvents(
  before: number,
  limit: number,
  labelOf: (node: string, check: string) => string | null
): CerberusActivity[] {
  const events: CerberusActivity[] = [];
  for (const row of cerberusDiagnosesDb.recent(before, limit)) {
    const common = {
      kind: 'diagnosis' as const,
      node: row.node,
      check: row.check_key,
      label: labelOf(row.node, row.check_key),
      diagId: row.id,
    };
    if (row.started_at < before) events.push({ ...common, at: row.started_at, event: 'asked', summary: null });
    if (row.ended_at !== null && row.ended_at < before && row.status !== 'running') {
      events.push(
        row.status === 'done'
          ? { ...common, at: row.ended_at, event: 'ready', summary: row.summary }
          : { ...common, at: row.ended_at, event: 'failed', summary: row.error }
      );
    }
  }
  return events;
}
