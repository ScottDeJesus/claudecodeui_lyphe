import type { HealSessionsAnswer } from '@/modules/heal';
import type { UploadRunEvent, UploadRunsOverview, UploadRunWhole } from '@/shared/upload-runs-types';

/*
 * THE UPLOADS VIEW'S MODEL: the shapes its root hands its parts. Types only, nothing here runs.
 *
 * The root (`UploadsView`) holds three things of its own: the window, the filters and the open run's session id. Everything
 * else it draws arrives as two shapes, `UploadsRead` (the window's runs and what was joined to them) and `RunSheetRead` (the
 * one run its sheet is open on). The wire shapes inside them are `@/shared/upload-runs-types`, the heal worker's answer is
 * the heal module's, through its barrel; this file adds only what the browser derives from the two.
 */

/** The window switch's three lengths, in days. */
export type UploadsWindow = 7 | 30 | 90;

/**
 * What the Runs list is narrowed to. `by` is one person's stamp (`generated_by`) or null for everyone; `tests` lists dry
 * runs too; `account` is one account's id or null for all. Those three are asked of the server. `hiccupsOnly` is the
 * browser's own: it hides the runs that ran clean from the list and changes no count.
 */
export type UploadsFilters = { by: string | null; tests: boolean; hiccupsOnly: boolean; account: string | null };

/** The heal answer's rows for one Claude session: how many friction rows the run's agent filed, how many a landed heal took, how many still stand open. */
export type RunFriction = { rows: number; healed: number; open: number };

/** One day of the window, in the browser's local time (`day` is local YYYY-MM-DD): its armed runs by verdict, its test runs, and whether it is today. */
export type DayBucket = { day: string; clean: number; hiccup: number; test: number; today: boolean };

/**
 * What the live run is doing right now, from its own stream: `words` is its newest step (the newest tool call's summary, or
 * the agent's words; null before the first), `walkStep` the step its walk stands at once a walk frame has arrived, `working`
 * false while it waits on a person, and the turns and tool calls so far.
 */
export type LiveStep = { words: string | null; walkStep: string | null; working: boolean; turns: number; toolCalls: number };

/**
 * The window's read. `phase` is the first read's own: `loading` until it answers, `trouble` when the lane failed (`trouble`
 * then holds the lane's sentence). A read that fails after a good one keeps `overview` and sets `stale`. `friction` is the
 * heal answer joined per Claude session id, null until it answers and null with `frictionFailed` when it could not be read:
 * "not read" is never "no friction". `healed` counts the heals that claimed this window's friction. `regression` says, per
 * upload type, whether one of its runs carries a friction row a landed heal's shape came back in. `days` and `hours` are the
 * window bucketed in local time (`hours` is 24 counts of presses, by local hour). `live` is the live run's newest step.
 */
export type UploadsRead = {
  phase: 'loading' | 'ready' | 'trouble';
  overview: UploadRunsOverview | null;
  trouble: string | null;
  stale: boolean;
  friction: Map<string, RunFriction> | null;
  frictionFailed: boolean;
  healed: { landed: number; running: number } | null;
  regression: Record<'initial' | 'final', boolean>;
  days: DayBucket[];
  hours: number[];
  live: LiveStep | null;
};

/**
 * The open run's read. `whole` is the run with its walks and what came after; `events` the page of its events on screen, in
 * order, with `hasEarlier` while older ones were not asked for yet. `live` is true while the registry holds this run and its
 * stream is open. `friction` is the heal answer for this run's Claude session alone, with the same two "not yet" and "could
 * not be read" readings as the window's.
 */
export type RunSheetRead = {
  phase: 'loading' | 'ready' | 'trouble';
  whole: UploadRunWhole | null;
  events: UploadRunEvent[];
  hasEarlier: boolean;
  live: boolean;
  friction: HealSessionsAnswer | null;
  frictionFailed: boolean;
  trouble: string | null;
};

/**
 * The live run as the head and the pills say it: whether it works or waits on a person, and whether it is a test. A dry run
 * can be live like any run, and it is never said to be an upload.
 */
export type LiveStatus = { state: 'working' | 'waiting'; test: boolean };

/** The five pills, in the order drawn: each carries the reader to the section its figure counted. */
export type UploadsPillKey = 'runs' | 'hiccups' | 'live' | 'lastRun' | 'healed';

/** The window's armed runs counted for the head and the pills: test runs are in none of these. `last` is the newest armed run. */
export type UploadsTally = { runs: number; clean: number; hiccups: number; last: UploadRunsOverview['runs'][number] | null };
