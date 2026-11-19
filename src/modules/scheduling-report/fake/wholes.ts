import { CREW, dayAt, id, OPEN, plusSeconds, WHO, WITH_MACHINES } from '@/modules/scheduling-report/fake/entries';
import type {
  SchedulingAct, SchedulingActKind, SchedulingChosen, SchedulingEntry, SchedulingEntryWhole, SchedulingOffered, SchedulingOutcome, SchedulingSession,
  SchedulingSurface, SchedulingVisitNow,
} from '@/shared/scheduling-report-types';

/*
 * THE FAKE ENTRIES, WHOLE: what the sheet reads when one is opened (`GET /entries/{id}`'s shape). The showcased entries are
 * written out, each to draw one thing the sheet must say: the booked-then-undone session's two presses and its cancelled
 * visit; a direct drag on the grid and what touched the visit afterwards; three refusals before a booking; a calendar
 * that failed; a form closed with nothing pressed; a form still open and one that never reported; every reason at once;
 * and a machine's call. Every other entry is derived from its row, so any row of the fixture can be opened.
 *
 * Leaves with `scheduling-fake.ts` when the fill deletes it.
 */

/** The visit every fixture books: tomorrow, nine to noon, in the reader's own clock. */
const START = dayAt(-1, 9);
const END = dayAt(-1, 12);

/** One answered request, its outcome read off its status as `acts_shape.py` reads it. */
function act(n: number, of: SchedulingEntry, kind: SchedulingActKind, surface: SchedulingSurface, at: string, status: number, spec: Partial<SchedulingAct> = {}): SchedulingAct {
  const outcome: SchedulingOutcome = status < 300 ? 'ok'
    : status === 404 ? 'not_found'
      : status === 403 || spec.code === 'crew_not_confirmed_for_job_type' ? 'refused'
        : status === 503 ? 'unavailable'
          : status >= 500 ? 'fault' : 'invalid';
  return {
    id: id(7000 + n), at, kind, surface, session_id: of.form ? of.id : null, actor: of.actor, actor_kind: of.actor_kind, status, outcome,
    code: null, calendar: 'none', calendar_reason: null, crew_downgraded: false,
    start_at: START, end_at: END, visit_type: 'Mitigation', lead: of.lead, support: [], touched: [], latency_ms: 160 + ((n * 53) % 420),
    ...spec,
  };
}

const OFFERED: SchedulingOffered = {
  roster_count: 6, available_count: 4, best_fit_id: CREW[0].id, none_offered: false, availability_unread: false, gate_warn: false,
  left_out_count: 2, slots_count: 5, slots_on: true, travel_checked: true, hint_crew: 2, hint_hours: 3,
};

/** The form's report for an entry: the usual offer, and a choice that follows the entry's own lead. */
function session(of: SchedulingEntry, offered: Partial<SchedulingOffered> = {}, chosen: Partial<SchedulingChosen> = {}, extra: Partial<SchedulingSession> = {}): SchedulingSession {
  const rank = of.lead === null ? -1 : CREW.findIndex((person) => person.id === of.lead?.id);
  return {
    mode: of.kind === 'book' ? 'create' : 'edit',
    opener: of.opener ?? 'unknown',
    proposal: { job_id: of.job?.id ?? null, visit_type: 'Mitigation', trust: 'job_stage' },
    offered: { ...OFFERED, ...offered },
    chosen: {
      lead_id: of.lead?.id ?? null, lead_rank: rank < 0 ? null : rank, lead_available: of.lead === null ? null : true, support_count: 1, temp_count: 0,
      start_at: START, duration_minutes: 180, slot_picked: true, visit_type: 'Mitigation', type_changed: false, job_changed: false, duration_stepped: false,
      ...chosen,
    },
    presses: of.presses.total, unanswered: 0, edit_unreadable: false, best_fit: CREW[0],
    ...extra,
  };
}

const visit = (status: string, extra: Partial<SchedulingVisitNow> = {}): SchedulingVisitNow => ({ status, start_at: START, end_at: END, visit_type: 'Mitigation', cancelled_at: null, ...extra });
const CREW_REFUSAL = { code: 'crew_not_confirmed_for_job_type' };
const ACT_KIND = { book: 'create', change: 'edit', cancel: 'cancel' } as const;

/** Any entry of the fixture, whole, from its row alone: its report when it has one, one press when it pressed, the visit when it wrote one. */
function derived(of: SchedulingEntry): SchedulingEntryWhole {
  const done = of.result !== 'nothing';
  return {
    entry: of,
    session: of.state === 'reported' ? session(of) : null,
    acts: of.presses.total === 0 ? [] : [act(100 + Number(of.id.slice(-3)), of, ACT_KIND[of.kind], of.surface ?? 'form', of.ended_at ?? of.started_at, done || of.surface === 'undo' ? 200 : 422, done ? { calendar: 'confirmed' } : {})],
    visit_now: done ? visit(of.result === 'cancelled' ? 'cancelled' : 'confirmed', of.result === 'cancelled' ? { cancelled_at: of.started_at } : {}) : null,
    after: [],
  };
}

const row = (entryId: string): SchedulingEntry => {
  const found = WITH_MACHINES.find((entry) => entry.id === entryId);
  if (found === undefined) throw new Error(`the scheduling fixture has no entry ${entryId}`);
  return found;
};
const at = (of: SchedulingEntry, seconds: number) => plusSeconds(of.started_at, seconds);

/** The showcased entries, written out. */
function written(): Record<string, SchedulingEntryWhole> {
  const undone = row(OPEN.undone);
  const closed = row(OPEN.closed);
  const open = row(OPEN.open);
  const notReported = row(OPEN.notReported);
  const gridMove = row(OPEN.gridMove);
  const crewRefused = row(OPEN.crewRefused);
  const calendarFailed = row(OPEN.calendarFailed);
  const every = row(OPEN.everyReason);
  const machine = row(OPEN.machine);
  const moved = { start_at: dayAt(-2, 13), end_at: dayAt(-2, 15) };
  return {
    // Booked, then undone eight seconds later: two presses, and the visit now cancelled.
    [undone.id]: {
      entry: undone, session: session(undone),
      acts: [act(1, undone, 'create', 'form', at(undone, 62), 201, { calendar: 'confirmed', support: [CREW[3]] }), act(2, undone, 'cancel', 'undo', at(undone, 70), 200)],
      visit_now: visit('cancelled', { cancelled_at: at(undone, 70) }), after: [],
    },
    // Opened from a job's schedule band and closed 21 seconds later with nothing set and nothing pressed.
    [closed.id]: {
      entry: closed, session: session(closed, {}, { support_count: 0, start_at: null, slot_picked: false }), acts: [], visit_now: null, after: [],
    },
    // Still open: one press refused three minutes ago, and no report yet.
    [open.id]: { entry: open, session: null, acts: [act(3, open, 'create', 'form', at(open, 95), 422, CREW_REFUSAL)], visit_now: null, after: [] },
    // A change that went through, from a form whose report never arrived.
    [notReported.id]: {
      entry: notReported, session: null,
      acts: [act(4, notReported, 'edit', 'form', at(notReported, 48), 200, { touched: ['start_at', 'end_at'], calendar: 'confirmed' })],
      visit_now: visit('confirmed'), after: [],
    },
    // A drag on the grid, and what two other people did to the same visit afterwards.
    [gridMove.id]: {
      entry: gridMove, session: null,
      acts: [act(5, gridMove, 'edit', 'grid_move', gridMove.started_at, 200, { ...moved, touched: ['start_at', 'end_at'], calendar: 'confirmed' })],
      visit_now: visit('confirmed', { start_at: dayAt(-2, 13), end_at: dayAt(-2, 16) }),
      after: [
        act(6, gridMove, 'edit', 'grid_resize', at(gridMove, 1500), 200, { ...moved, end_at: dayAt(-2, 16), touched: ['end_at'], actor: WHO.a, calendar: 'paused' }),
        act(7, gridMove, 'edit', 'form', at(gridMove, 5400), 200, { ...moved, end_at: dayAt(-2, 16), touched: ['lead_personnel_id'], actor: WHO.c, lead: CREW[2], session_id: id(141), calendar: 'confirmed' }),
      ],
    },
    // Two leads refused by the crew check, then booked with the third on the list.
    [crewRefused.id]: {
      entry: crewRefused, session: session(crewRefused, { left_out_count: 3 }),
      acts: [
        act(8, crewRefused, 'create', 'form', at(crewRefused, 58), 422, { ...CREW_REFUSAL, lead: CREW[1] }),
        act(9, crewRefused, 'create', 'form', at(crewRefused, 101), 422, { ...CREW_REFUSAL, lead: CREW[3] }),
        act(10, crewRefused, 'create', 'form', at(crewRefused, 155), 201, { calendar: 'confirmed', support: [CREW[0]] }),
      ],
      visit_now: visit('confirmed'), after: [],
    },
    // Saved, and the calendar did not take it.
    [calendarFailed.id]: {
      entry: calendarFailed, session: session(calendarFailed),
      acts: [act(11, calendarFailed, 'create', 'form', at(calendarFailed, 80), 201, { calendar: 'error', calendar_reason: 'graph_timeout' })],
      visit_now: visit('tentative'), after: [],
    },
    // Every reason at once: each kind of answer the server gives, a form that offered nothing, and two presses it never saw.
    [every.id]: {
      entry: every,
      session: session(every,
        { roster_count: 0, available_count: 0, best_fit_id: null, none_offered: true, availability_unread: true, gate_warn: true, left_out_count: 5, slots_count: 0, travel_checked: false, hint_crew: null, hint_hours: null },
        { lead_rank: null, lead_available: false, support_count: 0, temp_count: 2, slot_picked: false, visit_type: 'Monitoring', type_changed: true, job_changed: true, duration_stepped: true, duration_minutes: 90 },
        { presses: 11, unanswered: 2, edit_unreadable: true, best_fit: null }),
      acts: [
        act(12, every, 'create', 'form', at(every, 70), 500),
        act(13, every, 'create', 'form', at(every, 131), 503, { code: 'account_unresolved' }),
        act(14, every, 'create', 'form', at(every, 190), 422, CREW_REFUSAL),
        act(15, every, 'create', 'form', at(every, 244), 422, CREW_REFUSAL),
        act(16, every, 'create', 'form', at(every, 301), 403, { code: 'armed_write_requires_login' }),
        act(17, every, 'create', 'form', at(every, 356), 422, { code: 'validation' }),
        act(18, every, 'create', 'form', at(every, 410), 404, { code: 'job_not_found' }),
        act(19, every, 'create', 'form', at(every, 498), 201, { calendar: 'error', calendar_reason: 'graph_timeout', crew_downgraded: true }),
        act(20, every, 'cancel', 'undo', at(every, 560), 200, { calendar: 'paused' }),
      ],
      visit_now: visit('cancelled', { visit_type: 'Monitoring', cancelled_at: at(every, 560) }),
      after: [act(21, every, 'edit', 'api', at(every, 86_400), 404, { actor: WHO.machine, actor_kind: 'machine', session_id: null, code: 'visit_not_found', lead: null, start_at: null, end_at: null })],
    },
    // A machine's booking through the API, cancelled by the same machine a minute later (another entry's act).
    [machine.id]: {
      entry: machine, session: null,
      acts: [act(22, machine, 'create', 'api', machine.started_at, 201, { calendar: 'paused' })],
      visit_now: visit('cancelled', { cancelled_at: at(machine, 60) }),
      after: [act(23, machine, 'cancel', 'api', at(machine, 60), 200, { session_id: null })],
    },
  };
}

const WRITTEN = written();

/** The entry whole, as the sheet's read would answer it: written out when it is a showcased one, derived from its row otherwise. */
export function wholeOf(entryId: string): SchedulingEntryWhole {
  return WRITTEN[entryId] ?? derived(row(entryId));
}
