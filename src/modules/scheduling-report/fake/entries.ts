import type {
  SchedulingEntry, SchedulingEntryKind, SchedulingEntryResult, SchedulingJob, SchedulingKindCounts, SchedulingOverview, SchedulingPerson,
  SchedulingReason, SchedulingReasonCode, SchedulingSurface, SchedulingWindowDays,
} from '@/shared/scheduling-report-types';

/*
 * THE FAKE ENTRIES THE SCHEDULING VIEW RENDERS OVER, until the fill's hooks take their place and this folder is deleted
 * with `scheduling-fake.ts`. Typed by the wire mirror, so a fake that drifts from the wire fails the build.
 *
 * COMPOSED, not read: no scheduling act had been recorded when this was written. The people, the customers, the project
 * numbers and the crew are invented. The shapes are `eis_backend/scheduling_report`'s, key for key, and each entry's
 * reasons follow `verdict.py`'s vocabulary and its tones.
 */

/** The moment every fixture is aged against: fixed, so a photograph taken twice is the same picture. */
export const FAKE_NOW = Date.parse('2026-11-18T22:40:00Z');

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACCOUNT = id(1);
/** An ISO time `minutes` before the fixed now. */
export const minsAgo = (minutes: number) => new Date(FAKE_NOW - minutes * 60_000).toISOString();
/** An ISO time `daysBack` local days before the fixed now, at a local hour and minute: the hour strip and the day columns are local. */
export const dayAt = (daysBack: number, hour: number, minute = 0) => {
  const base = new Date(FAKE_NOW);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - daysBack, hour, minute).toISOString();
};
export const plusSeconds = (iso: string, seconds: number) => new Date(Date.parse(iso) + seconds * 1000).toISOString();

/** Three people who schedule, and one machine: a login is data, and a long one is what the chips and pills must hold. */
export const WHO = { a: 'eis:mreyes@servprodowney.com', b: 'eis:tkim@servprodowney.com', c: 'eis:jalvarez@servprodowney.com', machine: 'eis:restorly-checks' };
export const CREW: SchedulingPerson[] = [{ id: id(901), name: 'Luis Ortega' }, { id: id(902), name: 'Dana Whitfield' }, { id: id(903), name: 'Marcus Bell' }, { id: id(904), name: 'Priya Nair' }];
const JOBS: SchedulingJob[] = [
  { id: id(801), customer_name: 'Okafor, Daniel', project_number: '26-1187-WTR', loss_type: 'Water' },
  { id: id(802), customer_name: 'Lindqvist Dental Group', project_number: '26-1203-WTR', loss_type: 'Water' },
  { id: id(803), customer_name: 'Marchetti, Rosa', project_number: '26-1168-FIR', loss_type: 'Fire' },
  { id: id(804), customer_name: 'Harborview Homeowners Association, Building C', project_number: '26-1211-MLD', loss_type: 'Mold' },
  { id: id(805), customer_name: 'Nguyen, Bao and Linh', project_number: '26-1195-WTR', loss_type: 'Water' },
];

const TONE: Record<SchedulingReasonCode, SchedulingReason['tone']> = {
  server_fault: 'danger', scheduling_unavailable: 'danger', calendar_failed: 'danger', no_answer: 'danger',
  crew_refused: 'warn', login_required: 'warn', request_refused: 'warn', nobody_offered: 'warn', availability_unread: 'warn',
  visit_unreadable: 'warn', no_open_times: 'warn', gave_up: 'warn', undone: 'warn', not_reported: 'warn',
  closed_without_booking: 'neutral', calendar_paused: 'neutral', crew_downgraded: 'neutral', drive_times_not_checked: 'neutral', not_best_fit: 'neutral', own_time: 'neutral',
};
/** One reason, toned as `verdict.py` tones its code. */
export const why = (code: SchedulingReasonCode, count?: number, detail?: string): SchedulingReason => (
  { code, tone: TONE[code], ...(count === undefined ? {} : { count }), ...(detail === undefined ? {} : { detail }) });

type EntrySpec = Partial<Omit<SchedulingEntry, 'reasons' | 'verdict' | 'tone'>> & { reasons?: SchedulingReason[] };

/** One form entry, reported, by the first person, its verdict and tone taken from its reasons as the server takes them. */
export function entry(n: number, kind: SchedulingEntryKind, result: SchedulingEntryResult, started_at: string, spec: EntrySpec = {}): SchedulingEntry {
  const reasons = spec.reasons ?? [];
  const tone = reasons.some((reason) => reason.tone === 'danger') ? 'danger' : reasons.some((reason) => reason.tone === 'warn') ? 'warn' : 'positive';
  const open_seconds = 38 + ((n * 37) % 140);
  return {
    id: id(n), form: true, state: 'reported', account_id: ACCOUNT, actor: WHO.a, actor_kind: 'person', kind, result,
    opener: 'schedule_new', surface: null, job: JOBS[n % JOBS.length], visit_id: result === 'nothing' ? null : id(500 + n),
    started_at, ended_at: plusSeconds(started_at, open_seconds), open_seconds,
    presses: { total: 1, ok: 1, refused: 0, failed: 0 }, lead: CREW[n % CREW.length],
    ...spec,
    reasons, verdict: tone === 'positive' ? 'clean' : 'hiccup', tone,
  };
}

/** One direct entry: one change made with no form, on a surface. */
export const direct = (n: number, kind: SchedulingEntryKind, result: SchedulingEntryResult, started_at: string, surface: SchedulingSurface, spec: EntrySpec = {}) => (
  entry(n, kind, result, started_at, { form: false, state: 'direct', opener: null, surface, ended_at: null, open_seconds: null, ...spec }));

/** The ids the sheet fixtures open. */
export const OPEN = { undone: id(101), closed: id(102), open: id(103), notReported: id(104), gridMove: id(105), crewRefused: id(109), calendarFailed: id(113), everyReason: id(114), machine: id(131) };

const NO_PRESS = { total: 0, ok: 0, refused: 0, failed: 0 };

/** The 30-day window: the showcased entries first, then the routine ones around them. */
const BUSY: SchedulingEntry[] = [
  entry(101, 'book', 'booked', minsAgo(12), { reasons: [why('undone')], presses: { total: 2, ok: 2, refused: 0, failed: 0 }, lead: CREW[0], open_seconds: 74 }),
  entry(102, 'book', 'nothing', minsAgo(95), { reasons: [why('closed_without_booking')], presses: NO_PRESS, lead: null, opener: 'job_schedule_band', actor: WHO.b, open_seconds: 21 }),
  entry(103, 'book', 'nothing', minsAgo(3), { state: 'open', opener: null, ended_at: null, open_seconds: null, reasons: [why('crew_refused', 1)], presses: { total: 1, ok: 0, refused: 1, failed: 0 }, lead: CREW[1], actor: WHO.c }),
  entry(104, 'change', 'changed', dayAt(2, 10, 15), { state: 'not_reported', opener: null, ended_at: null, open_seconds: null, reasons: [why('not_reported')], actor: WHO.b }),
  direct(105, 'change', 'changed', dayAt(0, 9, 40), 'grid_move', { actor: WHO.b }),
  direct(106, 'change', 'changed', dayAt(1, 14, 5), 'grid_resize', { reasons: [why('calendar_paused', 1)] }),
  direct(107, 'change', 'nothing', dayAt(1, 14, 6), 'undo'),
  direct(108, 'cancel', 'cancelled', dayAt(3, 16, 30), 'api', { actor: WHO.c, lead: null }),
  entry(109, 'book', 'booked', dayAt(0, 11, 20), { reasons: [why('crew_refused', 2), why('not_best_fit')], presses: { total: 3, ok: 1, refused: 2, failed: 0 }, lead: CREW[2], opener: 'unscheduled_list', open_seconds: 162 }),
  entry(110, 'book', 'nothing', dayAt(4, 8, 50), { reasons: [why('crew_refused', 1), why('gave_up')], presses: { total: 1, ok: 0, refused: 1, failed: 0 }, opener: 'call_script', actor: WHO.c }),
  entry(111, 'book', 'booked', dayAt(5, 13, 10), { reasons: [why('scheduling_unavailable', 1, 'account_unresolved')], presses: { total: 2, ok: 1, refused: 0, failed: 1 }, opener: 'schedule_slot' }),
  entry(112, 'change', 'nothing', dayAt(6, 15, 45), { reasons: [why('server_fault', 1), why('gave_up')], presses: { total: 1, ok: 0, refused: 0, failed: 1 }, opener: 'schedule_visit', actor: WHO.b }),
  entry(113, 'book', 'booked', dayAt(2, 9, 5), { reasons: [why('calendar_failed', 1, 'graph_timeout')], opener: 'work_list' }),
  entry(114, 'book', 'booked', dayAt(8, 10, 30), {
    presses: { total: 9, ok: 1, refused: 5, failed: 3 }, opener: 'carrier_region', open_seconds: 612,
    reasons: [
      why('server_fault', 1), why('scheduling_unavailable', 1, 'account_unresolved'), why('calendar_failed', 1, 'graph_timeout'), why('no_answer', 2),
      why('crew_refused', 2), why('login_required'), why('request_refused', 2, 'validation'), why('nobody_offered'), why('availability_unread'),
      why('visit_unreadable'), why('no_open_times'), why('gave_up'), why('undone'), why('not_reported'),
      why('closed_without_booking'), why('calendar_paused', 2), why('crew_downgraded'), why('drive_times_not_checked'), why('not_best_fit'), why('own_time'),
    ],
  }),
  entry(115, 'book', 'booked', dayAt(0, 8, 15), { opener: 'schedule_slot' }),
  entry(116, 'book', 'booked', dayAt(1, 9, 30), { reasons: [why('own_time')], actor: WHO.b }),
  entry(117, 'change', 'changed', dayAt(1, 11, 0), { opener: 'schedule_visit' }),
  entry(118, 'book', 'booked', dayAt(3, 10, 10), { reasons: [why('not_best_fit'), why('drive_times_not_checked')], opener: 'unscheduled_list' }),
  entry(119, 'cancel', 'cancelled', dayAt(3, 13, 25), { opener: 'schedule_visit', actor: WHO.b }),
  entry(120, 'book', 'booked', dayAt(7, 9, 0), { opener: 'job_schedule_band' }),
  entry(121, 'change', 'nothing', dayAt(7, 14, 20), { reasons: [why('closed_without_booking')], presses: NO_PRESS, opener: 'calendar_entry', actor: WHO.c }),
  entry(122, 'book', 'booked', dayAt(9, 10, 45), { reasons: [why('crew_downgraded')] }),
  entry(123, 'change', 'changed', dayAt(12, 9, 15), { opener: 'schedule_drag', actor: WHO.b }),
  entry(124, 'book', 'booked', dayAt(14, 11, 30), { opener: 'schedule_slot' }),
  entry(125, 'cancel', 'cancelled', dayAt(16, 15, 0), { opener: 'schedule_visit' }),
  entry(126, 'book', 'booked', dayAt(19, 9, 50), { reasons: [why('calendar_paused', 1)], actor: WHO.c }),
  entry(127, 'book', 'booked', dayAt(22, 10, 5)),
  entry(128, 'change', 'changed', dayAt(26, 13, 40), { opener: 'schedule_visit', actor: WHO.b }),
];

/** What a machine scheduled in the window: listed only behind Machine calls, and counted in no figure. */
const MACHINE: SchedulingEntry[] = [
  direct(131, 'book', 'booked', dayAt(0, 6, 0), 'api', { actor: WHO.machine, actor_kind: 'machine', lead: CREW[2] }),
  direct(132, 'cancel', 'cancelled', dayAt(0, 6, 1), 'api', { actor: WHO.machine, actor_kind: 'machine', lead: null }),
  direct(133, 'book', 'nothing', dayAt(4, 6, 0), 'api', { actor: WHO.machine, actor_kind: 'machine', lead: null, job: null, reasons: [why('request_refused', 1, 'validation')], presses: { total: 1, ok: 0, refused: 1, failed: 0 } }),
];

const newestFirst = (entries: SchedulingEntry[]) => [...entries].sort((x, y) => y.started_at.localeCompare(x.started_at));
export const BUSY_ENTRIES = newestFirst(BUSY);
export const WITH_MACHINES = newestFirst([...BUSY, ...MACHINE]);
/** A week in which every session went clean: the newest seven days' routine entries. */
export const CLEAN_WEEK = BUSY_ENTRIES.filter((row) => row.verdict === 'clean' && Date.parse(row.started_at) > FAKE_NOW - 7 * 86_400_000);

const tally = <K extends string>(keys: K[]) => {
  const counts = new Map<K, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1]);
};

/** The overview the server would answer for these entries: its three kinds counted over people's alone, its doors and its people over the entries listed. */
export function overviewOf(
  entries: SchedulingEntry[], days: SchedulingWindowDays, trends: SchedulingKindCounts['trend'][], echo: { by?: string | null; machines?: boolean; truncated?: boolean; generated_at?: string } = {},
): SchedulingOverview {
  const people = entries.filter((row) => row.actor_kind === 'person');
  const kinds = (['book', 'change', 'cancel'] as const).map((kind, index): SchedulingKindCounts => {
    const own = people.filter((row) => row.kind === kind);
    return { kind, clean: own.filter((row) => row.verdict === 'clean').length, hiccups: own.filter((row) => row.verdict === 'hiccup').length, trend: own.length === 0 ? null : trends[index], last_at: own[0]?.started_at ?? null };
  });
  return {
    generated_at: echo.generated_at ?? new Date(FAKE_NOW).toISOString(),
    window: { days, from: new Date(FAKE_NOW - days * 86_400_000).toISOString(), to: new Date(FAKE_NOW).toISOString() },
    filters: { by: echo.by ?? null, machines: echo.machines ? 1 : 0, account: null },
    kinds: [kinds[0], kinds[1], kinds[2]],
    entries,
    truncated: echo.truncated ?? false,
    openers: tally(entries.flatMap((row) => (row.opener === null ? [] : [row.opener]))).map(([opener, count]) => ({ opener, entries: count })),
    people: tally(entries.map((row) => row.actor)).map(([actor, count]) => ({ actor, entries: count })),
    accounts: [ACCOUNT],
  };
}
