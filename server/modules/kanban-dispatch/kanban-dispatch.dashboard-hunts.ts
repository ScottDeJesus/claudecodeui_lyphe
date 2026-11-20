/**
 * The dashboard's `hunts` part, `dispatcher hunt status --json`, is printed by another program, so it is read
 * once here, field by field, into `HuntStatus`. A body this build cannot read is refused by name; the dashboard
 * turns that into this part's `error`, and no field is coerced to a default to hide the difference.
 */

import { each, field, isCount, isCountOrNull, isFlag, isRecord, isText, isTextOrNull, need, oneOf } from '@/shared/document-fields.js';
import {
  type HuntHunter,
  type HuntNight,
  type HuntProjectStanding,
  type HuntSittingRow,
  type HuntSkippedUnit,
  type HuntStatus,
  HUNT_NIGHT_STATES,
  HUNT_PROJECT_STATES,
  HUNT_TURN_RULES,
  HUNT_UNIT_WORDS,
} from '@/shared/hunt-types.js';

export function readHuntStatus(body: unknown, document: string): HuntStatus {
  const top = need(body, isRecord, 'body', document);
  const nightly = need(field(top, 'nightly'), isFlag, 'nightly', document);
  const start = need(field(top, 'start'), isText, 'start', document);
  const minutes = need(field(top, 'minutes'), isCount, 'minutes', document);
  let orderIndex = 0;
  const order = each(
    field(top, 'order'),
    'order',
    (entry) => need(entry, isText, `order[${orderIndex++}]`, document),
    document,
  );
  const turns = oneOf(field(top, 'turns'), HUNT_TURN_RULES, 'turns', document);
  const night = field(top, 'night') ?? null;
  const sitting = field(top, 'sitting') ?? null;
  const next = field(top, 'next') ?? null;
  let hunterIndex = 0;
  const hunts = each(
    field(top, 'hunts'),
    'hunts',
    (entry) => readHunter(entry, `hunts[${hunterIndex++}]`, document),
    document,
  );
  let skippedIndex = 0;
  const skipped = each(
    field(top, 'skipped'),
    'skipped',
    (entry) => readSkipped(entry, `skipped[${skippedIndex++}]`, document),
    document,
  );
  let sittingIndex = 0;
  const sittings = each(
    field(top, 'sittings'),
    'sittings',
    (entry) => readSittingRow(entry, `sittings[${sittingIndex++}]`, document),
    document,
  );
  return {
    nightly,
    start,
    minutes,
    order,
    turns,
    night: night === null ? null : readNight(night, 'night', document),
    sitting: sitting === null ? null : readSitting(sitting, 'sitting', document),
    next: next === null ? null : readNext(next, 'next', document),
    hunts,
    skipped,
    sittings,
  };
}

function readNight(raw: unknown, at: string, document: string): HuntNight {
  const night = need(raw, isRecord, at, document);
  return {
    night: need(field(night, 'night'), isText, `${at}.night`, document),
    state: oneOf(field(night, 'state'), HUNT_NIGHT_STATES, `${at}.state`, document),
    opened_at: need(field(night, 'opened_at'), isText, `${at}.opened_at`, document),
    minutes_used: need(field(night, 'minutes_used'), isCount, `${at}.minutes_used`, document),
    why: need(field(night, 'why') ?? null, isTextOrNull, `${at}.why`, document),
  };
}

function readSitting(raw: unknown, at: string, document: string): NonNullable<HuntStatus['sitting']> {
  const sitting = need(raw, isRecord, at, document);
  return {
    hunt: need(field(sitting, 'hunt'), isText, `${at}.hunt`, document),
    soul: need(field(sitting, 'soul'), isText, `${at}.soul`, document),
    project: need(field(sitting, 'project'), isText, `${at}.project`, document),
    started_at: need(field(sitting, 'started_at'), isText, `${at}.started_at`, document),
    deadline: need(field(sitting, 'deadline'), isText, `${at}.deadline`, document),
  };
}

function readNext(raw: unknown, at: string, document: string): NonNullable<HuntStatus['next']> {
  const next = need(raw, isRecord, at, document);
  return {
    hunt: need(field(next, 'hunt'), isText, `${at}.hunt`, document),
    project: need(field(next, 'project'), isText, `${at}.project`, document),
    rehunt: need(field(next, 'rehunt'), isFlag, `${at}.rehunt`, document),
  };
}

function readHunter(raw: unknown, at: string, document: string): HuntHunter {
  const hunter = need(raw, isRecord, at, document);
  let projectIndex = 0;
  const projects = each(
    field(hunter, 'projects'),
    `${at}.projects`,
    (entry) => readStanding(entry, `${at}.projects[${projectIndex++}]`, document),
    document,
  );
  return {
    hunt: need(field(hunter, 'hunt'), isText, `${at}.hunt`, document),
    soul: need(field(hunter, 'soul'), isText, `${at}.soul`, document),
    model: need(field(hunter, 'model'), isText, `${at}.model`, document),
    runs: need(field(hunter, 'runs'), isFlag, `${at}.runs`, document),
    projects,
  };
}

function readStanding(raw: unknown, at: string, document: string): HuntProjectStanding {
  const row = need(raw, isRecord, at, document);
  const last = field(row, 'last') ?? null;
  return {
    project: need(field(row, 'project'), isText, `${at}.project`, document),
    name: need(field(row, 'name'), isText, `${at}.name`, document),
    unit_word: oneOf(field(row, 'unit_word'), HUNT_UNIT_WORDS, `${at}.unit_word`, document),
    state: oneOf(field(row, 'state'), HUNT_PROJECT_STATES, `${at}.state`, document),
    pass: need(field(row, 'pass') ?? null, isCountOrNull, `${at}.pass`, document),
    total: need(field(row, 'total'), isCount, `${at}.total`, document),
    covered: need(field(row, 'covered'), isCount, `${at}.covered`, document),
    skipped: need(field(row, 'skipped'), isCount, `${at}.skipped`, document),
    open: need(field(row, 'open'), isCount, `${at}.open`, document),
    tickets: need(field(row, 'tickets'), isCount, `${at}.tickets`, document),
    proposals: need(field(row, 'proposals'), isCount, `${at}.proposals`, document),
    nights_left: need(field(row, 'nights_left') ?? null, isCountOrNull, `${at}.nights_left`, document),
    cause: need(field(row, 'cause') ?? null, isTextOrNull, `${at}.cause`, document),
    last: last === null ? null : readLast(last, `${at}.last`, document),
  };
}

function readLast(raw: unknown, at: string, document: string): NonNullable<HuntProjectStanding['last']> {
  const last = need(raw, isRecord, at, document);
  return {
    night: need(field(last, 'night'), isText, `${at}.night`, document),
    minutes: need(field(last, 'minutes'), isCount, `${at}.minutes`, document),
    outcome: need(field(last, 'outcome') ?? null, isTextOrNull, `${at}.outcome`, document),
    covered: need(field(last, 'covered'), isCount, `${at}.covered`, document),
  };
}

function readSkipped(raw: unknown, at: string, document: string): HuntSkippedUnit {
  const row = need(raw, isRecord, at, document);
  return {
    hunt: need(field(row, 'hunt'), isText, `${at}.hunt`, document),
    project: need(field(row, 'project'), isText, `${at}.project`, document),
    unit: need(field(row, 'unit'), isText, `${at}.unit`, document),
    reason: need(field(row, 'reason'), isText, `${at}.reason`, document),
    marked_at: need(field(row, 'marked_at'), isText, `${at}.marked_at`, document),
  };
}

function readSittingRow(raw: unknown, at: string, document: string): HuntSittingRow {
  const row = need(raw, isRecord, at, document);
  return {
    night: need(field(row, 'night'), isText, `${at}.night`, document),
    hunt: need(field(row, 'hunt'), isText, `${at}.hunt`, document),
    soul: need(field(row, 'soul'), isText, `${at}.soul`, document),
    project: need(field(row, 'project'), isText, `${at}.project`, document),
    minutes: need(field(row, 'minutes'), isCount, `${at}.minutes`, document),
    outcome: need(field(row, 'outcome') ?? null, isTextOrNull, `${at}.outcome`, document),
    cause: need(field(row, 'cause') ?? null, isTextOrNull, `${at}.cause`, document),
    covered: need(field(row, 'covered'), isCount, `${at}.covered`, document),
    skipped: need(field(row, 'skipped'), isCount, `${at}.skipped`, document),
    tickets: need(field(row, 'tickets'), isCount, `${at}.tickets`, document),
    proposals: need(field(row, 'proposals'), isCount, `${at}.proposals`, document),
  };
}
