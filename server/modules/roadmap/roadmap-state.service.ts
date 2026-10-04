import { readDispatcherJson, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';
import { each, field, isCount, isFlag, isRecord, isText, isTextOrNull, need, oneOf } from '@/shared/document-fields.js';
import type {
  Roadmap,
  RoadmapCases,
  RoadmapEpic,
  RoadmapEpicWord,
  RoadmapFeature,
  RoadmapFeatureStep,
  RoadmapFeatureWord,
  RoadmapMilestone,
  RoadmapMilestoneWord,
  RoadmapPicture,
  RoadmapTask,
  RoadmapWord,
} from '@/shared/roadmap-types.js';

/**
 * The roadmap lane's side of reading `dispatcher roadmap show --json`: run it, then read the body
 * FIELD BY FIELD into the contract (`@/shared/roadmap-types.ts`), refusing any field by its path.
 *
 * Nothing here decides what a word means. Every `word`, `step` and `waiting_on_you` is the dispatcher's
 * own, read against the closed vocabulary the contract states (`oneOf`), and a counter, a name or a
 * time is read as the kind of value it is and handed on as it came. That is the dispatcher lane's rule
 * too (`dispatcher-state.service.ts`): a body that does not read is ANOTHER BUILD of the dispatcher and
 * not a torn file, so it is refused whole with the field's path in the sentence — `roadmaps[1].
 * milestones[0].epics[2].features[4].word` — and the lane keeps the last good picture on the screen
 * with one line in the journal. Nothing is coerced to a default: an empty roadmap drawn for a field this
 * build could not read would be indistinguishable from a real empty one.
 *
 * Keys the contract does not name are dropped, so a field the dispatcher adds later reaches the screen
 * only when the contract and this reader are edited together. A VALUE it does not name is refused: the
 * dispatcher reads a store state it has no step for as `designing` with the state as its step
 * (`report_roadmap.py::feature_word`), which is outside the contract's thirteen, and that one feature
 * would refuse the whole picture until the contract learns the step.
 *
 * ONE absence is tolerated, and it is `cases`: a feature, an epic's standing or a roadmap's standing
 * with no `cases` key reads as six zeros (`readCases`). CloudCLI and the dispatcher deploy apart, so a
 * CloudCLI that ships ahead of its dispatcher meets a picture from a build that has no cases at all,
 * and refusing it would blank the whole Roadmap tab for a field whose true value in that build IS
 * zero. The tolerance is the KEY's absence alone: a `cases` that is present and unreadable (a null, a
 * string, a count that is not a whole number) is refused by its path like any other field.
 */

/** The document's name in every refusal and every failure of the command that prints it. */
const DOCUMENT = 'dispatcher roadmap show --json';

/**
 * How much the document may weigh. A goal is free text and the document carries every one whole, so
 * the picture grows with the operator's own words — 190 KB for two roadmaps of fifty-one features
 * when measured — and a megabyte is five times that. Stated rather than left to `execFile`'s default,
 * for the reason `STATUS_MAX_BUFFER` is (`dispatcher-state.transport.ts`): a document past it reaches
 * the journal as `did not answer:` and the document's own opening, and a line that quotes the
 * document is this number too low. That opening begins with the dispatcher's clock, so each tick's
 * line differs and the once-per-message journal bound does not hold for it.
 */
const ROADMAP_MAX_BUFFER = 1024 * 1024;

const FEATURE_WORDS: readonly RoadmapFeatureWord[] = ['idea', 'proposed', 'designing', 'in flight', 'shipped'];
const FEATURE_STEPS: readonly RoadmapFeatureStep[] = [
  'idea', 'proposed', 'designing', 'questions', 'cutting', 'accept', 'parked', 'building', 'waiting', 'queued',
  'paused', 'starting', 'shipped',
];
const WAITING_ON_YOU: readonly NonNullable<RoadmapFeature['waiting_on_you']>[] = ['questions', 'accept'];
const TASK_STATUSES: readonly RoadmapTask['status'][] = ['not started', 'running', 'done'];
const EPIC_WORDS: readonly RoadmapEpicWord[] = ['empty', 'not started', 'in progress', 'complete'];
const MILESTONE_WORDS: readonly RoadmapMilestoneWord[] = ['empty', 'not started', 'in progress', 'reached'];
const ROADMAP_WORDS: readonly RoadmapWord[] = ['no path yet', 'on the way', 'every milestone reached'];

/** A non-negative integer: how many of something there are. */
const isWholeCount = (value: unknown): value is number => isCount(value) && Number.isInteger(value) && value >= 0;

/**
 * One object of the document, read by key. Every method names the field it refused by the object's
 * own path plus the key, so no reader below spells a path by hand and none can mis-spell one. The
 * document itself is the one object with no path (`at` is empty), so its keys stand bare.
 */
function row(raw: unknown, at: string) {
  const where = (key: string): string => (at === '' ? key : `${at}.${key}`);
  return {
    /** The object this row reads and its path, for a reader that takes a whole object (`readCases`). */
    raw,
    at,
    text: (key: string): string => need(field(raw, key), isText, where(key), DOCUMENT),
    textOrNull: (key: string): string | null => need(field(raw, key), isTextOrNull, where(key), DOCUMENT),
    count: (key: string): number => need(field(raw, key), isCount, where(key), DOCUMENT),
    /** A tally: `count` is any finite number, and a tally of cases is never negative or fractional. */
    whole: (key: string): number => need(field(raw, key), isWholeCount, where(key), DOCUMENT),
    flag: (key: string): boolean => need(field(raw, key), isFlag, where(key), DOCUMENT),
    word: <T extends string>(key: string, words: readonly T[]): T => oneOf(field(raw, key), words, where(key), DOCUMENT),
    wordOrNull: <T extends string>(key: string, words: readonly T[]): T | null =>
      field(raw, key) === null ? null : oneOf(field(raw, key), words, where(key), DOCUMENT),
    /** A nested object, itself read by key under its own path. */
    object: (key: string) => row(need(field(raw, key), isRecord, where(key), DOCUMENT), where(key)),
    /** A list whose every entry is read by `read`, handed the entry's own path (`features[3]`). */
    list: <T>(key: string, read: (entry: unknown, entryAt: string) => T): T[] => {
      let index = 0;
      return each(field(raw, key), where(key), (entry) => read(entry, `${where(key)}[${index++}]`), DOCUMENT);
    },
  };
}

function readTask(raw: unknown, at: string): RoadmapTask {
  const task = row(raw, at);
  return {
    key: task.text('key'),
    title: task.text('title'),
    status: task.word('status', TASK_STATUSES),
    done_at: task.textOrNull('done_at'),
  };
}

/**
 * The `cases` standing of the object that holds the key — a feature, or an epic's or a roadmap's
 * `standing`. An ABSENT key is six zeros (see the head of this file); a present key is read whole.
 */
function readCases(raw: unknown, at: string): RoadmapCases {
  if (field(raw, 'cases') === undefined) {
    return { total: 0, holding: 0, broken: 0, regressed: 0, not_run: 0, cant_run: 0 };
  }
  const cases = row(raw, at).object('cases');
  return {
    total: cases.whole('total'),
    holding: cases.whole('holding'),
    broken: cases.whole('broken'),
    regressed: cases.whole('regressed'),
    not_run: cases.whole('not_run'),
    cant_run: cases.whole('cant_run'),
  };
}

function readFeature(raw: unknown, at: string): RoadmapFeature {
  const feature = row(raw, at);
  return {
    name: feature.text('name'),
    title: feature.text('title'),
    goal: feature.textOrNull('goal'),
    project: feature.textOrNull('project'),
    repo: feature.text('repo'),
    position: feature.count('position'),
    blocked: feature.textOrNull('blocked'),
    word: feature.word('word', FEATURE_WORDS),
    step: feature.word('step', FEATURE_STEPS),
    waiting_on_you: feature.wordOrNull('waiting_on_you', WAITING_ON_YOU),
    waits_on: feature.list('waits_on', (entry, entryAt) => need(entry, isText, entryAt, DOCUMENT)),
    tasks: feature.list('tasks', readTask),
    created_at: feature.text('created_at'),
    promoted_at: feature.textOrNull('promoted_at'),
    approved_at: feature.textOrNull('approved_at'),
    shipped_at: feature.textOrNull('shipped_at'),
    cases: readCases(raw, at),
  };
}

function readEpic(raw: unknown, at: string): RoadmapEpic {
  const epic = row(raw, at);
  const standing = epic.object('standing');
  return {
    name: epic.text('name'),
    title: epic.text('title'),
    goal: epic.textOrNull('goal'),
    position: epic.count('position'),
    created_at: epic.text('created_at'),
    blocked: epic.textOrNull('blocked'),
    designed_whole: epic.flag('designed_whole'),
    word: epic.word('word', EPIC_WORDS),
    completed_at: epic.textOrNull('completed_at'),
    standing: {
      features: standing.count('features'),
      shipped: standing.count('shipped'),
      in_flight: standing.count('in_flight'),
      designing: standing.count('designing'),
      proposed: standing.count('proposed'),
      ideas: standing.count('ideas'),
      cases: readCases(standing.raw, standing.at),
    },
    features: epic.list('features', readFeature),
  };
}

function readMilestone(raw: unknown, at: string): RoadmapMilestone {
  const milestone = row(raw, at);
  const standing = milestone.object('standing');
  return {
    name: milestone.text('name'),
    title: milestone.text('title'),
    goal: milestone.textOrNull('goal'),
    position: milestone.count('position'),
    created_at: milestone.text('created_at'),
    blocked: milestone.textOrNull('blocked'),
    word: milestone.word('word', MILESTONE_WORDS),
    reached_at: milestone.textOrNull('reached_at'),
    standing: {
      epics: standing.count('epics'),
      complete: standing.count('complete'),
      features: standing.count('features'),
      shipped: standing.count('shipped'),
    },
    epics: milestone.list('epics', readEpic),
  };
}

function readRoadmap(raw: unknown, at: string): Roadmap {
  const roadmap = row(raw, at);
  const standing = roadmap.object('standing');
  return {
    name: roadmap.text('name'),
    title: roadmap.text('title'),
    goal: roadmap.textOrNull('goal'),
    position: roadmap.count('position'),
    created_at: roadmap.text('created_at'),
    word: roadmap.word('word', ROADMAP_WORDS),
    current: roadmap.textOrNull('current'),
    standing: {
      milestones: standing.count('milestones'),
      reached: standing.count('reached'),
      epics: standing.count('epics'),
      complete: standing.count('complete'),
      features: standing.count('features'),
      shipped: standing.count('shipped'),
      in_flight: standing.count('in_flight'),
      designing: standing.count('designing'),
      proposed: standing.count('proposed'),
      ideas: standing.count('ideas'),
      blocked: standing.count('blocked'),
      waiting_on_you: standing.count('waiting_on_you'),
      cases: readCases(standing.raw, standing.at),
    },
    milestones: roadmap.list('milestones', readMilestone),
  };
}

/** The body of `roadmap show --json` as the contract's picture, or a refusal naming the field it could not read. */
function readPicture(body: unknown): RoadmapPicture {
  const document = row(body, '');
  const unplaced = document.object('unplaced');
  return {
    generated_at: document.text('generated_at'),
    roadmaps: document.list('roadmaps', readRoadmap),
    unplaced: {
      epics: unplaced.list('epics', (entry, at) => {
        const epic = row(entry, at);
        return { name: epic.text('name'), title: epic.text('title') };
      }),
      features: unplaced.list('features', (entry, at) => {
        const feature = row(entry, at);
        return { name: feature.text('name'), title: feature.text('title'), word: feature.word('word', FEATURE_WORDS) };
      }),
    },
  };
}

/**
 * One `dispatcher roadmap show --json`, read into the picture. Never resolves on a body it cannot read:
 * the command's own failure and a field this build refuses both reject, and the lane's contract is to
 * keep the last good picture (`@/shared/polled-lane.service.ts`). `dependencies` come from the module
 * root — the one place that reads the environment.
 */
export async function readRoadmapState(dependencies: DispatcherCommandDependencies): Promise<RoadmapPicture> {
  return readPicture(await readDispatcherJson(['roadmap', 'show', '--json'], dependencies, ROADMAP_MAX_BUFFER));
}
