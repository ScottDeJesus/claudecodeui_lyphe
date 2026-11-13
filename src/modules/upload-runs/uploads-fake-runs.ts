import type { DayBucket, RunFriction, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
import type { UploadRunReason, UploadRunReasonCode, UploadRunReasonTone, UploadRunSummary, UploadRunsOverview, UploadType, UploadTypeCounts } from '@/shared/upload-runs-types';

/*
 * THE FAKE RUNS THE UPLOADS VIEW RENDERS OVER, until the fill's reads take their place and the three `uploads-fake*.ts`
 * files are deleted. Typed by the wire mirror, so a fake that drifts from the wire fails the build.
 *
 * MODELLED ON THE REAL HISTORY (read-only, `upload_agent_runs` and `upload_agent_run_events`, 2026-11-13: 136 runs, 8 of
 * them armed): the 2026-10-07 run's own ids, model, clock, length (4 m 48 s), ending (`operator_stop`, rc 143, nobody
 * stamped as the stopper since it was imported) and 21 tool calls; the endings the table holds (sentinel, operator_stop,
 * watchdog_idle, watchdog_max_runtime, service_restart, failed with api_error); the flows' names; the dry run `fafe085bb7f4`.
 * COMPOSED: the customers, the two logins and the second account are invented (no real person is named here), the project
 * numbers keep the real shape, and the thirty days of presses are made up so every state of the view has a row to draw.
 */

/** The moment every fixture is read at: the view's ages and its "today" count from here, so a photograph never drifts. */
export const FAKE_NOW = Date.parse('2026-10-24T10:42:00-07:00');
export const PEOPLE = ['eis:malba@restorly.example', 'eis:jreyes@restorly.example'];
const ACCOUNT = '7d0c2a1e-5b7f-4c1d-9a3e-2f6b8c4d1e90';
export const SECOND_ACCOUNT = 'b41f9c3a-0e2d-4f87-a6c5-93d1e7f0a2b8';
const iso = (ms: number) => new Date(ms).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** [customer, project number, upload type, flow]. */
const JOBS: [string, string, UploadType, string | null][] = [
  ['Dana Whitfield', '2610-518903WTR', 'initial', 'blank_initial'],
  ['Marcus & Elena Okafor', '2608-436177WTR', 'final', 'full_final'],
  ['Priya Raman', '2610-520418WTR', 'initial', 'complete_initial'],
  ['The Halvorsen Family Trust', '2609-481266FIR', 'final', 'invoice_only_final'],
  ['Luis Carrasco', '2610-522731WTR', 'initial', 'blank_initial'],
  ['Annette Björk', '2607-357940SMK', 'final', 'full_final'],
];

const why = (code: UploadRunReasonCode, tone: UploadRunReasonTone, more: { count?: number; detail?: string } = {}): UploadRunReason => ({ code, tone, ...more });
const WHY: Record<string, UploadRunReason[]> = {
  asked: [why('asked_you', 'warn', { count: 1 })],
  asked2: [why('asked_you', 'warn', { count: 2 }), why('went_quiet', 'warn', { count: 1 })],
  stopped: [why('stopped_by_person', 'warn', { detail: PEOPLE[0] })],
  bumpy: [why('walk_bumpy', 'warn', { count: 1 })],
  halted: [why('walk_halted', 'danger', { count: 1 }), why('asked_you', 'warn', { count: 2 }), why('walk_bumpy', 'warn', { count: 1 }), why('rate_limited', 'warn', { count: 3 })],
  restart: [why('server_restarted', 'danger')],
  idle: [why('idle_too_long', 'warn')],
  quiet: [why('went_quiet', 'warn', { count: 2 })],
  failed: [why('failed', 'danger', { detail: 'api_error' })],
};
/** How a run that ended on one of those endings is stamped: the three facts the wire keeps apart. */
const ENDED: Record<string, Partial<UploadRunSummary>> = {
  stopped: { state: 'terminated', ending: 'operator_stop', stop_reason: 'operator_stop', stopped_by: PEOPLE[0], rc: 143 },
  restart: { state: 'exited', ending: 'service_restart', stop_reason: null, terminal_reason: null, rc: null, ended_at: null },
  idle: { state: 'terminated', ending: 'watchdog_idle', stop_reason: 'watchdog_idle', rc: 143 },
  failed: { state: 'failed', ending: 'failed', stop_reason: 'failed', terminal_reason: 'api_error', rc: 1, stderr_head: 'API Error: 529 Overloaded. The request was not completed.\n    at stream (cli.js:4411)' },
};

type RunSpec = { sid: string; at: string; secs: number | null; job: number | null; who?: number | null; reasons?: UploadRunReason[]; tools?: number; more?: Partial<UploadRunSummary> };

/** One run of the wire's shape: `at` is local (PDT) `MM-DDTHH:MM[:SS]`, `job` an index of JOBS or null for a dry run. */
export function run({ sid, at, secs, job, who = 0, reasons = [], tools = 24, more = {} }: RunSpec): UploadRunSummary {
  const started = Date.parse(`2026-${at}-07:00`);
  const [customer, projectNumber, type, flow] = job === null ? [null, null, null, null] : JOBS[job];
  const standing = reasons.filter((reason) => reason.code !== 'events_not_kept');
  const count = (code: UploadRunReasonCode) => reasons.find((reason) => reason.code === code)?.count ?? 0;
  return {
    session_id: sid, account_id: job === null ? null : ACCOUNT, dry_run: job === null, imported: false, job_id: job === null ? null : uuid(job + 1),
    upload_type: type, archetype: flow, customer_name: customer, project_number: projectNumber, job_label: customer === null ? null : `${customer} — ${projectNumber}`,
    generated_by: who === null ? null : PEOPLE[who], invocation_id: job === null ? null : uuid(parseInt(sid.slice(-6), 16)),
    claude_session_id: `${sid.slice(0, 8)}-0000-4000-8000-${sid}`, model: 'claude-opus-5-5',
    started_at: iso(started), ended_at: secs === null ? null : iso(started + secs * 1000),
    state: 'complete', ending: 'sentinel', stop_reason: 'sentinel', stopped_by: null, terminal_reason: 'completed', rc: 0, stderr_head: null,
    counts: {
      turns: 1 + count('asked_you'), tool_calls: tools, asked: count('asked_you'), answers: count('asked_you'), quiet: count('went_quiet'),
      rate_limited: count('rate_limited'), stream_errors: count('stream_trouble'), events: tools * 2 + 14, events_dropped: count('events_not_kept'),
    },
    walks: { total: 2, armed: 1, bumpy: count('walk_bumpy'), halted: count('walk_halted') },
    verdict: standing.length > 0 ? 'hiccup' : 'clean',
    tone: standing.some((reason) => reason.tone === 'danger') ? 'danger' : standing.length > 0 ? 'warn' : 'positive',
    reasons,
    ...more,
  };
}

/** The 2026-10-07 run, as the record holds it: imported, stopped after 4 m 48 s, 21 tool calls, the stopper not stamped. */
export const RUN_1007 = run({
  sid: '241c09797b5b', at: '10-07T11:11:08', secs: 288, job: 0, tools: 21, reasons: [why('stopped_by_person', 'warn')],
  more: {
    imported: true, archetype: 'unknown', model: 'claude-fable-5-1', claude_session_id: '551d51cd-d696-4716-bf2e-c6172f6a1cbc',
    invocation_id: '040d1818-4e6c-4146-bcf0-f612fb2cf494', state: 'terminated', ending: 'operator_stop', stop_reason: 'operator_stop', rc: 143,
    counts: { turns: 1, tool_calls: 21, asked: 0, answers: 0, quiet: 0, rate_limited: 0, stream_errors: 0, events: 56, events_dropped: 0 },
    walks: { total: 0, armed: 0, bumpy: 0, halted: 0 },
  },
});

/** A long final upload: 1,500 events, two questions and a quiet spell. Its sheet pages (500 a page, Show earlier). */
export const RUN_DENSE = run({
  sid: 'd3a5e0000f1a', at: '10-22T14:40:12', secs: 2291, job: 1, tools: 688, reasons: WHY.asked2,
  more: { counts: { turns: 3, tool_calls: 688, asked: 2, answers: 2, quiet: 1, rate_limited: 0, stream_errors: 0, events: 1500, events_dropped: 0 } },
});

const EVERY_CODE: [UploadRunReasonCode, UploadRunReasonTone, { count?: number; detail?: string }][] = [
  ['did_not_start', 'danger', { detail: 'spawn_timeout' }], ['failed', 'danger', { detail: 'api_error' }],
  ['process_died', 'danger', { detail: 'node: --max-old-space-size reached, aborting\nFATAL ERROR: heap out of memory' }], ['ended_without_result', 'danger', {}],
  ['server_restarted', 'danger', {}], ['survived_restart', 'danger', {}], ['ran_too_long', 'danger', {}], ['idle_too_long', 'warn', {}],
  ['stopped_by_person', 'warn', { detail: PEOPLE[1] }], ['stopped_automatically', 'warn', { detail: 'watchdog_no_progress' }], ['ending_not_recorded', 'warn', {}],
  ['asked_you', 'warn', { count: 2 }], ['went_quiet', 'warn', { count: 3 }], ['rate_limited', 'warn', { count: 1 }], ['stream_trouble', 'warn', { count: 2 }],
  ['walk_halted', 'danger', { count: 1 }], ['walk_bumpy', 'warn', { count: 1 }], ['events_not_kept', 'neutral', { count: 14 }],
];
/** EVERY reason code at once. No run the engine could produce (it gives a run one ending at most): it exists so each sentence is drawn once, and so a row shows three chips then "+N". */
export const RUN_EVERY = run({
  sid: 'e7e4a11c0de5', at: '10-21T10:17:40', secs: 3600, job: 3, tools: 212, reasons: EVERY_CODE.map(([code, tone, more]) => why(code, tone, more)),
  more: { state: 'terminated', ending: 'watchdog_max_runtime', stop_reason: 'watchdog_max_runtime', terminal_reason: 'aborted_streaming', rc: 143, walks: { total: 3, armed: 2, bumpy: 1, halted: 1 } },
});

/** A dry run: a test of the launch path, with no job, no account and no walk. */
export const RUN_TEST = run({
  sid: 'fafe085bb7f4', at: '10-23T16:12:47', secs: 7, job: null, who: null, tools: 0,
  more: { generated_by: 'operator:probe', counts: { turns: 1, tool_calls: 0, asked: 0, answers: 0, quiet: 0, rate_limited: 0, stream_errors: 0, events: 9, events_dropped: 0 }, walks: { total: 0, armed: 0, bumpy: 0, halted: 0 } },
});

/** The live run, working or waiting on a person: open, the registry's own word (`live`), the info tone. */
export function liveRun(waiting: boolean): UploadRunSummary {
  return run({
    sid: 'c0ffee51a7e5', at: '10-24T10:38:27', secs: null, job: 4, tools: waiting ? 34 : 21,
    more: {
      state: waiting ? 'awaiting_input' : 'running', ending: null, stop_reason: null, terminal_reason: null, rc: null, verdict: 'live', tone: 'info',
      reasons: waiting ? [why('asked_you', 'warn', { count: 1 })] : [],
      counts: { turns: waiting ? 2 : 1, tool_calls: waiting ? 34 : 21, asked: waiting ? 1 : 0, answers: 0, quiet: 0, rate_limited: 0, stream_errors: 0, events: waiting ? 81 : 52, events_dropped: 0 },
      walks: { total: 1, armed: 0, bumpy: 0, halted: 0 },
    },
  });
}

/** Thirty days of presses, newest first: [local time, seconds, job, who, reasons]. */
const PRESSES: [string, number, number, number, string?][] = [
  ['10-24T09:58', 384, 2, 0], ['10-24T08:31', 546, 5, 0, 'asked'], ['10-23T15:12', 432, 0, 0], ['10-23T10:05', 498, 3, 0], ['10-23T09:14', 611, 1, 0, 'bumpy'],
  ['10-22T11:02', 405, 4, 0], ['10-21T09:33', 377, 2, 0], ['10-20T13:48', 520, 5, 0], ['10-17T10:11', 462, 0, 0], ['10-17T09:02', 398, 3, 0],
  ['10-17T08:47', 233, 1, 0, 'restart'], ['10-16T15:36', 441, 4, 1], ['10-16T11:20', 409, 2, 0], ['10-15T10:44', 934, 5, 0, 'asked2'], ['10-14T14:05', 388, 0, 0],
  ['10-14T10:31', 457, 3, 0], ['10-14T09:19', 502, 1, 0], ['10-13T11:55', 1949, 4, 0, 'idle'], ['10-10T10:02', 420, 2, 0], ['10-09T14:22', 476, 5, 1],
  ['10-09T09:41', 391, 0, 0], ['10-08T10:30', 444, 3, 0], ['10-06T10:15', 512, 1, 0], ['10-02T09:50', 688, 4, 0, 'quiet'], ['10-01T13:10', 402, 2, 0],
  ['09-30T10:26', 437, 5, 0], ['09-29T09:08', 95, 0, 1, 'failed'], ['09-26T11:40', 468, 3, 0],
];
const pressed = PRESSES.map(([at, secs, job, who, key], index) => run({
  sid: (0xa11ce0000000 + index * 7919).toString(16), at, secs, job, who, reasons: key === undefined ? [] : WHY[key], more: key === undefined ? {} : ENDED[key] ?? {},
}));

/** The window's armed runs, newest first: the made-up presses with the three named runs in their places. */
export const HISTORY: UploadRunSummary[] = [...pressed, RUN_1007, RUN_DENSE, RUN_EVERY].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

/** The heal answer joined per Claude session, as `joinFriction` will make it: the 2026-10-07 run's one healed row among them. */
export const FRICTION = new Map<string, RunFriction>([
  [RUN_1007.claude_session_id ?? '', { rows: 1, healed: 1, open: 0 }],
  [RUN_EVERY.claude_session_id ?? '', { rows: 3, healed: 1, open: 2 }],
  [RUN_DENSE.claude_session_id ?? '', { rows: 2, healed: 0, open: 2 }],
  [pressed[4].claude_session_id ?? '', { rows: 1, healed: 1, open: 0 }],
]);

/** The body of GET /overview over `runs` (newest first), as `runs_read.py` builds it: both types always present, a dry run in neither. */
export function overview(days: UploadsWindow, runs: UploadRunSummary[], more: Partial<UploadRunsOverview> = {}): UploadRunsOverview {
  const armed = runs.filter((entry) => !entry.dry_run);
  const typeRow = (type: UploadType, trend: UploadTypeCounts['trend']): UploadTypeCounts => {
    const of = armed.filter((entry) => entry.upload_type === type);
    return {
      upload_type: type, clean: of.filter((entry) => entry.verdict === 'clean').length, hiccups: of.filter((entry) => entry.verdict === 'hiccup').length,
      live: of.some((entry) => entry.verdict === 'live') ? 1 : 0, trend: of.length === 0 ? null : trend, last_at: of[0]?.started_at ?? null,
    };
  };
  const stamps = [...new Set(runs.map((entry) => entry.generated_by).filter((stamp): stamp is string => stamp !== null))];
  return {
    generated_at: iso(FAKE_NOW), window: { days, from: iso(FAKE_NOW - days * 86_400_000), to: iso(FAKE_NOW) }, filters: { by: null, tests: false, account: null },
    live: runs.find((entry) => entry.verdict === 'live') ?? null, types: [typeRow('initial', 'up'), typeRow('final', 'down')], runs, truncated: false,
    people: stamps.map((stamp) => ({ generated_by: stamp, runs: runs.filter((entry) => entry.generated_by === stamp).length })), accounts: [ACCOUNT], ...more,
  };
}

/** The window bucketed in local time, as `bucketDays` and `bucketHours` will make it: one bucket a day, 24 counts of presses. */
export function buckets(days: UploadsWindow, runs: UploadRunSummary[]): { days: DayBucket[]; hours: number[] } {
  const key = (ms: number) => {
    const date = new Date(ms);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const byDay = new Map<string, DayBucket>();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = key(FAKE_NOW - back * 86_400_000);
    byDay.set(day, { day, clean: 0, hiccup: 0, test: 0, today: back === 0 });
  }
  const hours = Array.from({ length: 24 }, () => 0);
  for (const entry of runs) {
    const started = Date.parse(entry.started_at);
    const bucket = byDay.get(key(started));
    if (bucket === undefined) continue;
    if (entry.dry_run) bucket.test += 1;
    else if (entry.verdict === 'hiccup') bucket.hiccup += 1;
    else if (entry.verdict === 'clean') bucket.clean += 1;
    hours[new Date(started).getHours()] += 1;
  }
  return { days: [...byDay.values()], hours };
}
