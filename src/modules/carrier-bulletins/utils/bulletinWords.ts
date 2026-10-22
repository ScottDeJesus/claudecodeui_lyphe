import type { TFunction } from 'i18next';

import { carrierStanding, VERDICT_ORDER } from '@/modules/carrier-bulletins/utils/bulletinModel';
import type {
  BulletinPage,
  LastPull,
  LastReading,
  OverviewRow,
  PageRequirement,
  ReadingStamp,
  VerdictCounts,
  VerdictWord,
} from '@/shared/carrier-bulletins-types';
import { formatRelativeTime, formatShortDate } from '@/shared/utils';

/*
 * THE BULLETINS VIEW'S SENTENCES: the lines a screen prints about a carrier, a page or a reading, built from
 * `cerberus.bulletins.*` and the house's own values — counts, dates, carrier names, the model, the vocabulary's keys.
 * No word from a bulletin passes through here: a quote, a doubt, a part heading or a rule's words is drawn by the
 * screen as its own text node (R-CERB-25), never handed to `t()`. Parts that come to nothing are left out, never "0".
 */

/** A token count as a person reads it: 36.3K, 1.4M. */
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Joins a line's parts the way every line of the Cerberus tab does. */
const DOT = ' · ';

/** The printed question list, where a rule's open question is answered: the view writes nothing, so it names the command. */
export const QUESTIONS_COMMAND = 'venv/bin/python scripts/carrier_rules_questions.py';

/**
 * The manual pull of one carrier through shadow-connector's route, the operator's door: it reads a waiting page again
 * (an ordered read) and settles the carrier after. The name is encoded for the query and for the shell's single quotes.
 */
export function pullCommand(carrier: string): string {
  const name = encodeURIComponent(carrier).replace(/'/g, '%27');
  return `curl -X POST 'http://localhost:8001/extract/servpro-bulletins?carrier=${name}'`;
}

/** A key of the rule vocabulary as words: `site_inspected` reads "site inspected". */
function vocabWords(key: string): string {
  return key.replace(/_/g, ' ');
}

/** A carrier's standing in a word or two, for its badge: "1 page waiting", "Reading stopped", "Not settled yet", "Not read yet", "Settled". */
export function standingWords(row: OverviewRow, t: TFunction): string {
  return t(`cerberus.bulletins.standing.${carrierStanding(row)}`, { count: row.waiting });
}

/** The file a carrier's row and pages name: "Bulletin #3467-F-8 · stored Oct 20". */
export function fileWords(row: OverviewRow, t: TFunction): string {
  const stored = formatShortDate(row.stored_at) ?? '—';
  return row.bulletin_number === null
    ? t('cerberus.bulletins.file.noNumber', { stored })
    : t('cerberus.bulletins.file.numbered', { number: row.bulletin_number, stored });
}

/** How the file's pages split, by need: "48 pages · 1 waiting · 47 read, not settled · 46 carried from an earlier file". */
export function pageSplitWords(row: OverviewRow, t: TFunction): string {
  const parts = [t('cerberus.bulletins.split.pages', { count: row.pages })];
  if (row.waiting > 0) parts.push(t('cerberus.bulletins.split.waiting', { count: row.waiting }));
  if (row.unread > 0) parts.push(row.unread === row.pages ? t('cerberus.bulletins.split.noneRead') : t('cerberus.bulletins.split.unread', { count: row.unread }));
  if (row.read > 0) parts.push(t('cerberus.bulletins.split.read', { count: row.read }));
  if (row.settled > 0) parts.push(t('cerberus.bulletins.split.settled', { count: row.settled }));
  if (row.answered > 0) parts.push(t('cerberus.bulletins.split.carried', { count: row.answered }));
  return parts.join(DOT);
}

/** What the file holds in the rules: "41 requirements live · 2 open questions · 1 duty not placed". */
export function rulesWords(row: OverviewRow, t: TFunction): string {
  const parts = [
    row.requirements_live > 0 ? t('cerberus.bulletins.rules.live', { count: row.requirements_live }) : t('cerberus.bulletins.rules.noneLive'),
  ];
  if (row.questions_open > 0) parts.push(t('cerberus.bulletins.rules.questions', { count: row.questions_open }));
  if (row.not_placed > 0) parts.push(t('cerberus.bulletins.rules.notPlaced', { count: row.not_placed }));
  return parts.join(DOT);
}

/** The pull's own words, with its error after a colon when it failed (`failed: …`). */
const PULL_OUTCOMES = ['unchanged', 'new_bulletin', 'superseded', 'completed', 'no_bulletin', 'failed'];

/** The carrier's last pull: "Pulled Oct 20: a new file", "Pulled Oct 20: failed — the session expired", or "No pull on record". */
export function pullWords(pull: LastPull | null, t: TFunction): string {
  if (pull === null) return t('cerberus.bulletins.pull.none');
  const colon = pull.outcome.indexOf(':');
  const word = colon < 0 ? pull.outcome : pull.outcome.slice(0, colon);
  const detail = colon < 0 ? '' : pull.outcome.slice(colon + 1).trim();
  const outcome = PULL_OUTCOMES.includes(word) ? t(`cerberus.bulletins.pull.outcome.${word}`) : word;
  return t('cerberus.bulletins.pull.at', { when: formatShortDate(pull.at) ?? '—', outcome: detail === '' ? outcome : `${outcome} — ${detail}` });
}

/**
 * A reading's cost: "claude-sonnet-5-5 · 23 calls · 808K tokens", each part left out when the run never counted it. A run
 * that made no call costs nothing and names no model, so it says none of the three — never "0 calls".
 */
function costWords(model: string | null, calls: number | null, input: number | null, output: number | null, t: TFunction): string[] {
  if (calls === 0) return [];
  const parts: string[] = [];
  const tokens = (input ?? 0) + (output ?? 0);
  if (model !== null) parts.push(model);
  if (calls !== null) parts.push(t('cerberus.bulletins.cost.calls', { count: calls }));
  if (tokens > 0) parts.push(t('cerberus.bulletins.cost.tokens', { tokens: COMPACT.format(tokens) }));
  return parts;
}

/**
 * The carrier's last reading, how it ended and what it cost: "Read 3h ago · claude-sonnet-5-5 · 23 calls · 808K tokens",
 * "Settled 5h ago with no call" for a run that found every page answered from an earlier file, or "Never read".
 */
export function readingWords(reading: LastReading | null, t: TFunction): string {
  if (reading === null) return t('cerberus.bulletins.reading.never');
  const when = formatRelativeTime(reading.at);
  const known = ['ok', 'dry_run', 'failed', 'running'].includes(reading.status) ? reading.status : 'other';
  const status = known === 'ok' && reading.calls === 0 ? 'okNoCall' : known;
  const lead = t(`cerberus.bulletins.reading.${status}`, { when, status: reading.status });
  return [lead, ...costWords(reading.model, reading.calls, reading.input_tokens, reading.output_tokens, t)].join(DOT);
}

/**
 * A page's verdicts in need order, the ones it has, each with its words: "1 unsettled", "1 corrected", "6 duplicates", "2
 * confirmed". Parts, not one line, so a row can paint the unsettled count in the tone for act.
 */
export function verdictParts(counts: VerdictCounts, t: TFunction): { verdict: VerdictWord; words: string }[] {
  return VERDICT_ORDER
    .filter((verdict) => counts[verdict] > 0)
    .map((verdict) => ({ verdict, words: t(`cerberus.bulletins.verdictCount.${verdict}`, { count: counts[verdict] }) }));
}

/**
 * When a page's answer was read, in its row: "Read 2h ago", or "Read Oct 21, carried from the Jun 3 file" for an answer read
 * on an earlier file; "Tried, no answer" for a waiting page. A page not read says nothing here: its badge already does.
 */
export function pageWhenWords(page: BulletinPage, t: TFunction): string {
  if (page.state === 'waiting') return t('cerberus.bulletins.pageWhen.tried');
  if (page.read_at === null) return '';
  if (page.read_from !== null) return t('cerberus.bulletins.pageWhen.carried', { read: formatShortDate(page.read_at) ?? '—', date: formatShortDate(page.read_from) ?? '—' });
  return t('cerberus.bulletins.pageWhen.read', { when: formatRelativeTime(page.read_at) });
}

/**
 * Where a page's answer came from, in full: "Read 2h ago on this file · claude-sonnet-5-5 · 1 call · 37.6K tokens", or
 * "Carried from the Jun 3 file, read Oct 22 · …" when its content did not change and the answer was read on that file.
 */
export function stampWords(stamp: ReadingStamp, t: TFunction): string {
  const lead = stamp.read_from === null
    ? t('cerberus.bulletins.stamp.here', { when: formatRelativeTime(stamp.at) })
    : t('cerberus.bulletins.stamp.carried', { date: formatShortDate(stamp.read_from) ?? '—', read: formatShortDate(stamp.at) ?? '—' });
  return [lead, ...costWords(stamp.model, stamp.calls, stamp.input_tokens, stamp.output_tokens, t)].join(DOT);
}

/**
 * A requirement's facts in the house's terms, each a short line: what it is in the vocabulary ("notify · mold"), its
 * deadline ("8 business hours from site inspected"), its number ("Threshold 10 SF (area)") and the jobs it reaches
 * ("Loss types: Reconstruction, Biohazard", or "Every job" when the page names none).
 */
export function requirementFacts(requirement: PageRequirement, t: TFunction): string[] {
  const facts = [`${vocabWords(requirement.kind)}${DOT}${vocabWords(requirement.subject)}`];
  const { window, threshold, scope } = requirement;
  if (window !== null) {
    let span = t('cerberus.bulletins.requirement.windowOpen', { basis: vocabWords(window.basis) });
    if (window.hours !== null && window.hours < 1) span = t('cerberus.bulletins.requirement.minutes', { count: Math.round(window.hours * 60) });
    else if (window.hours !== null) {
      span = window.basis === 'business'
        ? t('cerberus.bulletins.requirement.businessHours', { count: window.hours })
        : t('cerberus.bulletins.requirement.hours', { count: window.hours });
    }
    facts.push(window.anchor === null ? span : t('cerberus.bulletins.requirement.from', { span, anchor: vocabWords(window.anchor) }));
  }
  if (threshold !== null) {
    facts.push(t('cerberus.bulletins.requirement.threshold', { value: threshold.value.toLocaleString(), unit: threshold.unit, measure: vocabWords(threshold.measure) }));
  }
  const reach = [
    scope.services === null ? null : t('cerberus.bulletins.requirement.services', { list: scope.services.map(vocabWords).join(', ') }),
    scope.loss_types === null ? null : t('cerberus.bulletins.requirement.lossTypes', { list: scope.loss_types.map(vocabWords).join(', ') }),
    scope.property_types === null ? null : t('cerberus.bulletins.requirement.propertyTypes', { list: scope.property_types.map(vocabWords).join(', ') }),
  ].filter((line): line is string => line !== null);
  facts.push(...(reach.length > 0 ? reach : [t('cerberus.bulletins.requirement.everyJob')]));
  return facts;
}
