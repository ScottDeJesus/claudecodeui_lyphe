import type { CelebrationActive, Moment } from '@/modules/roadmap/celebrationContext';
import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';

// What a roadmap's own dates say is worth celebrating: moments READ OFF the picture, never stored. Every
// completion already carries its date in the document (`shipped_at`, `completed_at`, `reached_at`), so a
// second record of announcements would be a stored copy of a derivable fact. Used by
// `hooks/useCelebrations.ts`, which owns the thresholds these functions are handed and the timing of play,
// and by `utils/seenStamp.ts`, which compares stamps with `isLater` and reads them with `seenStampOf`.

/** The words a derived moment says beyond its title: the one line a catch-up adds to the banner. */
export type MomentWords = {
  /** "<count> features shipped while you were away", for the summary that stands in for a run of features. */
  catchUp: (count: number) => string;
  /** "<titles> was reached too", the milestones a long absence reached besides the one that plays. */
  alsoReached: (titles: string[]) => string;
};

/** The order the sizes play in: the smallest first, so each moment leads to a bigger one. */
const LEVEL_RANK: Record<Moment['level'], number> = { task: 0, feature: 1, epic: 2, milestone: 3 };

/** A dispatcher stamp as epoch milliseconds, or `NaN` when it is not one. */
const millisOf = (at: string): number => Date.parse(at);

/** Whether the stamp `at` is later than `than`. A missing or unreadable stamp is never later: it plays nothing. */
export function isLater(at: string | null, than: string): boolean {
  return at !== null && millisOf(at) > millisOf(than);
}

const epicsOf = (roadmap: Roadmap): RoadmapEpic[] => roadmap.milestones.flatMap((milestone) => milestone.epics);

const featuresOf = (roadmap: Roadmap): RoadmapFeature[] => epicsOf(roadmap).flatMap((epic) => epic.features);

const doneTasksOf = (feature: RoadmapFeature) => feature.tasks.filter((task) => task.status === 'done');

/** The newest of some stamps, or `null` when none of them is a date. */
function newestOf(stamps: (string | null)[]): string | null {
  let newest: string | null = null;
  for (const stamp of stamps) {
    if (stamp !== null && !Number.isNaN(millisOf(stamp)) && (newest === null || isLater(stamp, newest))) newest = stamp;
  }
  return newest;
}

/**
 * The key a moment is claimed under, page-wide: its roadmap, its size, its name and its date. Two
 * surfaces that read the same picture derive the same key, so the second to reach a moment finds it
 * claimed and drops it.
 */
export function momentKey(roadmapName: string, moment: Moment): string {
  return `${roadmapName}:${moment.level}:${moment.name}:${moment.at}`;
}

/** Moments in the order they play: by size (task, feature, epic, milestone), then by date, then by name so equal dates stay stable. */
export function sortMoments(moments: Moment[]): Moment[] {
  return [...moments].sort(
    (first, second) =>
      LEVEL_RANK[first.level] - LEVEL_RANK[second.level]
      || (millisOf(first.at) || 0) - (millisOf(second.at) || 0)
      || first.name.localeCompare(second.name),
  );
}

/**
 * The milestone a moment is playing on: the one `active.milestone` names, else the one holding an epic of
 * `active.epics` or a feature of `active.features`; null while nothing of those sizes plays. While it plays,
 * that milestone holds a surface's focus — the face's stage, the widget's line under its rail — because an
 * epic's card and a feature's row play their part only where they are drawn, and a milestone's last feature
 * shipping moves `current` on past it. A TASK moment is left out on purpose: its meter plays wherever its row
 * is drawn, and a task lands every few minutes while a feature walks, so following it would pull the reader
 * off the milestone he pressed and remount what he has open there. Used by `RoadmapPath` and `RoadmapWidgetBody`.
 */
export function playingMilestone(milestones: RoadmapMilestone[], active: CelebrationActive): RoadmapMilestone | null {
  return milestones.find((milestone) => milestone.name === active.milestone)
    ?? milestones.find((milestone) => milestone.epics.some((epic) => active.epics.has(epic.name) || epic.features.some((feature) => active.features.has(feature.name))))
    ?? null;
}

/** The newest completion date the roadmap holds — a `shipped_at`, a `completed_at` or a `reached_at` — or `null` when nothing has completed. */
export function newestCompletion(roadmap: Roadmap): string | null {
  return newestOf([
    ...featuresOf(roadmap).map((feature) => feature.shipped_at),
    ...epicsOf(roadmap).map((epic) => epic.completed_at),
    ...roadmap.milestones.map((milestone) => milestone.reached_at),
  ]);
}

/** This roadmap's entry in the stored `roadmapSeen` document (`{ seen: { name, at }[] }`), read defensively as the unknown it is; `null` when it has none. */
export function seenStampOf(stored: unknown, roadmapName: string): string | null {
  const list = stored !== null && typeof stored === 'object' ? (stored as { seen?: unknown }).seen : undefined;
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (entry !== null && typeof entry === 'object' && (entry as { name?: unknown }).name === roadmapName) {
      const at = (entry as { at?: unknown }).at;
      return typeof at === 'string' && !Number.isNaN(millisOf(at)) ? at : null;
    }
  }
  return null;
}

/**
 * A feature's task moment: its meter grew. A task moment is the FEATURE's (its `name` and `title`), since
 * the meter is the row's, and is dated by its newest done task. A done task with no date stands in its
 * count, so the key still tells this growth from the next.
 */
function taskMoment(feature: RoadmapFeature): Moment {
  const done = doneTasksOf(feature);
  return { level: 'task', name: feature.name, title: feature.title, at: newestOf(done.map((task) => task.done_at)) ?? `${done.length} done` };
}

/** A shipped feature's moment, dated by its `shipped_at` (the dispatcher dates a shipped feature by it, else by its last task). */
function featureMoment(feature: RoadmapFeature): Moment {
  return { level: 'feature', name: feature.name, title: feature.title, at: feature.shipped_at ?? newestOf(doneTasksOf(feature).map((task) => task.done_at)) ?? '' };
}

const epicMoment = (epic: RoadmapEpic): Moment => ({ level: 'epic', name: epic.name, title: epic.title, at: epic.completed_at ?? '' });

const milestoneMoment = (milestone: RoadmapMilestone): Moment => ({ level: 'milestone', name: milestone.name, title: milestone.title, at: milestone.reached_at ?? '' });

/**
 * Feature moments as they play: `summaryMin` or more become ONE, the newest feature's, whose `summary`
 * counts them, so a run of ships is one line rather than a slideshow. Fewer play one by one, in date order.
 */
function summarizeFeatures(featureMoments: Moment[], summaryMin: number, words: MomentWords): Moment[] {
  const sorted = sortMoments(featureMoments);
  return sorted.length >= summaryMin ? [{ ...sorted[sorted.length - 1], summary: words.catchUp(sorted.length) }] : sorted;
}

/**
 * The moments one new picture holds over the one before it (the SAME roadmap): a feature whose done tasks
 * rose while it is in flight (its meter is on screen) gives a task moment; a feature that became `shipped`
 * a feature moment; an epic that became `complete` an epic moment; a milestone that became `reached` a
 * milestone moment. Only an item the earlier picture held can have BECOME anything: one that arrives
 * already finished (an old feature placed under this roadmap) is not news. `featureSummaryMin` or more
 * features shipping in ONE picture (a reconnect's re-seed after a gap) are one summary moment, as in a
 * catch-up. Sorted as they play.
 */
export function liveMoments(before: Roadmap, after: Roadmap, featureSummaryMin: number, words: MomentWords): Moment[] {
  const features = new Map(featuresOf(before).map((feature) => [feature.name, feature]));
  const epics = new Map(epicsOf(before).map((epic) => [epic.name, epic]));
  const milestones = new Map(before.milestones.map((milestone) => [milestone.name, milestone]));
  const moments: Moment[] = [];
  const shipped: Moment[] = [];

  for (const feature of featuresOf(after)) {
    const earlier = features.get(feature.name);
    if (!earlier) continue;
    if (feature.word === 'shipped' && earlier.word !== 'shipped') shipped.push(featureMoment(feature));
    else if (feature.word === 'in flight' && doneTasksOf(feature).length > doneTasksOf(earlier).length) moments.push(taskMoment(feature));
  }
  for (const epic of epicsOf(after)) {
    const earlier = epics.get(epic.name);
    if (earlier && earlier.word !== 'complete' && epic.word === 'complete') moments.push(epicMoment(epic));
  }
  for (const milestone of after.milestones) {
    const earlier = milestones.get(milestone.name);
    if (earlier && earlier.word !== 'reached' && milestone.word === 'reached') moments.push(milestoneMoment(milestone));
  }
  return sortMoments([...moments, ...summarizeFeatures(shipped, featureSummaryMin, words)]);
}

/**
 * The moments a roadmap holds since `stamp`, the last completion this user saw play: every feature
 * `shipped_at`, epic `completed_at` and milestone `reached_at` later than it. A task is never one: a
 * night's walk would bury the one moment that matters. `featureSummaryMin` or more features become ONE
 * feature moment, the newest feature's, whose `summary` counts them; two or more milestones play the
 * newest, the others named in its `summary`. Sorted as they play.
 */
export function catchUpMoments(roadmap: Roadmap, stamp: string, featureSummaryMin: number, words: MomentWords): Moment[] {
  const featureMoments = summarizeFeatures(featuresOf(roadmap).filter((feature) => isLater(feature.shipped_at, stamp)).map(featureMoment), featureSummaryMin, words);
  const epics = epicsOf(roadmap).filter((epic) => isLater(epic.completed_at, stamp)).map(epicMoment);
  const reached = sortMoments(roadmap.milestones.filter((milestone) => isLater(milestone.reached_at, stamp)).map(milestoneMoment));

  const newestMilestone = reached[reached.length - 1];
  const milestoneMoments = reached.length >= 2
    ? [{ ...newestMilestone, summary: words.alsoReached(reached.slice(0, -1).map((moment) => moment.title)) }]
    : reached;
  return sortMoments([...featureMoments, ...epics, ...milestoneMoments]);
}
