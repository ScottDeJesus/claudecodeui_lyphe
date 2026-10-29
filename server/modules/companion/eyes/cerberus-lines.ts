import type {
  CerberusCell,
  CerberusCheckView,
  CerberusNodeView,
  CerberusOverview,
  CerberusServiceView,
  CerberusStatus,
} from '@/shared/cerberus-types.js';

import { cappedLines, whenWords } from './eyes-answer.js';
import { clipLine } from './line-words.js';

/**
 * The Cerberus tab's words, for `read_cerberus` (`house-reads.ts`): the overview's header sentence, what needs him, a node's
 * services and a check's reading, each built from the tab's own overview (`CerberusOverview`, what `house.cerberus()` answers)
 * and nothing else. PURE: the overview arrives as a value. Cerberus times are epoch milliseconds. A check's value is text a probe
 * wrote, so it goes through `clipLine` (credential-looking values masked, then cut) like every stored text the eyes quote.
 *
 * A CHECK'S RECENT RESULTS are what the overview holds of it, which is a decision of the cut: its status, value, last result and
 * the time its status began, and the strip of recent minutes of the SERVICE it belongs to (`cells`, one per minute). The stored
 * history behind a check is the tab's own sheet and is not read here.
 *
 * Consumer: `house-reads.ts` (`read_cerberus`).
 */

/** The tab's word for each status, verbatim from `cerberus.status.*` of the locale (`.verify/companion-eyes-house.mjs` keeps them equal). Consumed here and by that probe. */
export const CERBERUS_STATUS_WORDS: Readonly<Record<CerberusStatus, string>> = {
  ok: 'Passing',
  warn: 'Close to the limit',
  failing: 'Failing',
  denied: 'Refused',
  not_enabled: 'Not enabled',
  unknown: 'No result',
  muted: 'Muted',
  paused: 'Paused for an update',
};

/** How many needs the overview names before it says how many it left out. */
const OVERVIEW_NEEDS_MAX = 10;
/** The longest a check's value runs in a line of the overview (the full value is in `needs` and in the check's own read), and in a line of a node. */
const OVERVIEW_VALUE_MAX = 70;
const LIST_VALUE_MAX = 160;
/** The longest a value runs when ONE check is read: its own sentence whole, bounded so a check that writes a page cannot fill her context. */
const FULL_VALUE_MAX = 600;

/**
 * THE USAGE FAMILY (ruling 1, "never usage or spend"). A check about what the paid vendors cost or how much of them is used
 * carries money in its value (`eis1/shadow-connector/gemini_usage`: "Gemini and DeepSeek spend is normal", value "54 calls today,
 * ~$0.39 (~$11.64/mo at this rate)"), and `clipLine` masks credentials, not money. A check is in the family when its key, label or
 * service label says spend, cost or billing, or says usage of a vendor or model; "disk usage" is a machine's own and stays. Judged on
 * those three fields, never on the value. Consumed by `withoutUsageChecks`.
 */
const SPEND_WORD = /(?:^|[^a-z])(?:spend|spent|cost|costs|billing|budget)(?:$|[^a-z])/i;
const USAGE_WORD = /(?:^|[^a-z])usages?(?:$|[^a-z])/i;
const VENDOR_WORD = /gemini|deepseek|claude|anthropic|openai|llm|model/i;

function isUsageCheck(check: CerberusCheckView): boolean {
  const fields = [check.key, check.label ?? '', check.serviceLabel ?? ''];
  return fields.some((field) => SPEND_WORD.test(field)) || (fields.some((field) => USAGE_WORD.test(field)) && fields.some((field) => VENDOR_WORD.test(field)));
}

/**
 * The overview with the usage family taken out of every list a read prints from: what needs him, the muted, and each service's
 * checks (so a node, a check's exact path and a phrase never reach one). The header's `needsYou` and `muted` counts lose the checks
 * taken out of those two lists, so the header and the lists agree in every answer: a day when the spend check is the only check
 * that needs him reads "0 need you" and "Nothing needs you", never "1 need you" over an empty list. The other counts stay the
 * tab's own (a family check that is passing is still one of the passing). Consumed by `house-reads.ts` (`read_cerberus`), once per
 * call, before any scope is read.
 */
export function withoutUsageChecks(overview: CerberusOverview): CerberusOverview {
  const keep = (check: CerberusCheckView): boolean => !isUsageCheck(check);
  const needsYou = overview.needsYou.filter((need) => keep(need.check));
  const muted = overview.muted.filter(keep);
  return {
    ...overview,
    counts: {
      ...overview.counts,
      needsYou: Math.max(0, overview.counts.needsYou - (overview.needsYou.length - needsYou.length)),
      muted: Math.max(0, overview.counts.muted - (overview.muted.length - muted.length)),
    },
    needsYou,
    muted,
    nodes: overview.nodes.map((node) => ({ ...node, services: node.services.map((service) => ({ ...service, checks: service.checks.filter(keep) })) })),
  };
}

/** An epoch-millisecond moment as he would say it. */
const at = (ms: number): string => whenWords(new Date(ms).toISOString());

/** A check as the tab names it: its plain-English label, else its key. */
const checkName = (check: CerberusCheckView): string => check.label ?? check.key;

/** A check's path as `read_cerberus` takes it back: `<node>/<service>/<check>`. */
const checkPath = (check: CerberusCheckView): string => `${check.node}/${check.key}`;

/** The tab's word for a status. */
const statusWord = (status: CerberusStatus): string => CERBERUS_STATUS_WORDS[status];

/** One check in the shape of a list line: `<label> · <where> · <Status> · <value cut>` (`where` is left out when `null`, as under its node). */
function checkLine(check: CerberusCheckView, where: string | null, valueMax: number, since: boolean): string {
  const parts = where === null ? [checkName(check), statusWord(check.status)] : [checkName(check), where, statusWord(check.status)];
  if (check.value !== null && check.value.trim() !== '') parts.push(clipLine(check.value, valueMax));
  if (since && check.since !== null) parts.push(`since ${at(check.since)}`);
  return parts.join(' · ');
}

/** A node's link in the tab's words: "reporting", "silent since yesterday 22:14", "never reported", "paused while its warden updates". */
function linkPhrase(node: CerberusNodeView): string {
  if (node.link === 'reporting') return 'reporting';
  if (node.link === 'silent') return node.silentSince !== null ? `silent since ${at(node.silentSince)}` : 'silent';
  if (node.link === 'never') return 'never reported';
  return 'paused while its warden updates';
}

/**
 * The overview: "<checks> checks: <passing> passing, <needsYou> need you, <muted> muted, <nodes> nodes; last result <when>.", then
 * what needs him — ten lines at most, worst first as the tab orders them, each cut short — and any node not reporting. The
 * closing line of a cut list points at `needs`, which is all of it.
 */
export function overviewText(overview: CerberusOverview): string {
  const { counts, lastResultAt } = overview;
  const last = lastResultAt === null ? 'no result stored yet' : `last result ${at(lastResultAt)}`;
  const lines = [`${counts.checks} checks: ${counts.passing} passing, ${counts.needsYou} need you, ${counts.muted} muted, ${counts.nodes} nodes; ${last}.`];
  if (overview.needsYou.length > 0) {
    const needs = overview.needsYou.map(({ check }) => checkLine(check, check.node, OVERVIEW_VALUE_MAX, false));
    lines.push('What needs you:', cappedLines(needs, OVERVIEW_NEEDS_MAX));
    if (needs.length > OVERVIEW_NEEDS_MAX) lines.push('Scope needs lists all of them.');
  } else {
    lines.push('Nothing needs you.');
  }
  lines.push(...overview.nodes.filter((node) => node.link !== 'reporting').map((node) => `Not reporting: ${node.id} — ${linkPhrase(node)}.`));
  return lines.join('\n');
}

/** Everything that needs him, worst first, one line each with its node/service/check path and when its status began. */
export function needsLines(overview: CerberusOverview): string[] {
  return overview.needsYou.map(({ check }) => checkLine(check, checkPath(check), LIST_VALUE_MAX, true));
}

/** The node whose id is `scope`, without regard to case; `null` when none is. */
export function findNode(overview: CerberusOverview, scope: string): CerberusNodeView | null {
  const wanted = scope.trim().toLowerCase();
  return overview.nodes.find((node) => node.id.toLowerCase() === wanted) ?? null;
}

/** A check with the service it belongs to, as the node tree holds them. Answered by `findChecks`, read by `checkText` and `foundLines`. */
export type FoundCheck = { check: CerberusCheckView; service: CerberusServiceView };

/**
 * The checks a scope names: the one whose path (`<node>/<service>/<check>`) is the scope, else the checks whose path, label,
 * service label or value hold it (case-insensitive). The exact path is the only rung that is certain, so it answers alone.
 */
export function findChecks(overview: CerberusOverview, scope: string): FoundCheck[] {
  const wanted = scope.trim().toLowerCase();
  const all = overview.nodes.flatMap((node) => node.services.flatMap((service) => service.checks.map((check) => ({ check, service }))));
  const exact = all.filter(({ check }) => checkPath(check).toLowerCase() === wanted);
  if (exact.length > 0) return exact;
  return all.filter(({ check }) =>
    [checkPath(check), check.label ?? '', check.serviceLabel ?? '', check.value ?? ''].some((field) => field.toLowerCase().includes(wanted))
  );
}

/** One line per found check, for a phrase that fits several: the check, its path and its word. */
export function foundLines(found: FoundCheck[]): string[] {
  return found.map(({ check }) => checkLine(check, checkPath(check), OVERVIEW_VALUE_MAX, false));
}

/**
 * A node: its link, then each service with its word and how many of its checks pass, and under it every check that is not
 * passing (a passing check is counted, not listed — a service on this box holds seventy-six). The last line says how to read one.
 */
export function nodeText(node: CerberusNodeView): string {
  const warden = node.wardenVersion === null ? '' : ` (warden ${node.wardenVersion})`;
  const lines = [`${node.id}${node.desc ? ` · ${node.desc}` : ''} · ${linkPhrase(node)}${warden}`];
  for (const service of node.services) {
    const { counts } = service;
    const extras = [counts.needsYou > 0 ? `${counts.needsYou} need you` : '', counts.muted > 0 ? `${counts.muted} muted` : '', counts.notEnabled > 0 ? `${counts.notEnabled} not enabled` : ''].filter(Boolean);
    lines.push([service.label ?? service.service, statusWord(service.status), `${counts.passing} of ${counts.total} passing`, ...extras].join(' · '));
    for (const check of service.checks) {
      if (check.status === 'ok' || check.status === 'not_enabled') continue;
      lines.push(`  ${checkLine(check, null, LIST_VALUE_MAX, false)}`);
    }
  }
  lines.push('Passing checks are counted, not listed; scope <node>/<service>/<check> reads one.');
  return lines.join('\n');
}

/** A strip of one-minute cells as "20 min passing, then 10 min failing": runs of the same word, oldest first. */
function stripWords(cells: CerberusCell[]): string {
  const runs: Array<{ status: CerberusStatus; minutes: number }> = [];
  for (const cell of cells) {
    const minutes = Math.max(1, Math.round((cell.to - cell.from) / 60_000));
    const last = runs.at(-1);
    if (last?.status === cell.status) last.minutes += minutes;
    else runs.push({ status: cell.status, minutes });
  }
  return runs.map((run) => `${run.minutes} min ${statusWord(run.status).toLowerCase()}`).join(', then ');
}

/**
 * One check's reading: its status and value, when its last result came and when its status began, the mute over it if any, and
 * the strip of recent minutes of its SERVICE (the overview holds the strip per service, not per check — the sentence says so).
 */
export function checkText(found: FoundCheck): string {
  const { check, service } = found;
  const lines = [`${checkName(check)} (${checkPath(check)}) — ${statusWord(check.status)}${check.value !== null && check.value.trim() !== '' ? `: ${clipLine(check.value, FULL_VALUE_MAX)}` : ''}`];
  const times = [check.at !== null ? `Last result ${at(check.at)}` : 'No result yet', check.since !== null ? `${statusWord(check.status)} since ${at(check.since)}` : ''].filter(Boolean);
  lines.push(`${times.join('; ')}.`);
  if (check.mute !== null) lines.push(`Muted until ${at(check.mute.until)} by ${check.mute.by}: ${clipLine(check.mute.reason, FULL_VALUE_MAX)}`);
  if (service.cells.length > 0) lines.push(`Its service, ${service.label ?? service.service}, over the last ${service.cells.length} minutes (oldest first): ${stripWords(service.cells)}.`);
  return lines.join('\n');
}
