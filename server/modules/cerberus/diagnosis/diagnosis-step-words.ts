import type { CerberusDiagnosisHistoryQuery, CerberusDiagTool } from '@/shared/cerberus-types.js';

import { durationText, localStamp } from './diagnosis-moments.js';
import { oneMaskedLine } from './diagnosis-text.js';

/**
 * The words center writes into a diagnosis's steps: one fixed sentence for each thing the session DID,
 * so the sheet reads the same way every time and nothing a model said is ever posed as center's own
 * account. The agent speaks only through its `note` tool; everything else on the sheet — the opening
 * line, one line per read, the closing line, and the line that says a node is out of reach — is here.
 *
 * A read's line is written from what was actually sent to the warden, so it names the window and the
 * place the read really covered. The warden applies its own defaults to a field the agent left out
 * (`log.read`: 15 minutes, 200 lines), and these lines say the same numbers. What the agent typed
 * (a path, a `contains` filter, a unit's name) reaches a stored, drawn line only after `oneMaskedLine`:
 * on one line, cut, and credential-looking values masked — the same door every other stored text of a
 * diagnosis goes through.
 *
 * Consumers: `diagnosis.service.ts` (the session's own lines), `diagnosis-deps.ts` (one line per
 * read) and `read-model/diagnosis-views.ts` (`scopeOfDiagnosis`).
 */

/** The longest a path or filter is quoted in a step line before it is cut. */
const QUOTED_LIMIT = 100;

/** What `log.read` reads when a call leaves the window out — the warden's own defaults, repeated so the line says what ran. */
const LOG_READ_DEFAULT_MINUTES = 15;
const LOG_READ_DEFAULT_LINES = 200;

const quoted = (text: unknown): string => oneMaskedLine(typeof text === 'string' ? text : null, QUOTED_LIMIT);

/** The center's closing line: the session is over and, by construction, left the node exactly as it was. */
export const CLOSED_SESSION_STEP = 'Closed the session · nothing was changed';

/** The first line of a diagnosis that has a session on its node. */
export function openedSessionStep(node: string): string {
  return `Opened a read-only session on ${node}`;
}

/**
 * The first line of a diagnosis that reads history only, and why: the hub has no warden, a node is
 * not linked, another diagnosis holds the node's one session, its warden did not answer the session
 * (a release from before diagnoses), or its warden is updating and takes no new work.
 */
export function historyOnlyStep(node: string, reason: 'hub' | 'not_linked' | 'busy' | 'no_answer' | 'updating'): string {
  if (reason === 'hub') return `${node} is Cerberus's own host and runs no warden: this diagnosis reads Cerberus history only`;
  if (reason === 'updating') return `${node}'s warden is updating: this diagnosis reads Cerberus history only`;
  if (reason === 'not_linked') return `${node}'s warden is not connected: this diagnosis reads Cerberus history only`;
  if (reason === 'busy') return `Another diagnosis already has the read-only session on ${node}: this diagnosis reads Cerberus history only`;
  return `${node}'s warden did not answer the session — it may be older than diagnoses: this diagnosis reads Cerberus history only`;
}

/**
 * Whether a diagnosis was given the node's reads (`node`) or only Cerberus history (`history`), told from its FIRST step.
 * `diagnoses` has no column for it, and the first step is the one place the service says it: "Opened a read-only session on
 * <node>" when the session opened, else one of `historyOnlyStep`'s sentences. A diagnosis with no step yet has not said, and
 * reads `node`. Consumers: `read-model/diagnosis-views.ts`, which tells the screen (`CerberusDiagnosisView.scope`).
 */
export function scopeOfDiagnosis(node: string, firstStep: string | undefined): 'node' | 'history' {
  return firstStep !== undefined && firstStep !== openedSessionStep(node) ? 'history' : 'node';
}

const lastWindow = (minutes: number): string => `last ${durationText(minutes * 60_000)}`;

const wholeNumberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

/** The line for one read of the node, from the tool and the arguments as they went to the warden. */
export function nodeReadStep(tool: CerberusDiagTool, args: Record<string, unknown>): string {
  if (tool === 'log.read') {
    const lines = wholeNumberOr(args.lines, LOG_READ_DEFAULT_LINES);
    // The warden filters only the last `lines` lines of its window (journal and file alike), so a filter that found nothing says
    // nothing of what lies before them: the line names the lines it looked through.
    const filtered = typeof args.contains === 'string' ? `lines containing “${quoted(args.contains)}” among the last ${lines} lines` : null;
    if (typeof args.unit === 'string') {
      const window = lastWindow(wholeNumberOr(args.sinceMin, LOG_READ_DEFAULT_MINUTES));
      return `Reading the journal of ${quoted(args.unit)} · ${window}${filtered === null ? '' : ` · ${filtered}`}`;
    }
    return `Reading the end of ${quoted(args.path)} · ${filtered ?? `last ${lines} lines`}`;
  }
  if (tool === 'file.read') return `Reading ${quoted(args.path)}`;

  switch (args.what) {
    case 'unit':
      return `Reading the status of ${typeof args.name === 'string' ? quoted(args.name) : 'a unit'}`;
    case 'failed_units':
      return 'Looking for failed units';
    case 'containers':
      return 'Listing the containers';
    case 'disks':
      return 'Reading disk space';
    case 'memory':
      return 'Reading memory use';
    case 'uptime':
      return 'Reading the uptime';
    case 'listening':
      return 'Listing the listening ports';
    default:
      return 'Reading the node’s status';
  }
}

/** `17:40` for a moment today, `10-05 17:40` for an earlier day — the local time the sheet's other lines use. */
function sinceText(since: number, now: number): string {
  const stamp = localStamp(since);
  return stamp.slice(0, 10) === localStamp(now).slice(0, 10) ? stamp.slice(11, 16) : stamp.slice(5, 16);
}

/**
 * The line for one `history_read`: `Reading Cerberus history: <label> since 17:40`. `subject` is what
 * the read was narrowed to — a check's plain label or key, else the node, else every node — which the
 * caller resolves; `now` is when the read happened.
 */
export function historyReadStep(query: CerberusDiagnosisHistoryQuery, subject: string, now: number): string {
  return `Reading Cerberus history: ${quoted(subject)} since ${sinceText(now - query.sinceMin * 60_000, now)}`;
}
