import {
  cerberusDiagnosesDb,
  cerberusResultsDb,
  cerberusRunsDb,
  type CerberusDiagnosisRow,
  type CerberusRunRow,
  type CerberusStoredResultRow,
} from '@/modules/database/index.js';
import type { CerberusDiagnosisHistoryQuery } from '@/shared/cerberus-types.js';

import { localOffset, localStamp } from './diagnosis-moments.js';
import { oneMaskedLine } from './diagnosis-text.js';

/**
 * What the diagnosing agent's `history_read` answers: Cerberus's own record — status changes, fix
 * runs and earlier diagnoses — as one compact line each, newest first, across EVERY node unless the
 * agent narrowed it (spec Table 7: "History across the fleet, read-only"). Logs and files stay on
 * their node; this is the one thing a diagnosis reads beyond it.
 *
 * Only status MOVES are read from `results` (`ok → failing`), never keep-alives or a value that merely
 * changed: a check that says "last sweep failed 17.6h ago" stores a new row every half-minute, and a
 * window of those would never reach the moment it went red. What a check says NOW, and its recent
 * changes, are in the prompt. The lines are text for a model, so each free-text field goes through
 * `oneMaskedLine`: credential-looking values masked the way the warden masks what it reads
 * (`password=<masked>`), folded onto one line and cut — the same words reach the same model by every door.
 *
 * Consumers: the diagnosis service, which hands it to `buildDiagnosisTools` as `historyRead`.
 */

/** A value, a command or a summary is cut here so one long line cannot crowd out the rest of the window. */
const LINE_TEXT_LIMIT = 200;

type HistoryLine = { at: number; text: string };

const oneLine = (text: string | null): string => oneMaskedLine(text, LINE_TEXT_LIMIT);

const statusWord = (status: string | null): string => status ?? 'not_enabled';

function resultLine(row: CerberusStoredResultRow): HistoryLine {
  // `prev_status` is NULL only for a check's first row, which moved from nothing.
  const from = row.prev_status === null ? 'first seen' : row.prev_status;
  return {
    at: row.at,
    text: `${localStamp(row.at)} ${row.node} ${row.check_key} status ${from} → ${statusWord(row.status)} · ${oneLine(row.value)}`,
  };
}

function runLine(row: CerberusRunRow): HistoryLine {
  const outcome = row.result === null ? 'still running' : `${row.result}${row.exit === null ? '' : ` (exit ${row.exit})`}`;
  const origin = row.diagnosis === null ? 'a catalog fix' : 'a diagnosis one-off';
  return {
    at: row.requested_at,
    text: `${localStamp(row.requested_at)} ${row.node} ${row.check_key} run ${origin} by ${row.by}: ${oneLine(row.cmd)} · ${outcome}`,
  };
}

function diagnosisLine(row: CerberusDiagnosisRow): HistoryLine {
  const conclusion =
    row.status === 'running'
      ? 'still running'
      : row.status === 'done'
        ? `done · ${oneLine(row.summary)}${row.proposal === null ? ' · no fix proposed' : ' · proposed a fix'}`
        : `failed · ${oneLine(row.error)}`;
  return { at: row.started_at, text: `${localStamp(row.started_at)} ${row.node} ${row.check_key} diagnosis ${conclusion}` };
}

/**
 * The lines for one `history_read`, newest first, at most `query.limit` of them across the kinds
 * asked for (all three when `kinds` is absent). An empty window answers a sentence saying so, never
 * silence: the agent must be able to tell "nothing happened" from "the read failed".
 */
export function readDiagnosisHistory(query: CerberusDiagnosisHistoryQuery): string {
  const since = Date.now() - query.sinceMin * 60_000;
  const filter = { since, node: query.node, check: query.check };
  const kinds = new Set(query.kinds ?? ['results', 'runs', 'diagnoses']);

  // Each kind is fetched one past the limit — any one of them may supply every line, and the extra row
  // is how a cut is told from an exact fit — then the merged list is cut once, so the newest `limit`
  // are kept whichever kind they belong to.
  const fetchCount = query.limit + 1;
  const lines: HistoryLine[] = [
    ...(kinds.has('results') ? cerberusResultsDb.transitionsSince(filter, fetchCount).map(resultLine) : []),
    ...(kinds.has('runs') ? cerberusRunsDb.requestedSince(filter, fetchCount).map(runLine) : []),
    ...(kinds.has('diagnoses') ? cerberusDiagnosesDb.startedSince(filter, fetchCount).map(diagnosisLine) : []),
  ].sort((a, b) => b.at - a.at);

  const scope = [query.node ?? 'every node', query.check ?? null, `local times, UTC${localOffset(since)}`].filter((part) => part !== null).join(' · ');
  if (lines.length === 0) return `Nothing recorded since ${localStamp(since)} (${scope}).`;
  const shown = lines.slice(0, query.limit);
  const cut = lines.length > shown.length ? ` — older lines cut at ${query.limit}` : '';
  return [`${shown.length} line(s) since ${localStamp(since)} (${scope}), newest first${cut}:`, ...shown.map((line) => line.text)].join('\n');
}
