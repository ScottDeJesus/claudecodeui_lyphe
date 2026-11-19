/**
 * The Bugs route's two parts, `cases stats` and `dispatcher bug stats`, are printed by another program,
 * so they are read once here, field by field, into the types the screen draws. A body this build cannot
 * read is refused by name: the refusal is one sentence naming the field, the route hands it to the screen
 * as that part's `error`, and only that part's section goes blank. A body that does not match is another
 * build of the producer, not a torn file, so no field is coerced to a default to hide the difference.
 */

import { each, field, isCount, isRecord, isText, isTextOrNull, need } from '@/shared/document-fields.js';

/** One night of a suite's cases, as `cases stats --days N --json` prints it under a suite's `night`. */
export type CasesSuiteNight = { day: string; ran: number; held: number; broken: number; cannot_run: number };

/** One suite's counts, as `cases stats --days N --json` prints it in `suites`. */
export type CasesSuiteStats = {
  name: string;
  repo: string;
  active: number;
  holding: number;
  broken: number;
  regressed: number;
  cant_run: number;
  not_run: number;
  night: CasesSuiteNight | null;
};

/** The ticket an open regression was filed as, as `cases stats --days N --json` prints it under `ticket`. */
export type CasesRegressionTicket = {
  id: number;
  state: string;
  title: string;
  board: string | null;
  card: string | null;
};

/** A regression still open, as `cases stats --days N --json` prints it in `regressions.open`. */
export type CasesOpenRegression = {
  suite: string;
  name: string;
  sentence: string;
  broke_at: string;
  walk: string | null;
  walk_word: string | null;
  ticket: CasesRegressionTicket | null;
};

/** A case in `regressions.theirs`, as `cases stats --days N --json` prints it. */
export type CasesOperatorCase = { suite: string; name: string; sentence: string; broke_at: string };

/** What `cases stats --days N --json` prints: the suites, the regressions, and the days they broke on. */
export type CasesStats = {
  days: number;
  suites: CasesSuiteStats[];
  regressions: { ruled: number; cured: number; open: CasesOpenRegression[]; theirs: CasesOperatorCase[] };
  by_day: Array<{ day: string; broke: number; held_again: number }>;
};

/** One ticket source's counts, as `dispatcher bug stats --days N --json` prints it in `by_source`. */
export type TicketSourceStats = {
  source: string;
  filed: number;
  open: number;
  fixed: number;
  cleared: number;
  closed: number;
};

/** A ticket in `unplaced`, as `dispatcher bug stats --days N --json` prints it. */
export type UnplacedTicket = { id: number; title: string; path: string; filed_at: string };

/** What `dispatcher bug stats --days N --json` prints: the sources, the unplaced tickets, and the ones that came back. */
export type TicketStats = {
  days: number;
  by_source: TicketSourceStats[];
  unplaced: UnplacedTicket[];
  came_back: { reopened: number; regressions: number };
};

export function readCasesStats(body: unknown, document: string): CasesStats {
  const top = need(body, isRecord, 'body', document);
  const days = need(field(top, 'days'), isCount, 'days', document);
  let suiteIndex = 0;
  const suites = each(
    field(top, 'suites'),
    'suites',
    (entry) => readSuite(entry, `suites[${suiteIndex++}]`, document),
    document,
  );
  const regressions = need(field(top, 'regressions'), isRecord, 'regressions', document);
  const ruled = need(field(regressions, 'ruled'), isCount, 'regressions.ruled', document);
  const cured = need(field(regressions, 'cured'), isCount, 'regressions.cured', document);
  let openIndex = 0;
  const open = each(
    field(regressions, 'open'),
    'regressions.open',
    (entry) => readOpenRegression(entry, `regressions.open[${openIndex++}]`, document),
    document,
  );
  let theirsIndex = 0;
  const theirs = each(
    field(regressions, 'theirs'),
    'regressions.theirs',
    (entry) => readOperatorCase(entry, `regressions.theirs[${theirsIndex++}]`, document),
    document,
  );
  let dayIndex = 0;
  const byDay = each(
    field(top, 'by_day'),
    'by_day',
    (entry) => readDay(entry, `by_day[${dayIndex++}]`, document),
    document,
  );
  return { days, suites, regressions: { ruled, cured, open, theirs }, by_day: byDay };
}

export function readTicketStats(body: unknown, document: string): TicketStats {
  const top = need(body, isRecord, 'body', document);
  const days = need(field(top, 'days'), isCount, 'days', document);
  let sourceIndex = 0;
  const bySource = each(
    field(top, 'by_source'),
    'by_source',
    (entry) => readSource(entry, `by_source[${sourceIndex++}]`, document),
    document,
  );
  let unplacedIndex = 0;
  const unplaced = each(
    field(top, 'unplaced'),
    'unplaced',
    (entry) => readUnplaced(entry, `unplaced[${unplacedIndex++}]`, document),
    document,
  );
  const cameBack = need(field(top, 'came_back'), isRecord, 'came_back', document);
  const reopened = need(field(cameBack, 'reopened'), isCount, 'came_back.reopened', document);
  const regressions = need(field(cameBack, 'regressions'), isCount, 'came_back.regressions', document);
  return { days, by_source: bySource, unplaced, came_back: { reopened, regressions } };
}

// A nullable key may be left out of the document as well as set to null; both read as null.

function readNight(raw: unknown, at: string, document: string): CasesSuiteNight {
  const night = need(raw, isRecord, at, document);
  return {
    day: need(field(night, 'day'), isText, `${at}.day`, document),
    ran: need(field(night, 'ran'), isCount, `${at}.ran`, document),
    held: need(field(night, 'held'), isCount, `${at}.held`, document),
    broken: need(field(night, 'broken'), isCount, `${at}.broken`, document),
    cannot_run: need(field(night, 'cannot_run'), isCount, `${at}.cannot_run`, document),
  };
}

function readSuite(raw: unknown, at: string, document: string): CasesSuiteStats {
  const suite = need(raw, isRecord, at, document);
  const night = field(suite, 'night') ?? null;
  return {
    name: need(field(suite, 'name'), isText, `${at}.name`, document),
    repo: need(field(suite, 'repo'), isText, `${at}.repo`, document),
    active: need(field(suite, 'active'), isCount, `${at}.active`, document),
    holding: need(field(suite, 'holding'), isCount, `${at}.holding`, document),
    broken: need(field(suite, 'broken'), isCount, `${at}.broken`, document),
    regressed: need(field(suite, 'regressed'), isCount, `${at}.regressed`, document),
    cant_run: need(field(suite, 'cant_run'), isCount, `${at}.cant_run`, document),
    not_run: need(field(suite, 'not_run'), isCount, `${at}.not_run`, document),
    night: night === null ? null : readNight(night, `${at}.night`, document),
  };
}

function readTicketRef(raw: unknown, at: string, document: string): CasesRegressionTicket {
  const ticket = need(raw, isRecord, at, document);
  return {
    id: need(field(ticket, 'id'), isCount, `${at}.id`, document),
    state: need(field(ticket, 'state'), isText, `${at}.state`, document),
    title: need(field(ticket, 'title'), isText, `${at}.title`, document),
    board: need(field(ticket, 'board') ?? null, isTextOrNull, `${at}.board`, document),
    card: need(field(ticket, 'card') ?? null, isTextOrNull, `${at}.card`, document),
  };
}

function readOpenRegression(raw: unknown, at: string, document: string): CasesOpenRegression {
  const row = need(raw, isRecord, at, document);
  const ticket = field(row, 'ticket') ?? null;
  return {
    suite: need(field(row, 'suite'), isText, `${at}.suite`, document),
    name: need(field(row, 'name'), isText, `${at}.name`, document),
    sentence: need(field(row, 'sentence'), isText, `${at}.sentence`, document),
    broke_at: need(field(row, 'broke_at'), isText, `${at}.broke_at`, document),
    walk: need(field(row, 'walk') ?? null, isTextOrNull, `${at}.walk`, document),
    walk_word: need(field(row, 'walk_word') ?? null, isTextOrNull, `${at}.walk_word`, document),
    ticket: ticket === null ? null : readTicketRef(ticket, `${at}.ticket`, document),
  };
}

function readOperatorCase(raw: unknown, at: string, document: string): CasesOperatorCase {
  const row = need(raw, isRecord, at, document);
  return {
    suite: need(field(row, 'suite'), isText, `${at}.suite`, document),
    name: need(field(row, 'name'), isText, `${at}.name`, document),
    sentence: need(field(row, 'sentence'), isText, `${at}.sentence`, document),
    broke_at: need(field(row, 'broke_at'), isText, `${at}.broke_at`, document),
  };
}

function readDay(raw: unknown, at: string, document: string): CasesStats['by_day'][number] {
  const row = need(raw, isRecord, at, document);
  return {
    day: need(field(row, 'day'), isText, `${at}.day`, document),
    broke: need(field(row, 'broke'), isCount, `${at}.broke`, document),
    held_again: need(field(row, 'held_again'), isCount, `${at}.held_again`, document),
  };
}

function readSource(raw: unknown, at: string, document: string): TicketSourceStats {
  const row = need(raw, isRecord, at, document);
  return {
    source: need(field(row, 'source'), isText, `${at}.source`, document),
    filed: need(field(row, 'filed'), isCount, `${at}.filed`, document),
    open: need(field(row, 'open'), isCount, `${at}.open`, document),
    fixed: need(field(row, 'fixed'), isCount, `${at}.fixed`, document),
    cleared: need(field(row, 'cleared'), isCount, `${at}.cleared`, document),
    closed: need(field(row, 'closed'), isCount, `${at}.closed`, document),
  };
}

function readUnplaced(raw: unknown, at: string, document: string): UnplacedTicket {
  const row = need(raw, isRecord, at, document);
  return {
    id: need(field(row, 'id'), isCount, `${at}.id`, document),
    title: need(field(row, 'title'), isText, `${at}.title`, document),
    path: need(field(row, 'path'), isText, `${at}.path`, document),
    filed_at: need(field(row, 'filed_at'), isText, `${at}.filed_at`, document),
  };
}
