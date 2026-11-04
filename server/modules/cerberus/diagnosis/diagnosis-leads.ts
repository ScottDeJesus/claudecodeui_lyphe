import type { CerberusCheckView } from '@/shared/cerberus-types.js';

import { oneWellFormedLine } from './diagnosis-text.js';

/**
 * Where a diagnosis of one service's check starts looking: the unit and the repository behind the service, and the other
 * checks it leans on, as the lines of one prompt section (`WHERE TO LOOK FOR <service> ON <node>`).
 *
 * Three reasons it is built this way.
 *   - The operator named these leads for shadow-connector: a poller that has gone dark is read from the service's journal,
 *     from when the unit last started, from a deploy that landed just before the red, and from the sign-in, the database
 *     and the box it leans on.
 *   - The definition document carries probes, not units or repositories, so nothing the warden sends says which unit runs a
 *     service. The table is therefore data in the center, beside the prompt that reads it: a second service is a second entry
 *     here, and nothing else changes.
 *   - Printing the leaned-on checks as they read now is a script working out what a script can: the agent spends no read
 *     learning that postgres is red. It is the reading NOW; `history_read` still says when one of them moved.
 *
 * The three reads are named with the arguments `diagnosis-tools.ts` gives the tools (`log_read`'s unit, path and lines;
 * `status_read`'s what and name), so the agent does not guess them; they appear only when the node's reads exist in the run.
 * Every line passes `oneMaskedLine` (INV-7153), through `oneWellFormedLine`: a sibling's value is a service's own sentence, and a cut must not leave half a character in it.
 *
 * Consumers: `diagnosis-agent.ts` (`diagnosisPromptOf`), which hands the lines to `buildDiagnosisSystemPrompt`.
 */

type ServiceLead = {
  /** The systemd unit that runs the service. */
  unit: string;
  /** A git reflog on the node (one line per move of HEAD), or null when the service has none. */
  reflog: string | null;
  /** The service's other checks the service's health rests on, each group with the reason it matters. `ids` are the second half of a check key. */
  leansOn: ReadonlyArray<{ why: string; ids: readonly string[] }>;
};

export const SERVICE_LEADS: Readonly<Record<string, ServiceLead>> = {
  'shadow-connector': {
    unit: 'shadow-connector.service',
    reflog: '/opt/shadow-connector/.git/logs/HEAD',
    leansOn: [
      { why: 'upstream sign-in', ids: ['workcenter_token', 'xactimate_token', 'jfa_token', 'xactanalysis_session'] },
      { why: 'the database', ids: ['postgres', 'supabase'] },
      { why: 'the box', ids: ['system_resources', 'service_health'] },
    ],
  },
};

/** A leaned-on check's value is one sentence of a service; this much of it is enough to see why it is red. */
const SIBLING_VALUE_LIMIT = 160;

/** The whole of a sibling's line, wider than any honest one (a label, a key, a status and a value cut at 160): it masks the line as one text and never cuts. */
const SIBLING_LINE_LIMIT = 400;

/**
 * The three reads a lead names, in the order a cause is usually found: the journal, the last start, a deploy. `sinceKnown` is whether THE CHECK
 * above names a "since": the journal's window reaches back past it, or as far as `log_read` goes when the check has none.
 */
function readLines(lead: ServiceLead, sinceKnown: boolean): string[] {
  const window = sinceKnown ? `reaching back past the check's "since" above (at most 1440)` : 'of 1440, the furthest back it reads';
  const reads = [
    `  - the journal: log_read with unit "${lead.unit}", sinceMin ${window}, so the window holds the lines from before it went wrong`,
    `  - when it last started: status_read with what "unit" and name "${lead.unit}" — its Active line says since when it has been running`,
  ];
  if (lead.reflog !== null) {
    reads.push(
      `  - a deploy just before the red: log_read with path "${lead.reflog}", lines 20. Each line of that reflog is one move of HEAD: the two commit ids, the author, a unix time and its offset, then a tab and what moved it`
    );
  }
  return reads;
}

/**
 * The lines of the WHERE TO LOOK section for `check`, or `null` for a service with no entry in `SERVICE_LEADS`. The three
 * reads come first, only when `nodeToolsOpen`; then one line per leaned-on check that `siblings` (the check's service
 * on its node, as the sheet reads it now) holds, `<why>: <label> (<key>) — <status> · <value>` — never the check itself.
 * A leaned-on check the fleet does not hold is left out, so the answer may be an empty list.
 */
export function leadLines(check: CerberusCheckView, siblings: CerberusCheckView[], nodeToolsOpen: boolean): string[] | null {
  // Own entries only: a service called `constructor` must not find Object's.
  if (!Object.hasOwn(SERVICE_LEADS, check.service)) return null;
  const lead = SERVICE_LEADS[check.service];

  const lines = nodeToolsOpen ? readLines(lead, check.since !== null) : [];
  const byKey = new Map(siblings.map((sibling) => [sibling.key, sibling]));
  for (const { why, ids } of lead.leansOn) {
    for (const id of ids) {
      const key = `${check.service}/${id}`;
      const sibling = byKey.get(key);
      if (sibling === undefined || key === check.key) continue;
      const label = sibling.label ?? key;
      const value = oneWellFormedLine(sibling.value, SIBLING_VALUE_LIMIT);
      lines.push(`  - ${oneWellFormedLine(`${why}: ${label} (${key}) — ${sibling.status} · ${value}`, SIBLING_LINE_LIMIT)}`);
    }
  }
  return lines;
}
