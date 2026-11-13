import { FAKE_NOW, FRICTION, HISTORY, PEOPLE, RUN_1007, RUN_DENSE, RUN_EVERY, RUN_TEST, SECOND_ACCOUNT, buckets, liveRun, overview } from '@/modules/upload-runs/uploads-fake-runs';
import { fakeSheet } from '@/modules/upload-runs/uploads-fake-sheets';
import type { RunSheetRead, UploadsFilters, UploadsRead, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
import type { UploadRunSummary, UploadRunsOverview } from '@/shared/upload-runs-types';

/*
 * THE SCENES THE UPLOADS VIEW RENDERS OVER, until the fill's hooks take their place and the three `uploads-fake*.ts` files
 * are deleted with the one import of this file in UploadsView.tsx. A scene is everything the root would hold or be handed
 * at one moment: the clock, the window, the filters, the open run, and the two reads. The root draws the scene named
 * here; a fixture script names another (`setFakeScene`) and mounts the view again. Nothing in a scene moves: every press
 * the view offers is `unwired` until the fill.
 */

/** One moment of the view: what its root holds (`days`, `filters`, `openSid`) and what its two reads and its clock answer. */
export type FakeScene = { now: number; days: UploadsWindow; filters: UploadsFilters; openSid: string | null; read: UploadsRead; sheet: RunSheetRead };

/** A handler the fill wires: it does nothing here, and names the state setters the fill's handler drives. */
export function unwired(..._drives: unknown[]): () => void {
  return () => {};
}

const NO_FILTERS: UploadsFilters = { by: null, tests: false, hiccupsOnly: false, account: null };
const NO_REGRESSION = { initial: false, final: false };
const LANE_SENTENCE = 'The upload engine did not answer within 10 seconds.';
/** What the sheet's read holds while no run is open: nothing, and nothing is drawn of it. */
const CLOSED = fakeSheet(RUN_1007, 'loading');
const WITH_TESTS = [...HISTORY, RUN_TEST].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));

function ready(days: UploadsWindow, runs: UploadRunSummary[], more: Partial<UploadsRead> = {}, wire: Partial<UploadRunsOverview> = {}): UploadsRead {
  return {
    phase: 'ready', overview: overview(days, runs, wire), trouble: null, stale: false, friction: FRICTION, frictionFailed: false,
    healed: { landed: 2, running: 1 }, regression: { initial: true, final: false }, ...buckets(days, runs), live: null, ...more,
  };
}
const unread = (phase: 'loading' | 'trouble'): UploadsRead => ({
  phase, overview: null, trouble: phase === 'trouble' ? LANE_SENTENCE : null, stale: false, friction: null, frictionFailed: false, healed: null, regression: NO_REGRESSION, days: [], hours: [], live: null,
});
const scene = (read: UploadsRead, more: Partial<FakeScene> = {}): FakeScene => ({ now: FAKE_NOW, days: read.overview?.window.days ?? 30, filters: NO_FILTERS, openSid: null, read, sheet: CLOSED, ...more });
const open = (entry: UploadRunSummary, state?: 'loading' | 'trouble' | 'healFailed'): Partial<FakeScene> => ({ openSid: entry.session_id, sheet: fakeSheet(entry, state) });
const live = (waiting: boolean): UploadsRead => ready(30, [liveRun(waiting), ...HISTORY], {
  live: waiting
    ? { words: 'Nobody has named which initial flow this job runs. Is it blank_initial or complete_initial?', walkStep: 'apa_contact', working: false, turns: 2, toolCalls: 34 }
    : { words: 'venv/bin/python scripts/upload.py prepare "2610-522731WTR" --upload-type initial --invocation-id 00000000-0000-4000-8000-00000051a7e5', walkStep: 'xact_dates', working: true, turns: 1, toolCalls: 21 },
});

const SCENES = {
  // The window's history: Initial and Final rows, clean runs and hiccups, a regression on Initial, nothing live.
  history: () => scene(ready(30, HISTORY)),
  // A run live and working, its walk at a step.
  liveWorking: () => scene(live(false)),
  // A run live and waiting on a person.
  liveWaiting: () => scene(live(true)),
  // The sheet on the live run: its walk in progress, nothing confirmed yet.
  sheetLive: () => scene(live(true), open(liveRun(true))),
  // The 2026-10-07 run: imported, stopped after 4 m 48 s, one tool-error row and the heal that claimed it (no fix line).
  sheet1007: () => scene(ready(30, HISTORY), open(RUN_1007)),
  // The dense run: 1,500 events, the newest 500 on screen, Show earlier.
  sheetDense: () => scene(ready(30, HISTORY), open(RUN_DENSE)),
  // Every reason at once, a walk halted with refused and blocked steps, a confirmation revoked, a regression among its friction.
  sheetEvery: () => scene(ready(30, HISTORY), open(RUN_EVERY)),
  // Test runs listed (and two accounts, so the account chips stand), with the sheet on a dry run.
  tests: () => scene(ready(30, WITH_TESTS, {}, { filters: { by: null, tests: true, account: null }, accounts: [HISTORY[0].account_id ?? '', SECOND_ACCOUNT] }), { filters: { ...NO_FILTERS, tests: true } }),
  sheetTest: () => scene(ready(30, WITH_TESTS, {}, { filters: { by: null, tests: true, account: null } }), { filters: { ...NO_FILTERS, tests: true }, ...open(RUN_TEST) }),
  // The sheet's own three faults: its read still out, the lane failed, the run read and the heal ledger not.
  sheetLoading: () => scene(ready(30, HISTORY), open(RUN_1007, 'loading')),
  sheetTrouble: () => scene(ready(30, HISTORY), open(RUN_1007, 'trouble')),
  sheetHealFailed: () => scene(ready(30, HISTORY, { friction: null, frictionFailed: true, healed: null, regression: NO_REGRESSION }), open(RUN_1007, 'healFailed')),
  // The heal answer failed: the runs stand, and the view says the ledger could not be read, never "no friction".
  healFailed: () => scene(ready(30, HISTORY, { friction: null, frictionFailed: true, healed: null, regression: NO_REGRESSION })),
  // The first read still out, and the first read failed.
  loading: () => scene(unread('loading')),
  trouble: () => scene(unread('trouble')),
  // A read that failed after a good one: the last answer, twelve minutes old, stays on screen under a strip that says its age.
  stale: () => scene(ready(30, HISTORY, { stale: true, trouble: LANE_SENTENCE }, { generated_at: new Date(FAKE_NOW - 12 * 60_000).toISOString() })),
  // No run in a 7-day window.
  empty: () => scene(ready(7, [], { friction: new Map(), healed: { landed: 0, running: 0 }, regression: NO_REGRESSION }, { people: [] })),
  // One person's runs, all clean, with Hiccups only on: the filters match nothing.
  filterNone: () => {
    const theirs = HISTORY.filter((entry) => entry.generated_by === PEOPLE[1] && entry.verdict === 'clean');
    const everyone = overview(30, HISTORY).people;
    return scene(ready(30, theirs, { regression: NO_REGRESSION }, { filters: { by: PEOPLE[1], tests: false, account: null }, people: everyone }), { filters: { ...NO_FILTERS, by: PEOPLE[1], hiccupsOnly: true } });
  },
  // One person in one account, with no run there at all: the head says this person has none, never that nobody pressed.
  filterEmpty: () => scene(
    ready(30, [], { friction: new Map(), healed: { landed: 0, running: 0 }, regression: NO_REGRESSION }, { filters: { by: PEOPLE[1], tests: false, account: SECOND_ACCOUNT }, people: overview(30, HISTORY).people, accounts: [HISTORY[0].account_id ?? '', SECOND_ACCOUNT] }),
    { filters: { ...NO_FILTERS, by: PEOPLE[1], account: SECOND_ACCOUNT } },
  ),
  // The window held more runs than one answer carries.
  truncated: () => scene(ready(90, HISTORY, {}, { truncated: true })),
};

export type FakeSceneName = keyof typeof SCENES;
/** Every scene's name, for a fixture script that photographs them all. */
export const FAKE_SCENES = Object.keys(SCENES) as FakeSceneName[];

let current: FakeSceneName = 'history';
/** Names the scene the next mount of the view draws. For fixture scripts alone: the app never calls it. */
export function setFakeScene(name: FakeSceneName): void {
  current = name;
}
/** The scene the view draws. */
export function fakeScene(): FakeScene {
  return SCENES[current]();
}
