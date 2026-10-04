import { createContext } from 'react';

import type { CelebrationActive, Moment } from '@/modules/roadmap/celebrationContext';
import type { RoadmapView } from '@/modules/roadmap/hooks/useRoadmap';
import type {
  Roadmap,
  RoadmapEpic,
  RoadmapFeature,
  RoadmapFeatureStep,
  RoadmapFeatureWord,
  RoadmapMilestone,
  RoadmapPicture,
  RoadmapTask,
} from '@/shared/roadmap-types';
import type { SortableList } from '@/shared/ui/sortable/useSortable';

// THE SCAFFOLDS' PICTURE. Every scaffold of the roadmap module draws from this file until its fill swaps
// each `// FILL:` read that answers from here for the real one and retires its import; the fill that
// removes the last import deletes the file. Two roadmaps, built so every word and standing is DERIVED as
// the dispatcher derives it (`hooks/dispatcher/report_roadmap.py`), never typed beside its children. They
// hold a milestone in every milestone word, an epic in every epic word, a feature in every word and step,
// both `waiting_on_you` kinds, blocked items at all three levels, in-flight features part done, a wait on
// a name the picture lacks, and unplaced items. The moments play on `fake-lyphecli` (every milestone
// reached), the task moment on `fake-restorly`.

/** What one fake feature says about itself; everything else is filled in by `feature`. */
type FeatureSpec = {
  title: string;
  word: RoadmapFeatureWord;
  /** The finer step; the word itself for an idea, a proposed or a shipped feature. */
  step?: RoadmapFeatureStep;
  project?: string;
  tasks?: number;
  done?: number;
  waitsOn?: string[];
  blocked?: string;
  goal?: string | null;
  /** A shipped feature's day, and the stamp its last task is done at. */
  shippedAt?: string;
};

/** Plausible task titles, dealt out in order: a scaffold's dialog lists them. */
const TASK_TITLES = [
  'The data underneath', 'The words', 'The kit', 'The screen, composed', 'The screen, filled', 'The dialogs',
  'The motion', 'The phone pass', 'The reader', 'The writer', 'The docs', 'The probe', 'The whole, once',
];

/** A dispatcher stamp `hours` before another, in the store's own `YYYY-MM-DDTHH:MM:SSZ` shape. */
function hoursBefore(stamp: string, hours: number): string {
  return new Date(Date.parse(stamp) - hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Today's in-flight work finishes its tasks around this hour; a shipped feature's own day is its `shippedAt`. */
const NOW = '2026-10-03T21:40:00Z';

/** One feature, its tasks cut and dated as its word says (none before `cutting`; a running one while building). */
function feature(name: string, position: number, spec: FeatureSpec): RoadmapFeature {
  const step = spec.step ?? (spec.word as RoadmapFeatureStep);
  const total = spec.tasks ?? 0;
  const done = spec.word === 'shipped' ? total : spec.done ?? 0;
  const lastDone = spec.shippedAt ?? NOW;
  const tasks: RoadmapTask[] = Array.from({ length: total }, (_, index) => ({
    key: `task-${index + 1}`,
    title: TASK_TITLES[index % TASK_TITLES.length],
    status: index < done ? 'done' : index === done && step === 'building' ? 'running' : 'not started',
    done_at: index < done ? hoursBefore(lastDone, (done - 1 - index) * 3) : null,
  }));
  const promoted = !['idea', 'proposed'].includes(spec.word);
  const approved = spec.word === 'in flight' || spec.word === 'shipped';
  return {
    name,
    title: spec.title,
    goal: spec.goal === undefined ? `${spec.title}, so the crew never has to call the office to ask.` : spec.goal,
    project: spec.project ?? 'Restorly',
    repo: spec.project === 'lyphecli' ? '/home/lyphe/.claude/claudecodeui_lyphe' : '/home/lyphe/restorly',
    position,
    blocked: spec.blocked ?? null,
    word: spec.word,
    step,
    waiting_on_you: step === 'questions' || step === 'accept' ? step : null,
    waits_on: spec.waitsOn ?? [],
    tasks,
    created_at: '2026-09-12T15:02:10Z',
    promoted_at: promoted ? '2026-09-20T18:30:00Z' : null,
    approved_at: approved ? '2026-09-21T09:12:44Z' : null,
    shipped_at: spec.word === 'shipped' ? lastDone : null,
  };
}

/** The newest of some stamps, or null — the store's `_newest`. */
function newest(stamps: (string | null)[]): string | null {
  return stamps.filter((stamp): stamp is string => stamp !== null).sort().at(-1) ?? null;
}

/** How many of `items` carry `word`. */
function count<T extends { word: string }>(items: T[], word: string): number {
  return items.filter((item) => item.word === word).length;
}

/** One epic, its word and standing derived from its features (`_epic_word`). */
function epic(name: string, position: number, title: string, features: RoadmapFeature[], blocked: string | null = null): RoadmapEpic {
  const word = features.length === 0 ? 'empty'
    : features.every((item) => item.word === 'shipped') ? 'complete'
      : features.every((item) => item.word === 'idea' || item.word === 'proposed') ? 'not started'
        : 'in progress';
  return {
    name,
    title,
    goal: `${title}: what it is for, in the operator's words.\n\n> "Plain words, and nothing I have to ask twice."`,
    position,
    created_at: '2026-09-10T12:00:00Z',
    blocked,
    designed_whole: false,
    word,
    completed_at: word === 'complete' ? newest(features.map((item) => item.shipped_at)) : null,
    standing: {
      features: features.length, shipped: count(features, 'shipped'), in_flight: count(features, 'in flight'),
      designing: count(features, 'designing'), proposed: count(features, 'proposed'), ideas: count(features, 'idea'),
    },
    features,
  };
}

/** One milestone, its word and standing derived from its epics (`_milestone_word`). */
function milestone(name: string, position: number, title: string, goal: string | null, epics: RoadmapEpic[], blocked: string | null = null): RoadmapMilestone {
  const word = epics.length === 0 ? 'empty'
    : epics.every((item) => item.word === 'complete') ? 'reached'
      : epics.some((item) => item.word === 'in progress' || item.word === 'complete') ? 'in progress'
        : 'not started';
  return {
    name,
    title,
    goal,
    position,
    created_at: '2026-09-10T11:00:00Z',
    blocked,
    word,
    reached_at: word === 'reached' ? newest(epics.map((item) => item.completed_at)) : null,
    standing: {
      epics: epics.length,
      complete: count(epics, 'complete'),
      features: epics.reduce((sum, item) => sum + item.standing.features, 0),
      shipped: epics.reduce((sum, item) => sum + item.standing.shipped, 0),
    },
    epics,
  };
}

/** One roadmap, its word, `current` and standing derived from its milestones (`Reader.roadmap`). */
function roadmap(name: string, position: number, title: string, goal: string | null, milestones: RoadmapMilestone[]): Roadmap {
  const epics = milestones.flatMap((item) => item.epics);
  const placed = milestones.flatMap((stop) => stop.epics.flatMap((group) => group.features.map((item) => ({ stop, group, item }))));
  const sum = (key: keyof RoadmapEpic['standing']) => epics.reduce((total, item) => total + item.standing[key], 0);
  return {
    name,
    title,
    goal,
    position,
    created_at: '2026-09-10T10:00:00Z',
    word: milestones.length === 0 ? 'no path yet' : milestones.every((item) => item.word === 'reached') ? 'every milestone reached' : 'on the way',
    current: milestones.find((item) => item.word !== 'reached')?.name ?? null,
    standing: {
      milestones: milestones.length, reached: count(milestones, 'reached'), epics: epics.length, complete: count(epics, 'complete'),
      features: sum('features'), shipped: sum('shipped'), in_flight: sum('in_flight'), designing: sum('designing'),
      proposed: sum('proposed'), ideas: sum('ideas'),
      blocked: placed.filter(({ stop, group, item }) => stop.blocked || group.blocked || item.blocked).length,
      waiting_on_you: placed.filter(({ item }) => item.waiting_on_you !== null).length,
    },
    milestones,
  };
}

/** Restorly, on the way: a milestone in each of the four words, the current one holding three epics. */
const RESTORLY = roadmap('fake-restorly', 1, 'Restorly', 'Restorly runs a water job from the first call to the last invoice, from a phone in the truck.', [
  milestone('fake-makeover', 1, 'The makeover', 'Restorly looks and moves like one app, on a phone and at a desk.', [
    epic('fake-kit-epic', 1, 'The Restorly makeover', [
      feature('fake-kit', 1, { title: 'The kit', word: 'shipped', tasks: 6, shippedAt: '2026-09-21T18:04:11Z' }),
      feature('fake-shell', 2, { title: 'The shell', word: 'shipped', tasks: 12, waitsOn: ['fake-kit'], shippedAt: '2026-09-24T02:31:40Z' }),
      feature('fake-chat', 3, { title: 'The job chat', word: 'shipped', tasks: 10, shippedAt: '2026-09-28T19:02:48Z' }),
    ]),
    epic('fake-uploads-epic', 2, 'Photos that arrive', [
      feature('fake-uploads', 1, { title: 'Uploads from the truck', word: 'shipped', tasks: 5, shippedAt: '2026-09-26T13:20:05Z' }),
    ]),
  ]),
  milestone('fake-field', 2, 'Crews in the field', 'A crew lead runs the whole day from the phone: where to be, what to log, and what is left.', [
    epic('fake-day-epic', 1, "The crew's day", [
      feature('fake-crew-schedule', 1, { title: 'Crew schedule on the phone', word: 'in flight', step: 'building', tasks: 10, done: 3 }),
      feature('fake-moisture-meter', 2, { title: 'Moisture readings from the meter', word: 'in flight', step: 'building', tasks: 8, done: 5 }),
      feature('fake-day-sheet', 3, { title: 'The day sheet', word: 'in flight', step: 'waiting', tasks: 6, waitsOn: ['fake-crew-schedule'] }),
      feature('fake-equipment-log', 4, { title: 'Equipment on site', word: 'in flight', step: 'waiting', tasks: 5, waitsOn: ['fake-dryer-catalog'] }),
      feature('fake-time-cards', 5, { title: 'Time cards', word: 'in flight', step: 'queued', tasks: 9 }),
      feature('fake-mileage', 6, { title: 'Mileage from the truck', word: 'in flight', step: 'paused', tasks: 7, done: 4, blocked: 'The mileage vendor changed its API; waiting on their new keys' }),
      feature('fake-site-photos', 7, { title: 'Site photos by room', word: 'in flight', step: 'starting', tasks: 6 }),
      feature('fake-job-board', 8, { title: 'The job board', word: 'shipped', tasks: 8, shippedAt: '2026-10-01T16:45:30Z' }),
    ]),
    epic('fake-logs-epic', 2, 'Moisture logs the carrier accepts', [
      feature('fake-log-template', 1, { title: "The carrier's log template", word: 'designing', step: 'designing' }),
      feature('fake-drying-goals', 2, { title: 'Drying goals per material', word: 'designing', step: 'questions' }),
      feature('fake-log-export', 3, { title: 'Export a log as a PDF', word: 'designing', step: 'cutting' }),
      feature('fake-readings-sync', 4, { title: 'Readings that sync offline', word: 'designing', step: 'accept', tasks: 7 }),
      feature('fake-thermal', 5, { title: 'Thermal camera photos', word: 'designing', step: 'parked' }),
      feature('fake-log-reminders', 6, { title: 'Reminders for a missing log', word: 'idea', goal: null }),
    ]),
    epic('fake-review-epic', 3, 'Carrier review', [
      feature('fake-review-queue', 1, { title: 'The review queue', word: 'proposed' }),
      feature('fake-review-notes', 2, { title: 'Adjuster notes on the job', word: 'proposed', blocked: "Needs the adjuster's sign-off on the format" }),
      feature('fake-photo-markup', 3, { title: 'Photo markup for the adjuster', word: 'idea' }),
    ], 'The carrier has not opened its review API yet'),
  ]),
  milestone('fake-paid', 3, 'Carriers paid on time', 'Every invoice leaves the day the job closes, and the money comes back without a phone call.', [
    epic('fake-invoicing-epic', 1, 'Invoices out the door', [
      feature('fake-invoice-draft', 1, { title: 'Draft the invoice from the job', word: 'idea' }),
      feature('fake-invoice-send', 2, { title: 'Send it to the carrier', word: 'idea' }),
    ]),
    epic('fake-collections-epic', 2, 'Collections', []),
  ], "Waiting on the carrier's billing contract"),
  milestone('fake-franchise', 4, 'Restorly for every franchise', null, []),
]);

/** lyphecli, every milestone reached: the feature, epic and milestone moments play on its items. */
const LYPHECLI = roadmap('fake-lyphecli', 2, 'lyphecli', 'I want this CloudCLI to be my mobile command center.', [
  milestone('fake-ly-runner', 1, 'Plans run themselves', 'A plan walks from its Accept to shipped without a hand on it.', [
    epic('fake-ly-engine', 1, 'The runner', [
      feature('fake-ly-ready', 1, { title: 'The dispatcher, ready', word: 'shipped', project: 'house', tasks: 14, shippedAt: '2026-09-25T08:10:00Z' }),
      feature('fake-ly-planners', 2, { title: 'Planners in their lanes', word: 'shipped', project: 'house', tasks: 14, shippedAt: '2026-09-27T13:57:24Z' }),
    ]),
  ]),
  milestone('fake-ly-workspace', 2, 'A workspace to live in', 'Everything the operator does in a day, in one place he wants to be.', [
    epic('fake-ly-cards', 1, 'Runner cards and prompts', [
      feature('fake-ly-card-makeover', 1, { title: 'The runner card makeover', word: 'shipped', project: 'lyphecli', tasks: 10, shippedAt: '2026-10-02T11:30:00Z' }),
      feature('fake-ly-prompts', 2, { title: 'Prompts in the cards', word: 'shipped', project: 'lyphecli', tasks: 14, shippedAt: '2026-10-03T01:28:38Z' }),
    ]),
    epic('fake-ly-tools', 2, 'Workspace tools', [
      feature('fake-ly-drawer', 1, { title: 'The app drawer', word: 'shipped', project: 'lyphecli', tasks: 23, shippedAt: '2026-10-01T22:05:00Z' }),
      feature('fake-ly-notes', 2, { title: 'Simple notes', word: 'shipped', project: 'lyphecli', tasks: 9, shippedAt: '2026-10-02T19:44:12Z' }),
    ]),
  ]),
]);

/**
 * The picture the scaffolds read where the live one will be (`useRoadmap().picture`). `unplaced` holds
 * one epic and two features so the "not on a roadmap yet" banner has something to say.
 */
export const FAKE_PICTURE: RoadmapPicture = {
  generated_at: NOW,
  roadmaps: [RESTORLY, LYPHECLI],
  unplaced: {
    epics: [{ name: 'fake-portal-epic', title: 'A portal for the homeowner' }],
    features: [
      { name: 'fake-near-text', title: 'Text the homeowner when the crew is near', word: 'idea' },
      { name: 'fake-field-dark', title: 'Dark mode for the field app', word: 'proposed' },
    ],
  },
};

/** One moment of each size, as `useCelebrations` will build them: the moisture meter's fifth task, Simple notes shipping, its epic and its milestone. */
export const FAKE_MOMENTS: Record<Moment['level'], Moment> = {
  task: { level: 'task', name: 'fake-moisture-meter', title: 'Moisture readings from the meter', at: NOW },
  feature: { level: 'feature', name: 'fake-ly-notes', title: 'Simple notes', at: '2026-10-02T19:44:12Z' },
  epic: { level: 'epic', name: 'fake-ly-cards', title: 'Runner cards and prompts', at: '2026-10-03T01:28:38Z' },
  milestone: { level: 'milestone', name: 'fake-ly-workspace', title: 'A workspace to live in', at: '2026-10-03T01:28:38Z', summary: 'Plans run themselves was reached too' },
};

/** What is playing in a scaffold that no fixture steers: each of the four moments above, at once. */
export const FAKE_CELEBRATION_ACTIVE: CelebrationActive = {
  tasks: new Set([FAKE_MOMENTS.task.name]),
  features: new Set([FAKE_MOMENTS.feature.name]),
  epics: new Set([FAKE_MOMENTS.epic.name]),
  milestone: FAKE_MOMENTS.milestone.name,
};

/**
 * The celebration context as the scaffolds read it until their fills, whose default is every fake
 * moment playing. A scaffold calls `useContext` on it exactly where its fill will call `useContext` on
 * `CelebrationContext`, so the fill swaps one argument; a fixture provides its own value to start and
 * stop a moment on a row or a card that is already drawn.
 */
export const FAKE_CELEBRATION_CONTEXT = createContext<CelebrationActive>(FAKE_CELEBRATION_ACTIVE);

/** A list that never carries: `useSortable`'s answer with its order as given and no hands on anything. Swapped for `useSortable` by each fill. */
export function fakeSortable(keys: readonly string[]): SortableList {
  return { order: keys, attachList: () => {}, itemProps: () => ({ ref: () => {}, onPointerDown: () => {} }) };
}

/** `useRoadmap()` as the face's scaffolds read it (`useContext`, where the fill calls the hook): Restorly on screen. A fixture provides lyphecli, no roadmap, or no picture yet. */
export const FAKE_ROADMAP_VIEW = createContext<RoadmapView>({ picture: FAKE_PICTURE, roadmaps: FAKE_PICTURE.roadmaps, selected: RESTORLY, select: () => {} });

/** The rail's four sections of `roadmap`, as the plan words `railSections`, each in path order; a blocked row carries its own reason, else its epic's, else its milestone's. */
export function fakeRailSections(roadmap: Roadmap) {
  const placed = roadmap.milestones.flatMap((stop) => stop.epics.flatMap((group) => group.features.map((item) => ({ ...item, blocked: item.blocked ?? group.blocked ?? stop.blocked }))));
  return {
    waiting: placed.filter((item) => item.waiting_on_you !== null),
    inFlight: placed.filter((item) => item.word === 'in flight'),
    next: placed.filter((item) => item.word === 'proposed'),
    blocked: placed.filter((item) => item.blocked !== null && item.word !== 'shipped'),
  };
}
