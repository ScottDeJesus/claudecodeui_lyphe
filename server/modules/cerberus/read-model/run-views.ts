import { cerberusCatalogDb, cerberusDiagnosesDb, cerberusRunsDb, type CerberusRunRow } from '@/modules/database/index.js';
import type { CerberusActivity, CerberusCheckView, CerberusReadInputs, CerberusRunView } from '@/shared/cerberus-types.js';

/**
 * Runs as the screen reads them: a row turned into `CerberusRunView`, and the four questions the read
 * model asks of `runs` — what is running, what a need shows, what a check's sheet shows, and the
 * "started" and "ended" lines of What happened.
 *
 * THE CLOCKS. Every moment of a run — `requestedAt`, `startedAt`, `endedAt` — is center's clock: the
 * frames that carry a warden's times store them shifted by the node's offset (`run-frames.ts`), so a
 * run compares with its own moments and with now as it stands. The one time here that is NOT center's
 * is a check's `since` (a result's `at`, the warden's clock); it is brought onto center's with the node's
 * clock offset (`links`' `clockOffsetMs`, center minus warden; 0 when no frame has been heard yet or the
 * node has no warden):
 *
 *   - A NEED'S RUN is the check's active run (the newest whose `ended_at` is NULL) whatever its `since`,
 *     so its card never offers Run while one is going — a status that moves while its fix runs takes
 *     `since` past the run's request. Failing that, the check's newest run requested since the check's
 *     `since` — `since` plus the offset — for 90 s after it ended. A check with no known `since` shows
 *     no ended run.
 *   - A SHEET'S RUN is the check's newest run requested within the last hour, running or ended, with its
 *     lines: the sheet shows a fix's output beside the reading it produced, so `since` does not bound it.
 *
 * The `name` of a run is its entry's, retired or not — or, for the run of a diagnosis's one-off, the proposal's;
 * `lastLine` is the text of its newest output line and `lastN` its number.
 * Both are read for every run asked for in ONE statement each. `lines` is attached only when one run is
 * asked for by itself.
 *
 * Consumers: `overview.ts` (`runningViews`, `needRuns`), `check-detail.ts` (`sheetRunOf`), `activity.ts`
 * (`fixEvents`), `diagnosis-views.ts` (`diagnosisRunViews`, `clockOffsetOf`) and `runs.service.ts`
 * (`runViewById`, for `GET /runs/:id`).
 */

/** How long a need keeps showing a run after it ended: long enough to read "finished", short enough not to linger. */
const NEED_RUN_LINGER_MS = 90_000;

/** How far back a check's sheet looks for the run it shows. */
const SHEET_RUN_WINDOW_MS = 60 * 60 * 1000;

/** A diagnosis's proposal name, or `null` when it cannot be read — the name of a run of its one-off. */
function proposalName(diagnosisId: string): string | null {
  const proposal = cerberusDiagnosesDb.get(diagnosisId)?.proposal;
  if (proposal == null) return null;
  try {
    const name = (JSON.parse(proposal) as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/**
 * What the rows ran are called, by the key `nameOf` reads: an entry's name under its id (an entry that
 * cannot be read keeps its id for a name), and a one-off's — its diagnosis's proposal name — under
 * `diagnosis:<id>`.
 */
function entryNames(rows: CerberusRunRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (row.entry !== null && !names.has(row.entry)) names.set(row.entry, cerberusCatalogDb.get(row.entry)?.name ?? row.entry);
    if (row.entry === null && row.diagnosis !== null && !names.has(`diagnosis:${row.diagnosis}`)) {
      names.set(`diagnosis:${row.diagnosis}`, proposalName(row.diagnosis) ?? row.diagnosis);
    }
  }
  return names;
}

/** What a run is called: its entry's name, else its diagnosis's proposal name, else what is left to name it. */
function nameOf(row: CerberusRunRow, names: Map<string, string>): string {
  const named = row.entry !== null ? names.get(row.entry) : row.diagnosis !== null ? names.get(`diagnosis:${row.diagnosis}`) : undefined;
  return named ?? row.diagnosis ?? row.id;
}

/** The rows as views, in the order given. `withLines` attaches every line of each — for one run read alone. */
function runViews(rows: CerberusRunRow[], withLines = false): CerberusRunView[] {
  if (rows.length === 0) return [];
  const names = entryNames(rows);
  const lastLines = cerberusRunsDb.lastLines(rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    entry: row.entry,
    diagnosis: row.diagnosis,
    name: nameOf(row, names),
    node: row.node,
    check: row.check_key,
    by: row.by,
    cmd: row.cmd,
    requestedAt: row.requested_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    result: row.result,
    exit: row.exit,
    note: row.note,
    lastLine: lastLines.get(row.id)?.line ?? null,
    lastN: lastLines.get(row.id)?.n ?? null,
    ...(withLines ? { lines: cerberusRunsDb.output(row.id) } : {}),
  }));
}

/**
 * The newest run of each diagnosis that has been run, as views keyed by diagnosis id — the run of its
 * one-off. `withLines` attaches every line, for a diagnosis read alone. Consumers: `diagnosis-views.ts`.
 */
export function diagnosisRunViews(diagnoses: string[], withLines: boolean): Map<string, CerberusRunView> {
  const rows = [...cerberusRunsDb.latestForDiagnoses(diagnoses).values()];
  const views = runViews(rows, withLines);
  return new Map(rows.flatMap((row, index) => (row.diagnosis === null ? [] : [[row.diagnosis, views[index]] as const])));
}

/** One run with its lines, or `null` when none carries the id. */
export function runViewById(id: string): CerberusRunView | null {
  const row = cerberusRunsDb.get(id);
  return row ? runViews([row], true)[0] : null;
}

/** Every run of the given nodes that has not ended, oldest first, without lines. */
export function runningViews(nodes: string[]): CerberusRunView[] {
  const rows = nodes.flatMap((node) => cerberusRunsDb.activeForNode(node));
  rows.sort((a, b) => a.requested_at - b.requested_at || (a.id < b.id ? -1 : 1));
  return runViews(rows);
}

/**
 * The offset that brings a warden's time onto center's clock: 0 for a node never heard and for the hub.
 * Consumers: this file's `needRuns`, and `diagnosis-views.ts`, which bounds a need's diagnosis by the
 * check's `since` the same way.
 */
export function clockOffsetOf(node: string, inputs: CerberusReadInputs): number {
  return inputs.links.get(node)?.clockOffsetMs ?? 0;
}

/**
 * The run each of the given needs shows, keyed `<node>/<key>`; a need with none is absent. The checks'
 * newest runs are looked up one by one (an indexed read each) and turned into views together.
 */
export function needRuns(checks: CerberusCheckView[], inputs: CerberusReadInputs): Map<string, CerberusRunView> {
  const chosen: { mark: string; row: CerberusRunRow }[] = [];
  for (const check of checks) {
    // A run that is going always shows, whatever the check's `since`: a status that moves while its fix runs
    // (warn to failing as the service restarts) takes `since` past the run's request, and the card must never
    // offer Run beside a fix that is running (the press would meet a 409). `since` bounds only an ended run.
    const row =
      cerberusRunsDb.activeForCheck(check.node, check.key) ??
      (check.since === null ? null : cerberusRunsDb.latestForCheck(check.node, check.key, check.since + clockOffsetOf(check.node, inputs)));
    if (!row) continue;
    if (row.ended_at !== null && row.ended_at < inputs.now - NEED_RUN_LINGER_MS) continue;
    chosen.push({ mark: `${check.node}/${check.key}`, row });
  }
  const views = runViews(chosen.map((pick) => pick.row));
  return new Map(chosen.map((pick, index) => [pick.mark, views[index]]));
}

/** The run a check's sheet shows — its newest within the last hour — with its lines, or `null`. */
export function sheetRunOf(node: string, key: string, now: number): CerberusRunView | null {
  const row = cerberusRunsDb.latestForCheck(node, key, now - SHEET_RUN_WINDOW_MS);
  return row ? runViews([row], true)[0] : null;
}

/**
 * The "started" and "ended" lines of the runs `cerberusRunsDb.recent(before, limit)` returns: `started`
 * at the request, `ended` at the end with its result and the seconds it took (null for a refusal, which
 * never started). Only moments strictly before `before` — an end that has not happened by then belongs
 * to a later page.
 */
export function fixEvents(before: number, limit: number): CerberusActivity[] {
  const rows = cerberusRunsDb.recent(before, limit);
  const names = entryNames(rows);
  const events: CerberusActivity[] = [];
  for (const row of rows) {
    const common = { kind: 'fix' as const, node: row.node, check: row.check_key, runId: row.id, name: nameOf(row, names), by: row.by };
    if (row.requested_at < before) {
      events.push({ ...common, at: row.requested_at, event: 'started', result: null, durationS: null });
    }
    if (row.ended_at !== null && row.ended_at < before) {
      const durationS = row.started_at === null ? null : Math.max(0, Math.round((row.ended_at - row.started_at) / 1000));
      events.push({ ...common, at: row.ended_at, event: 'ended', result: row.result, durationS });
    }
  }
  return events;
}
