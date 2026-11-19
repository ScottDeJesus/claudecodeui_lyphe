import { clearTicket, fileTicket } from '@/modules/kanban-dispatch/index.js';
import { fixSentence, spanText, type CerberusRedItem } from '@/modules/notifications/index.js';

/**
 * The red watch's tickets. A check the watch opened an incident for, or reminded about, is filed on the house's bug
 * line (`fileTicket`: source `cerberus`, priority high, keyed `check:<node>/<key>`, against the folder
 * `charters/bugs.toml` names for the key's service, the part before its first `/`). A check that recovered clears
 * its ticket (`clearTicket`, the note saying how long it was red, in the push's own units). A silent close (`mute`,
 * `gone`) tells nothing: the detector that opened a ticket closes it only when it saw the check green. The house
 * decides the rest: a reminder of a check whose ticket is still open answers `ALREADY FILED` and changes nothing,
 * which is how an incident open before this existed gets its ticket at its next reminder, and only once; a check
 * with no folder (`system`) is refused by name and stays Cerberus's. The words carry the reason, how long it has
 * been red and the trouble's finished diagnosis when the item carries one (the tick looks it up once, after the
 * transaction, for the page and the ticket alike). It never decides a page and the tick never waits on it: the
 * filings run one after another in the background, in tick order across ticks, so a clear never overtakes its own
 * filing, and each answer is one log line `[red-watch] ticket: <the dispatcher's line>`.
 * Consumer: `red-watch.service.ts`.
 */

/** The bug line's title bound: a longer label would be refused and the red never filed. */
const TITLE_MAX = 200;

/** The bug line's words bound: a longer diagnosis would be refused and the red never filed. */
const WORDS_MAX = 8_000;

/** Leads every ticket key, so the house finds a check's open ticket by the key it was filed under. */
const KEY_PREFIX = 'check:';

/**
 * Every tick's filings and clearings, in tick order. One chain for the module, not one per tick: a check filed by one tick
 * and recovered by the next must be cleared AFTER its filing lands, or the clear finds no ticket and the filing then
 * leaves one open for a check that is green. Each link catches its own failure, so the chain never stays rejected.
 */
let told: Promise<void> = Promise.resolve();

/** The groups of a tick a ticket hears about: what `applyPlan` answered, never what the plan merely held. */
export type TicketedTick = { opened: CerberusRedItem[]; reminded: CerberusRedItem[]; recovered: CerberusRedItem[] };

/** Files the tick's red checks and clears its recovered ones, in the background. Never awaited, never throws. */
export function tellTickets(applied: TicketedTick): void {
  const logLine = (line: string): void => console.log(`[red-watch] ${line}`);
  const stopped = (error: unknown): void => {
    logLine(`ticket: the filing stopped: ${error instanceof Error ? error.message : String(error)}`);
  };
  try {
    const red = [...applied.opened, ...applied.reminded];
    const green = [...applied.recovered];
    if (red.length === 0 && green.length === 0) return;
    told = told.then(() => tellAll(red, green, logLine)).catch(stopped);
  } catch (error) {
    stopped(error);
  }
}

/** The ticket key of a check: `check:<node>/<key>`, the house's name for it. */
function ticketKey(item: CerberusRedItem): string {
  return `${KEY_PREFIX}${item.node}/${item.key}`;
}

/** The service a check belongs to: the part of its key before the first `/`, or the whole key when it has none. */
function serviceOf(item: CerberusRedItem): string {
  const slash = item.key.indexOf('/');
  return slash === -1 ? item.key : item.key.slice(0, slash);
}

/** The ticket's title: the label and the node, cut to the bug line's bound. */
function titleOf(item: CerberusRedItem): string {
  return `${item.label} on ${item.node} is red`.slice(0, TITLE_MAX);
}

/** The ticket's words: what happened, why, where, and the finished diagnosis when there is one, cut to the bound. */
function wordsOf(item: CerberusRedItem): string {
  const lines = [
    `${item.label} on ${item.node} has been ${item.status} for ${spanText(item.minutes)}.`,
    item.reason.trim() !== '' ? `Reason: ${item.reason}` : 'Cerberus gave no reason.',
    `Check: ${item.node}/${item.key}`,
  ];
  if (item.diagnosis) {
    lines.push('', `Likely cause: ${item.diagnosis.summary.trim()}`, fixSentence(item.diagnosis.fix));
  }
  return lines.join('\n').slice(0, WORDS_MAX);
}

/** Files each red check, then clears each green one, one house process at a time: a tick never runs them in parallel. */
async function tellAll(
  red: CerberusRedItem[],
  green: CerberusRedItem[],
  log: (line: string) => void,
): Promise<void> {
  for (const item of red) {
    const said = await fileTicket({
      source: 'cerberus',
      key: ticketKey(item),
      service: serviceOf(item),
      title: titleOf(item),
      words: wordsOf(item),
      priority: 'high',
    });
    log(`ticket: ${said}`);
  }
  for (const item of green) {
    const said = await clearTicket(ticketKey(item), `green again after ${spanText(item.minutes)}`);
    log(`ticket: ${said}`);
  }
}
