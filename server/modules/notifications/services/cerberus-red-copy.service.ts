/**
 * The words of the Cerberus red watch's three pushes: `cerberus.red` (a check has been failing or denied for
 * an hour), `cerberus.red.reminder` (it still is), `cerberus.recovered` (it is green again).
 *
 * The watcher sends ONE event per tick, however many checks moved, so an event carries three groups in its
 * `meta` — `items` (newly red), `reminders` (still red), `recovered` — and the code is the strongest group
 * present. This file turns those groups into the headline and body every channel shows; it is the whole of
 * the wording, English data kept on the server. A check's label, its reason and its node are data from the
 * fleet, passed through as they come (a reason cut to one line).
 *
 * THE BODY IS BOUNDED HERE, not left to a later cut. `buildNotificationText` keeps the first 1,000 characters
 * of any body, and the ntfy publisher 2,000: a body longer than the first would lose its tail silently, so
 * lines are added while they fit `BODY_BUDGET` and the rest are counted ("+3 more") — nine red checks still
 * say that nine are red.
 *
 * Durations are written as the Cerberus tab writes an age: `42 m`, `1 h 02 m`, `22 d` (whole days, rounded down).
 *
 * Consumed by `notification-copy.service.ts` (the table entries of the three codes) and, for its meta type,
 * by `modules/cerberus/red-watch.service.ts` through the notifications barrel.
 */

/** One check as a red-watch push names it. `minutes` is how long it has been red (a recovery: how long it was). */
export type CerberusRedItem = {
  node: string;
  key: string;
  label: string;
  status: string;
  minutes: number;
  reason: string;
};

/** What a red-watch event carries in `meta`: the newly red, the reminded, the recovered. `count` is `items.length`. */
export type CerberusRedMeta = {
  count: number;
  items: CerberusRedItem[];
  reminders: CerberusRedItem[];
  recovered: CerberusRedItem[];
};

type Copy = { headline: string; body: string };

/** The body stays inside the 1,000 characters the push channels keep, with room for the "+N more" line. */
const BODY_BUDGET = 900;
/** A reason in a list of lines, and a lone check's reason that is the whole body. */
const REASON_CHARS = 50;
const SINGLE_REASON_CHARS = 300;
/** The body of an event whose meta names no check: a malformed event still sends a sentence, never an empty push. */
const NO_CHECKS_LISTED = 'Open the Cerberus tab to see which checks.';
const LABEL_CHARS = 48;
const HEADLINE_LABEL_CHARS = 60;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readItem(raw: unknown): CerberusRedItem | null {
  if (!isRecord(raw) || typeof raw.node !== 'string' || typeof raw.key !== 'string') return null;
  return {
    node: raw.node,
    key: raw.key,
    label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : raw.key,
    status: typeof raw.status === 'string' ? raw.status : 'failing',
    minutes: typeof raw.minutes === 'number' && Number.isFinite(raw.minutes) ? Math.max(0, Math.floor(raw.minutes)) : 0,
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  };
}

function readGroup(raw: unknown): CerberusRedItem[] {
  return Array.isArray(raw) ? raw.map(readItem).filter((item): item is CerberusRedItem => item !== null) : [];
}

function readGroups(meta: Record<string, unknown>): Omit<CerberusRedMeta, 'count'> {
  return { items: readGroup(meta.items), reminders: readGroup(meta.reminders), recovered: readGroup(meta.recovered) };
}

/** `text` cut to `limit` characters, an ellipsis marking the cut. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** A reason on one line: every run of whitespace, newlines included, becomes one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * How long, in the tab's units: minutes under an hour, hours (and minutes, unless `wholeHours`) under a day, whole
 * days past that. `wholeHours` is for a reminder, whose minutes past the hour are only the tick it landed on.
 */
function spanText(minutes: number, wholeHours = false): string {
  if (minutes >= MINUTES_PER_DAY) return `${Math.floor(minutes / MINUTES_PER_DAY)} d`;
  if (minutes >= MINUTES_PER_HOUR) {
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const rest = minutes % MINUTES_PER_HOUR;
    return wholeHours || rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} m`;
  }
  return `${minutes} m`;
}

/** Whether a set of checks runs on more than one node, which is when a line names its node. */
function spansNodes(items: CerberusRedItem[]): boolean {
  return new Set(items.map((item) => item.node)).size > 1;
}

/** Where a set of checks runs: the node's name when they share one, else how many nodes. */
function whereText(items: CerberusRedItem[]): string {
  const nodes = [...new Set(items.map((item) => item.node))];
  return nodes.length === 1 ? `on ${nodes[0]}` : `across ${nodes.length} nodes`;
}

/** A lone check's reason as the whole body: one line, with a word for a check that gave none. */
function lonelyReason(item: CerberusRedItem, none: string): string {
  return clip(oneLine(item.reason), SINGLE_REASON_CHARS) || none;
}

function nameOf(item: CerberusRedItem): string {
  return clip(oneLine(item.label), HEADLINE_LABEL_CHARS);
}

/** `<label> — 22 d — <reason>`: one line per red check; the node is named when the lines span several. */
function redLine(item: CerberusRedItem, wholeHours: boolean, withNode: boolean): string {
  const label = clip(oneLine(item.label), LABEL_CHARS);
  const reason = oneLine(item.reason);
  const head = `${withNode ? `${label} (${item.node})` : label} — ${spanText(item.minutes, wholeHours)}`;
  return reason ? `${head} — ${clip(reason, REASON_CHARS)}` : head;
}

function greenLine(item: CerberusRedItem, withNode: boolean): string {
  const label = clip(oneLine(item.label), LABEL_CHARS);
  return `${withNode ? `${label} (${item.node})` : label} — after ${spanText(item.minutes)}`;
}

/** Lines while they fit the budget, then "+N more" for the rest. */
function fitLines(lines: string[], used: number): { text: string[]; used: number } {
  const text: string[] = [];
  let total = used;
  for (const [index, line] of lines.entries()) {
    if (total + line.length + 1 > BODY_BUDGET) {
      text.push(`+${lines.length - index} more`);
      return { text, used: total };
    }
    text.push(line);
    total += line.length + 1;
  }
  return { text, used: total };
}

/**
 * The body when the event is more than one thing: each group under its own heading, the lines of a group
 * bounded together so a long first group cannot starve the others of their headings.
 */
function groupedBody(groups: Omit<CerberusRedMeta, 'count'>): string {
  const withNode = spansNodes([...groups.items, ...groups.reminders, ...groups.recovered]);
  const sections: Array<{ heading: string; lines: string[] }> = [
    { heading: 'Red over an hour', lines: groups.items.map((item) => redLine(item, false, withNode)) },
    { heading: 'Still red', lines: groups.reminders.map((item) => redLine(item, true, withNode)) },
    { heading: 'Green again', lines: groups.recovered.map((item) => greenLine(item, withNode)) },
  ];
  const out: string[] = [];
  let used = 0;
  for (const section of sections.filter((entry) => entry.lines.length > 0)) {
    out.push(`${section.heading}:`);
    used += section.heading.length + 2;
    const fitted = fitLines(section.lines, used);
    out.push(...fitted.text);
    used = fitted.used;
  }
  return out.join('\n');
}

/** How many groups carry something: one group reads as a plain list, several as headed sections. */
function groupCount(groups: Omit<CerberusRedMeta, 'count'>): number {
  return [groups.items, groups.reminders, groups.recovered].filter((group) => group.length > 0).length;
}

function plainBody(lines: string[]): string {
  return fitLines(lines, 0).text.join('\n');
}

/**
 * `cerberus.red`: `<label> on <node> — red for 1 h 02 m` with the reason as the body, or
 * `3 checks red over an hour on eis1` with a line per check. A tick that also reminded or recovered says so in
 * its body, under headings.
 */
export function redCopy(meta: Record<string, unknown>): Copy {
  const groups = readGroups(meta);
  const { items } = groups;
  if (items.length === 0) return { headline: 'Checks red over an hour', body: NO_CHECKS_LISTED };
  let body: string;
  if (groupCount(groups) > 1) body = groupedBody(groups);
  else if (items.length === 1) body = lonelyReason(items[0], 'No reason given');
  else body = plainBody(items.map((item) => redLine(item, false, spansNodes(items))));
  const headline =
    items.length === 1
      ? `${nameOf(items[0])} on ${items[0].node} — red for ${spanText(items[0].minutes)}`
      : `${items.length} checks red over an hour ${whereText(items)}`;
  return { headline, body };
}

/** `cerberus.red.reminder`: `Still red: <label> on <node> — 7 h`, or `Still red: 3 checks on eis1`. */
export function redReminderCopy(meta: Record<string, unknown>): Copy {
  const groups = readGroups(meta);
  const { reminders } = groups;
  if (reminders.length === 0) return { headline: 'Still red', body: NO_CHECKS_LISTED };
  let body: string;
  if (groupCount(groups) > 1) body = groupedBody(groups);
  else if (reminders.length === 1) body = lonelyReason(reminders[0], 'No reason given');
  else body = plainBody(reminders.map((item) => redLine(item, true, spansNodes(reminders))));
  const headline =
    reminders.length === 1
      ? `Still red: ${nameOf(reminders[0])} on ${reminders[0].node} — ${spanText(reminders[0].minutes, true)}`
      : `Still red: ${reminders.length} checks ${whereText(reminders)}`;
  return { headline, body };
}

/** `cerberus.recovered`: `<label> on <node> is green again after 3 h 10 m`, with what it now reports as the body. */
export function recoveredCopy(meta: Record<string, unknown>): Copy {
  const { recovered } = readGroups(meta);
  if (recovered.length === 0) return { headline: 'Checks green again', body: 'Back to ok' };
  const body =
    recovered.length === 1
      ? lonelyReason(recovered[0], 'Back to ok')
      : plainBody(recovered.map((item) => greenLine(item, spansNodes(recovered))));
  const headline =
    recovered.length === 1
      ? `${nameOf(recovered[0])} on ${recovered[0].node} is green again after ${spanText(recovered[0].minutes)}`
      : `${recovered.length} checks are green again ${whereText(recovered)}`;
  return { headline, body };
}
