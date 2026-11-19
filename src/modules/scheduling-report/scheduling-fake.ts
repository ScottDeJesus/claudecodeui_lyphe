import type { TFunction } from 'i18next';

import { BUSY_ENTRIES, CLEAN_WEEK, FAKE_NOW, minsAgo, OPEN, overviewOf, WHO, WITH_MACHINES } from '@/modules/scheduling-report/fake/entries';
import { wholeOf } from '@/modules/scheduling-report/fake/wholes';
import type { EntrySheetRead, SchedulingFilters, SchedulingPillKey, SchedulingRead, SchedulingWindow } from '@/modules/scheduling-report/utils/schedulingModel';
import { troubleSentence } from '@/modules/scheduling-report/utils/schedulingWords';
import { bucketDays, bucketHours } from '@/shared/dayBuckets';
import type { DayBucketItem } from '@/shared/dayBuckets';
import type { SchedulingEntry, SchedulingKindCounts, SchedulingOverview } from '@/shared/scheduling-report-types';
import type { AffectedAreasTrouble } from '@/shared/types';

/*
 * THE FAKES THE SCHEDULING VIEW RENDERS OVER, until the fill's two hooks take their place and this file is deleted with
 * the `fake/` folder beside it and the one import of it in SchedulingView.tsx. Three things: `FAKE_READS`, which stands
 * where the two hooks will; `unwired`, the handler that does nothing; and `FAKE_STAGE`, which a fixture script uses to put
 * the root in any of the scenes below. The entries are `fake/entries.ts`, and each one whole `fake/wholes.ts`.
 *
 * A SCENE IS ONE STATE OF THE SCREEN: the root's own three states (the window, the filters, the open entry) and what the
 * two reads answer. The root holds its three states itself and its handlers are not wired, so a scene's state is seated
 * from outside: each `unwired` call names the setter its handler will drive, and `FAKE_STAGE.seat()` calls them.
 */

type Scene = {
  days: SchedulingWindow;
  filters: SchedulingFilters;
  openId: string | null;
  /** The window's answer. Null with a `trouble` is a first read that failed; null without one is a first read still out. */
  overview: SchedulingOverview | null;
  /** Why the newest read of the window brought no answer; with an `overview` it is the stale strip. */
  trouble: AffectedAreasTrouble | null;
  /** The open entry's read, when it is not simply the fixture's whole: still out, or failed for this reason. */
  sheet?: 'loading' | AffectedAreasTrouble;
};

const ALL: SchedulingFilters = { by: null, machines: false, bumpsOnly: false };
const TRENDS: SchedulingKindCounts['trend'][] = ['up', 'down', 'flat'];
const scene = (overview: SchedulingOverview | null, state: Partial<Scene> = {}): Scene => ({ days: 30, filters: ALL, openId: null, overview, trouble: null, ...state });
const busy = overviewOf(BUSY_ENTRIES, 30, TRENDS);
const machines = scene(overviewOf(WITH_MACHINES, 30, TRENDS, { machines: true }), { filters: { ...ALL, machines: true } });
const cleanWeek = overviewOf(CLEAN_WEEK, 7, ['down', 'flat', null]);

/** Every state the view draws, by name. `busy` is what the root shows when nothing picked another. */
const FAKE_SCENES = {
  // A 30-day window: book, change and cancel sessions, clean and bumped, with a rising, a falling and a steady trend.
  busy: scene(busy),
  // The same window cut short by the answer's cap: every figure a floor.
  truncated: scene(overviewOf(BUSY_ENTRIES, 30, TRENDS, { truncated: true })),
  // Machine calls on: three machine entries listed, grey, and counted in no figure.
  machines,
  // Narrowed to one person, who has sessions.
  scoped: scene(overviewOf(BUSY_ENTRIES.filter((row) => row.actor === WHO.b), 30, ['flat', 'down', 'flat'], { by: WHO.b }), { filters: { ...ALL, by: WHO.b } }),
  // A week in which everything went clean.
  clean: scene(cleanWeek, { days: 7 }),
  // A filter that matches nothing, twice: Speed bumps only over a clean week (the browser's own), and a person with no session this week (the server's).
  noMatchBumps: scene(cleanWeek, { days: 7, filters: { ...ALL, bumpsOnly: true } }),
  noMatchPerson: scene(overviewOf([], 7, [], { by: WHO.c }), { days: 7, filters: { ...ALL, by: WHO.c } }),
  // No entry in the window: with a wider window to press, with Machine calls already on, and at ninety days, where there is none wider.
  empty: scene(overviewOf([], 30, [])),
  emptyMachines: scene(overviewOf([], 30, [], { machines: true }), { filters: { ...ALL, machines: true } }),
  emptyWidest: scene(overviewOf([], 90, []), { days: 90 }),
  // The first read out, the first read failed, and a re-read that failed three hours after a good one.
  loading: scene(null),
  unreachable: scene(null, { trouble: 'unreachable' }),
  stale: scene(overviewOf(BUSY_ENTRIES, 30, TRENDS, { generated_at: minsAgo(185) }), { trouble: 'unreachable' }),
  // The sheet, open on each entry that has something of its own to say, and in its two other states.
  sheetUndone: scene(busy, { openId: OPEN.undone }),
  sheetGridMove: scene(busy, { openId: OPEN.gridMove }),
  sheetCrewRefused: scene(busy, { openId: OPEN.crewRefused }),
  sheetCalendarFailed: scene(busy, { openId: OPEN.calendarFailed }),
  sheetClosed: scene(busy, { openId: OPEN.closed }),
  sheetOpen: scene(busy, { openId: OPEN.open }),
  sheetNotReported: scene(busy, { openId: OPEN.notReported }),
  sheetEveryReason: scene(busy, { openId: OPEN.everyReason }),
  sheetMachine: { ...machines, openId: OPEN.machine },
  sheetLoading: scene(busy, { openId: OPEN.undone, sheet: 'loading' }),
  sheetTrouble: scene(busy, { openId: OPEN.crewRefused, sheet: 'failed' }),
} satisfies Record<string, Scene>;

type SceneName = keyof typeof FAKE_SCENES;

/** The scene the reads answer from. */
let current: Scene = FAKE_SCENES.busy;

/**
 * An entry as a day's bucket item, dated by when it started: a machine's is the grey `test` part, a person's its verdict's.
 * This is the pure fill `entriesToBuckets` in small, so the fixtures' columns and hours are made the way the real ones will be.
 */
const dayItemOf = (entry: SchedulingEntry): DayBucketItem => ({ at: entry.started_at, part: entry.actor_kind === 'machine' ? 'test' : entry.verdict });

/** What stands where the two hooks will: each answers from the picked scene, in the hook's own shape. */
export const FAKE_READS = {
  /** For `useSchedulingRead`: the window's read, and the moment it settled. */
  window(t: TFunction): { read: SchedulingRead; readAt: number } {
    const { overview, trouble } = current;
    const items = overview === null ? [] : overview.entries.map(dayItemOf);
    return {
      read: {
        phase: overview !== null ? 'ready' : trouble !== null ? 'trouble' : 'loading',
        overview,
        trouble: trouble === null ? null : troubleSentence(t, trouble, 'overview'),
        stale: overview !== null && trouble !== null,
        // Counted from the day the answer was made, so the last column is the day its newest entries fell on.
        days: overview === null ? [] : bucketDays(items, overview.window.days, Date.parse(overview.generated_at)),
        hours: overview === null ? [] : bucketHours(items),
      },
      readAt: FAKE_NOW,
    };
  },
  /** For `useEntrySheet`: the open entry's read. */
  sheet(t: TFunction, openId: string | null): EntrySheetRead {
    if (openId === null || current.sheet === 'loading') return { phase: 'loading', whole: null, trouble: null };
    if (current.sheet !== undefined) return { phase: 'trouble', whole: null, trouble: troubleSentence(t, current.sheet, 'entry') };
    return { phase: 'ready', whole: wholeOf(openId), trouble: null };
  },
};

/** The root's state setters, by the state each drives. */
type Seat = {
  days: (days: SchedulingWindow) => void;
  filters: (filters: SchedulingFilters) => void;
  openId: (id: string | null) => void;
  pill: (key: SchedulingPillKey | null) => void;
};
const seat: Partial<Seat> = {};

/** A handler the fill wires: it does nothing here. It names the state setter the fill's handler drives, which the stage below keeps. */
export function unwired(drives: Partial<Seat> = {}): () => void {
  Object.assign(seat, drives);
  return () => {};
}

/**
 * For a fixture script: `pick` a scene before the root mounts (the reads answer from it at once), then `seat` the mounted
 * root in that scene's own state. Nothing in the app calls it.
 */
export const FAKE_STAGE = {
  scenes: Object.keys(FAKE_SCENES) as SceneName[],
  pick(name: SceneName): void {
    current = FAKE_SCENES[name];
  },
  seat(): void {
    seat.days?.(current.days);
    seat.filters?.(current.filters);
    seat.openId?.(current.openId);
  },
};
