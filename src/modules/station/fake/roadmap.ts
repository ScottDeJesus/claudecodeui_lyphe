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
} from '@/shared/roadmap-types';

/*
 * THE ROADMAP'S FIXTURE DATA, for the left rail's pictures (`fake/sessions.ts`) only: the roadmap `lyphecli` as
 * `dispatcher roadmap show --json` printed it on 2026-10-30 (a pure read), every milestone, epic and feature in its own
 * order with its own steps, dates, waits and runtimes. Shaped as the wire holds it (`@/shared/roadmap-types`), with what the
 * rail never draws left empty: no goal but the roadmap's, no task, no case, nothing blocked. Nothing in the app imports
 * this file.
 *
 * Its three open epics are the real ones: `usage-limits`, `kaylee` and `kaylee-station`. A picture may stand some features at
 * other steps (`lyphecliRoadmap({ name: step })`) and add the epic `DESK_EPIC` (`lyphecliRoadmap({}, { desk: true })`): the
 * `waiting` picture's two Accepts, the feature's and the epic's, which the roadmap words as the dispatcher does. Its derivation
 * has an epic's Accept over its features, each cut and not yet approved, so each stands at the step `accept` and none of the
 * epic's own rows says it: the epic is "waiting on you" through its three features.
 */

const REPO = '/home/lyphe/.claude/claudecodeui_lyphe';

/**
 * The epic whose Accept the `waiting` picture holds beside the feature's, as `fake/needs.ts` names it (its `card`, its title and
 * how many features it holds): three features, each cut and owing the epic's one lock. The roadmap draws it in that picture
 * only, under the companion milestone; every other picture's roadmap is the real one.
 */
export const DESK_EPIC = {
  name: 'kaylee-desk',
  title: 'Kaylee’s desk',
  features: [
    { name: 'kaylee-desk--notes', title: 'The notes she keeps for him' },
    { name: 'kaylee-desk--pins', title: 'The cards he pins' },
    { name: 'kaylee-desk--clock', title: 'The clock she tells the time by' },
  ],
} as const;
const NO_CASES: RoadmapCases = { total: 0, holding: 0, broken: 0, regressed: 0, not_run: 0, cant_run: 0 };

/** The word each step stands under, as the dispatcher derives it (`RoadmapFeatureStep`'s own grouping). */
const WORD_OF_STEP: Record<RoadmapFeatureStep, RoadmapFeatureWord> = {
  idea: 'idea', proposed: 'proposed', shipped: 'shipped',
  designing: 'designing', questions: 'designing', cutting: 'designing', accept: 'designing', parked: 'designing',
  building: 'in flight', waiting: 'in flight', queued: 'in flight', paused: 'in flight', stalled: 'in flight', starting: 'in flight',
};

/** One feature at `step`: its word the step's, and what it owes him an Accept's or a round's when the step is one. */
function featureAt(
  position: number, name: string, title: string, project: string, step: RoadmapFeatureStep,
  createdAt: string, shippedAt: string | null, runtimeS: number, waitsOn: string[],
): RoadmapFeature {
  return {
    name, title, goal: null, project, repo: REPO, position, blocked: null, word: WORD_OF_STEP[step], step,
    waiting_on_you: step === 'accept' ? 'accept' : step === 'questions' ? 'questions' : null, waits_on: waitsOn, tasks: [],
    created_at: createdAt, promoted_at: null, approved_at: null, shipped_at: shippedAt, runtime_s: runtimeS, cases: NO_CASES,
  };
}

/** How many of `features` stand at each word: an epic's standing, as the dispatcher counts it. */
function countOf(features: RoadmapFeature[]) {
  const at = (word: RoadmapFeatureWord) => features.filter((feature) => feature.word === word).length;
  return { features: features.length, shipped: at('shipped'), in_flight: at('in flight'), designing: at('designing'), proposed: at('proposed'), ideas: at('idea') };
}

/** One epic, its standing counted from its features. */
function epic(
  position: number, name: string, title: string, word: RoadmapEpicWord, createdAt: string, completedAt: string | null,
  runtimeS: number, features: RoadmapFeature[],
): RoadmapEpic {
  return {
    name, title, goal: null, position, created_at: createdAt, blocked: null, designed_whole: false, word, completed_at: completedAt,
    runtime_s: runtimeS, standing: { ...countOf(features), cases: NO_CASES }, features,
  };
}

/** One milestone, its standing counted from its epics. */
function milestone(
  position: number, name: string, title: string, word: RoadmapMilestoneWord, createdAt: string, reachedAt: string | null,
  epics: RoadmapEpic[],
): RoadmapMilestone {
  const features = epics.flatMap((item) => item.features);
  return {
    name, title, goal: null, position, created_at: createdAt, blocked: null, word, reached_at: reachedAt,
    standing: { epics: epics.length, complete: epics.filter((item) => item.word === 'complete').length, features: features.length, shipped: countOf(features).shipped },
    epics,
  };
}

/**
 * The roadmap `lyphecli`, each feature at its own step but the ones `steps` names, which stand at the step it gives; with the
 * epic `DESK_EPIC` after `kaylee-station` when `desk` is set.
 */
export function lyphecliRoadmap(steps: Readonly<Record<string, RoadmapFeatureStep>> = {}, { desk = false }: { desk?: boolean } = {}): Roadmap {
  const feature = (
    position: number, name: string, title: string, project: string, step: RoadmapFeatureStep, createdAt: string,
    shippedAt: string | null, runtimeS: number, waitsOn: string[] = [],
  ) => featureAt(position, name, title, project, steps[name] ?? step, createdAt, shippedAt, runtimeS, waitsOn);

  const milestones = [
    milestone(1, 'lyphecli-runner', 'Plans run themselves', 'in progress', '2026-10-03T23:46:14Z', null, [
      epic(1, 'runner-engine', 'The runner', 'complete', '2026-10-03T23:46:16Z', '2026-10-15T10:00:50Z', 123241, [
        feature(1, 'dispatcher-ready', 'The dispatcher, ready to use', 'house', 'shipped', '2026-09-24T16:13:59Z', '2026-09-24T23:47:24Z', 23439),
        feature(2, 'dispatcher-refit', 'Reviewers that fit the work', 'house', 'shipped', '2026-09-25T04:51:40Z', '2026-09-25T12:25:31Z', 8723),
        feature(3, 'athena-scenarios', 'Test scenarios before the code', 'house', 'shipped', '2026-09-25T16:20:31Z', '2026-09-25T18:38:42Z', 8053),
        feature(4, 'dispatcher-planners', 'Planners on their own', 'house', 'shipped', '2026-09-26T01:12:05Z', '2026-09-26T06:23:52Z', 13091),
        feature(5, 'one-path', 'One planning path', 'house', 'shipped', '2026-09-26T03:02:54Z', '2026-09-26T10:14:44Z', 13843, ['dispatcher-planners']),
        feature(6, 'dactyls', 'Dactyls: Haiku hands for the builders, behind a switch', 'house', 'shipped', '2026-10-08T05:16:29Z', '2026-10-08T17:37:43Z', 20772),
        feature(7, 'main-session-dactyls', 'Dactyls for the main session', 'house', 'shipped', '2026-10-10T16:36:32Z', '2026-10-10T23:01:25Z', 19227),
        feature(8, 'epic-queue', 'A queue for epics: one runs at a time', 'house', 'shipped', '2026-10-15T05:16:29Z', '2026-10-15T10:00:50Z', 16093),
      ]),
      epic(2, 'docstore', 'The docstore', 'complete', '2026-10-03T23:46:16Z', '2026-09-27T13:57:24Z', 41245, [
        feature(1, 'docstore-fixes', 'Docstore fixes', 'house', 'shipped', '2026-09-26T00:26:38Z', '2026-09-26T05:23:17Z', 7831),
        feature(2, 'docstore-improvements', 'Docstore improvements', 'house', 'shipped', '2026-09-26T18:31:21Z', '2026-09-27T13:57:24Z', 33414),
      ]),
      epic(3, 'claude-api-credit', 'Plan runs on Claude API credit', 'complete', '2026-10-17T18:46:28Z', '2026-10-20T21:13:53Z', 18097, [
        feature(1, 'claude-api-backup', 'A backup Claude API for plan runs, on two accounts\' API keys', 'house', 'shipped', '2026-10-17T18:46:32Z', '2026-10-20T21:13:53Z', 18097, ['usage-pacer']),
      ]),
      epic(4, 'usage-limits', 'Plan runs stay inside the usage limits', 'in progress', '2026-10-18T17:31:22Z', null, 206042, [
        feature(1, 'usage-pacer', 'Features, epics and tasks paced to the 5-hour and weekly usage', 'house', 'shipped', '2026-10-18T17:31:26Z', '2026-10-20T18:34:06Z', 159941),
        feature(2, 'usage-limits--key-carry', 'When the window is full, walking work moves onto API key 1, then key 2', 'house', 'idea', '2026-10-18T23:32:01Z', null, 0),
        feature(3, 'usage-limits--account-switch', 'Account switching with no browser sign-in: one click, or automatic when an account fills', 'house', 'shipped', '2026-10-21T19:35:59Z', '2026-10-22T06:25:24Z', 26900),
        feature(4, 'gemini-budget', 'Each plan stays inside its Gemini budget', 'house', 'shipped', '2026-10-22T21:24:59Z', '2026-10-23T12:58:52Z', 19201),
      ]),
    ]),
    milestone(2, 'lyphecli-workspace', 'A workspace to live in', 'reached', '2026-10-03T23:46:15Z', '2026-10-26T02:07:30Z', [
      epic(1, 'runner-cards', 'Runner cards and prompts', 'complete', '2026-10-03T23:46:16Z', '2026-10-03T01:28:38Z', 70791, [
        feature(1, 'runner-card-makeover', 'The card makeover', 'lyphecli', 'shipped', '2026-09-26T17:51:02Z', '2026-09-27T05:07:06Z', 32831),
        feature(2, 'prompts-in-cards', 'Prompts on the cards', 'lyphecli', 'shipped', '2026-09-30T19:09:51Z', '2026-10-01T02:01:48Z', 23124),
        feature(3, 'vocab-epics-features', 'Epics, features and tasks', 'lyphecli', 'shipped', '2026-10-02T20:21:47Z', '2026-10-03T01:28:38Z', 14836),
      ]),
      epic(2, 'agent-settings', 'Agents and updates', 'complete', '2026-10-03T23:46:16Z', '2026-10-10T00:33:26Z', 80786, [
        feature(1, 'claude-update-pipeline', 'Claude updates from Settings', 'lyphecli', 'shipped', '2026-09-28T20:02:54Z', '2026-09-29T05:06:00Z', 17651),
        feature(2, 'agent-launch-config', 'The Agents tab', 'lyphecli', 'shipped', '2026-09-28T17:15:21Z', '2026-09-29T07:30:02Z', 13871),
        feature(3, 'custom-compaction', 'Custom compaction: a pinned summarizer behind a switch', 'lyphecli', 'shipped', '2026-10-08T13:33:16Z', '2026-10-08T22:59:14Z', 32999),
        feature(4, 'compaction-handover', 'Compaction handover: lossless seed, no extra turn', 'lyphecli', 'shipped', '2026-10-09T16:12:55Z', '2026-10-10T00:33:26Z', 18975),
      ]),
      epic(3, 'workspace-tools', 'Workspace tools', 'complete', '2026-10-03T23:46:17Z', '2026-09-30T22:35:38Z', 73754, [
        feature(1, 'app-drawer-chat', 'Chat beside any app', 'lyphecli', 'shipped', '2026-09-29T18:47:48Z', '2026-09-30T12:46:33Z', 50054),
        feature(2, 'simple-notes', 'Notes', 'lyphecli', 'shipped', '2026-09-30T14:39:58Z', '2026-09-30T21:30:39Z', 16697),
        feature(3, 'simple-chat-folders', 'Chat folders', 'lyphecli', 'shipped', '2026-09-30T14:36:20Z', '2026-09-30T22:35:38Z', 21462),
      ]),
      epic(4, 'workspace-nav', 'The workspace\'s navigation', 'complete', '2026-10-25T14:02:15Z', '2026-10-26T02:07:30Z', 37345, [
        feature(1, 'sidebar-rail', 'One rail for every view', 'lyphecli', 'shipped', '2026-10-25T14:02:15Z', '2026-10-26T02:07:30Z', 37345),
      ]),
    ]),
    milestone(3, 'lyphecli-command-center', 'The command center', 'reached', '2026-10-03T23:46:15Z', '2026-10-07T21:36:18Z', [
      epic(1, 'cerberus', 'Cerberus', 'complete', '2026-10-03T14:50:44Z', '2026-10-07T21:36:18Z', 156039, [
        feature(1, 'cerberus--center', 'The Cerberus center', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-06T18:37:11Z', 53366),
        feature(2, 'cerberus--warden', 'The warden', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-06T22:23:04Z', 13464, ['cerberus--center']),
        feature(3, 'cerberus--tab', 'The Cerberus tab', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-07T03:53:29Z', 33322, ['cerberus--center']),
        feature(4, 'cerberus--fixes', 'Fixes from a catalog', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-07T09:38:34Z', 20574, ['cerberus--tab', 'cerberus--warden']),
        feature(5, 'cerberus--sessions', 'Sessions on a node', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-07T08:31:24Z', 16664, ['cerberus--tab', 'cerberus--warden']),
        feature(6, 'cerberus--updates', 'Wardens that update themselves', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-07T14:07:51Z', 16065, ['cerberus--fixes']),
        feature(7, 'cerberus--diagnosis', 'Read-only diagnosis', 'lyphecli', 'shipped', '2026-10-03T14:50:44Z', '2026-10-07T15:04:53Z', 19518, ['cerberus--fixes']),
        feature(8, 'cerberus--judgment', 'Judgment of Cerberus', 'lyphecli', 'shipped', '2026-10-07T15:04:53Z', '2026-10-07T21:36:18Z', 20958),
      ]),
      epic(2, 'roadmap', 'The roadmap', 'complete', '2026-10-03T20:00:35Z', '2026-10-04T18:50:05Z', 83430, [
        feature(1, 'roadmap--store', 'The roadmap in the store', 'house', 'shipped', '2026-10-03T20:00:35Z', '2026-10-03T23:45:20Z', 9717),
        feature(2, 'roadmap--history', 'The shipped work, placed', 'house', 'shipped', '2026-10-03T20:00:35Z', '2026-10-03T23:56:51Z', 691, ['roadmap--store']),
        feature(3, 'roadmap--rules', 'Every new feature starts on the roadmap', 'house', 'shipped', '2026-10-03T20:00:35Z', '2026-10-04T01:26:00Z', 5321, ['roadmap--history', 'roadmap--store']),
        feature(4, 'roadmap--mirror', 'The roadmap in DocSpace', 'house', 'shipped', '2026-10-03T20:00:35Z', '2026-10-04T00:52:16Z', 3991, ['roadmap--store']),
        feature(5, 'roadmap--lane', 'The roadmap\'s live feed', 'lyphecli', 'shipped', '2026-10-03T20:00:35Z', '2026-10-04T02:20:10Z', 9238, ['roadmap--store']),
        feature(6, 'roadmap--screen', 'The Roadmap tab', 'lyphecli', 'shipped', '2026-10-03T20:00:35Z', '2026-10-04T12:26:00Z', 36230, ['roadmap--lane']),
        feature(7, 'roadmap--widget', 'The roadmap widget', 'lyphecli', 'shipped', '2026-10-03T20:00:35Z', '2026-10-04T16:24:23Z', 14219, ['roadmap--screen']),
        feature(8, 'roadmap--judgment', 'Judgment of The roadmap', 'house', 'shipped', '2026-10-04T16:24:23Z', '2026-10-04T18:50:05Z', 7576),
      ]),
      epic(3, 'docspace-live', 'DocSpace live data and a richer canvas', 'complete', '2026-10-04T14:40:20Z', '2026-10-05T21:47:50Z', 111263, [
        feature(1, 'docspace-live--sources', 'Live sources: DocSpace reads the dispatcher, cases, Cerberus and any address, stream, file or command', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-04T22:06:25Z', 20712),
        feature(2, 'docspace-live--tree', 'Databases that nest, roll up from the rows beneath and work as a board', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T01:35:59Z', 22789),
        feature(3, 'docspace-live--bind', 'Canvas cards, live tiles and any text bound to a source', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T07:17:37Z', 33035, ['docspace-live--sources']),
        feature(4, 'docspace-live--feed', 'Databases fed by a source, with presses that reach it', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T06:42:10Z', 18344, ['docspace-live--sources', 'docspace-live--tree']),
        feature(5, 'docspace-live--motion', 'A canvas that moves with its data: pulses, flowing wires, focus and history', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T12:51:21Z', 19999, ['docspace-live--bind']),
        feature(6, 'docspace-live--compose', 'Canvases that compose themselves from rows', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T14:22:23Z', 25457, ['docspace-live--bind', 'docspace-live--feed', 'docspace-live--tree']),
        feature(7, 'docspace-live--roadmap', 'The roadmap page, live from the dispatcher', 'ArchPulse', 'shipped', '2026-10-04T15:10:45Z', '2026-10-05T16:22:48Z', 7197, ['docspace-live--bind', 'docspace-live--compose', 'docspace-live--feed']),
        feature(8, 'docspace-live--judgment', 'Judgment of DocSpace live data and a richer canvas', 'ArchPulse', 'shipped', '2026-10-05T16:22:48Z', '2026-10-05T21:47:50Z', 17174),
      ]),
      epic(4, 'roadmap-tree', 'The roadmap drawn as a tree', 'complete', '2026-10-06T17:45:22Z', '2026-10-07T01:14:44Z', 26154, [
        feature(1, 'roadmap-tree-view', 'The tree view: goal, milestones, epic rings, feature dots, and a details panel below', 'lyphecli', 'shipped', '2026-10-06T17:45:22Z', '2026-10-07T01:14:44Z', 26154),
      ]),
    ]),
    milestone(4, 'lyphecli-survives', 'The box can die and come back', 'reached', '2026-10-07T23:56:34Z', '2026-10-08T10:59:44Z', [
      epic(1, 'estate-backup', 'Encrypted cloud backup and restore', 'complete', '2026-10-07T23:56:34Z', '2026-10-08T10:59:44Z', 35761, [
        feature(1, 'eis1-cloud-backup', 'Nightly encrypted backup to Google Drive', 'house', 'shipped', '2026-10-07T23:56:34Z', '2026-10-08T10:59:44Z', 35761),
      ]),
    ]),
    milestone(5, 'token-savings', 'Token Savings', 'reached', '2026-10-15T21:40:29Z', '2026-10-16T16:56:28Z', [
      epic(1, 'mcp-toolsets', 'On-demand MCP tool sets', 'complete', '2026-10-15T21:40:29Z', '2026-10-16T16:56:28Z', 18189, [
        feature(1, 'toolset-skeleton', 'The tool-set skeleton: named sets per box, a per-session switch, live activation, the registry empty', 'lyphecli', 'shipped', '2026-10-15T21:40:29Z', '2026-10-16T16:56:28Z', 18189),
      ]),
    ]),
    milestone(6, 'lyphecli-companion', 'A companion to talk to', 'in progress', '2026-10-26T19:57:18Z', null, [
      epic(1, 'kaylee', 'Kaylee, the voice companion', 'in progress', '2026-10-26T19:57:18Z', null, 179774, [
        feature(1, 'kaylee--companion', 'Kaylee, typed to from her panel: her tools, her register, her alerts', 'lyphecli', 'shipped', '2026-10-26T20:33:49Z', '2026-10-27T16:16:27Z', 33039),
        feature(2, 'kaylee--names', 'Chats get names that can be said aloud', 'lyphecli', 'shipped', '2026-10-26T20:33:49Z', '2026-10-27T13:10:55Z', 8757),
        feature(3, 'kaylee--tts-prices', 'Gemini\'s speech models priced in the Gemini budget', 'shadow-connector', 'shipped', '2026-10-26T20:33:49Z', '2026-10-27T11:10:41Z', 638),
        feature(4, 'kaylee--talk', 'Tap to talk: Gemini hears him', 'lyphecli', 'shipped', '2026-10-26T20:33:49Z', '2026-10-27T20:36:40Z', 15390, ['kaylee--companion']),
        feature(5, 'kaylee--voice', 'Kaylee speaks: Gemini speech with her moods and sounds', 'lyphecli', 'shipped', '2026-10-26T20:33:49Z', '2026-10-27T23:50:01Z', 11353, ['kaylee--talk', 'kaylee--tts-prices']),
        feature(6, 'kaylee--avatar', 'Kaylee\'s floating button: an animated avatar that moves to what she is looking at', 'lyphecli', 'shipped', '2026-10-26T20:33:49Z', '2026-10-28T06:22:14Z', 19718, ['kaylee--voice']),
        feature(7, 'kaylee--face', 'Kaylee\'s face', 'lyphecli', 'shipped', '2026-10-28T13:33:15Z', '2026-10-30T09:27:13Z', 32509),
        feature(8, 'kaylee--exact-mouth', 'Kaylee\'s exact mouth', 'lyphecli', 'idea', '2026-10-28T14:23:00Z', null, 0),
        feature(9, 'kaylee--eyes', 'Kaylee\'s eyes', 'lyphecli', 'shipped', '2026-10-28T16:26:59Z', '2026-10-29T02:40:56Z', 26556),
        feature(10, 'kaylee--memory', 'Kaylee\'s memory', 'lyphecli', 'shipped', '2026-10-28T18:03:52Z', '2026-10-29T09:08:09Z', 12840),
        feature(11, 'kaylee--before-compaction', 'Kaylee\'s moment before compaction', 'lyphecli', 'idea', '2026-10-29T16:21:23Z', null, 0),
        feature(12, 'kaylee--press', 'Kaylee carries his word', 'house', 'shipped', '2026-10-28T16:34:58Z', '2026-10-29T04:26:33Z', 7409),
        feature(13, 'kaylee--judgment', 'Judgment of Kaylee, the voice companion', 'lyphecli', 'shipped', '2026-10-28T06:22:14Z', '2026-10-28T09:30:24Z', 10152),
      ]),
      epic(2, 'kaylee-station', 'Kaylee Station', 'in progress', '2026-10-30T01:46:53Z', null, 26559, [
        feature(1, 'kaylee-station--shell', 'The station\'s shell and layout', 'lyphecli', 'shipped', '2026-10-30T01:46:54Z', '2026-10-30T09:37:03Z', 18198),
        feature(2, 'kaylee-station--center', 'Kaylee at the center: her face and the live conversation', 'lyphecli', 'building', '2026-10-30T01:46:54Z', null, 403, ['kaylee-station--shell']),
        feature(3, 'kaylee-station--where-things-stand', 'Where things stand: the left rail', 'lyphecli', 'building', '2026-10-30T01:46:54Z', null, 457, ['kaylee-station--shell']),
        feature(4, 'kaylee-station--what-needs-you', 'What needs you: the right rail and the waiting-on-you state', 'lyphecli', 'building', '2026-10-30T01:46:54Z', null, 527, ['kaylee-station--shell']),
        feature(5, 'kaylee-station--cards', 'Her cards and the walkthrough', 'lyphecli', 'building', '2026-10-30T01:46:54Z', null, 604, ['kaylee-station--shell']),
        feature(6, 'kaylee-station--since-you-last-looked', 'Since you last looked: the top strip', 'lyphecli', 'building', '2026-10-30T01:46:54Z', null, 614, ['kaylee-station--shell']),
        feature(7, 'kaylee-station--memory-corner', 'What I\'m keeping: the memory corner', 'lyphecli', 'building', '2026-10-30T01:46:55Z', null, 0, ['kaylee-station--memory-page', 'kaylee-station--shell']),
        feature(8, 'kaylee-station--draft-dock', 'The draft dock', 'lyphecli', 'waiting', '2026-10-30T01:46:55Z', null, 0, ['kaylee-station--shell', 'kaylee-station--where-things-stand']),
        feature(9, 'kaylee-station--compact', 'Compact mode for a second monitor', 'lyphecli', 'waiting', '2026-10-30T01:46:55Z', null, 0, ['kaylee-station--cards', 'kaylee-station--center', 'kaylee-station--draft-dock', 'kaylee-station--memory-corner', 'kaylee-station--since-you-last-looked', 'kaylee-station--what-needs-you', 'kaylee-station--where-things-stand']),
        feature(10, 'kaylee-station--memory-page', 'Her memory\'s full page: the read-only live page of her bank in DocSpace', 'house', 'shipped', '2026-10-30T02:34:06Z', '2026-10-30T06:17:29Z', 6411),
        feature(11, 'kaylee-station--phone', 'The station on a phone', 'lyphecli', 'waiting', '2026-10-30T03:50:51Z', null, 0, ['kaylee-station--compact']),
      ]),
      ...(desk ? [epic(3, DESK_EPIC.name, DESK_EPIC.title, 'in progress', '2026-10-30T09:20:00Z', null, 0,
        DESK_EPIC.features.map(({ name, title }, at) => feature(at + 1, name, title, 'lyphecli', 'accept', '2026-10-30T09:20:00Z', null, 0)))] : []),
    ]),
  ];

  const epics = milestones.flatMap((item) => item.epics);
  const features = epics.flatMap((item) => item.features);
  const counted = countOf(features);
  return {
    name: 'lyphecli', title: 'lyphecli', goal: 'I want this CloudCLI to be my mobile command center.', position: 2,
    created_at: '2026-10-03T23:46:14Z', word: 'on the way',
    current: milestones.find((item) => item.word !== 'reached')?.name ?? null,
    standing: {
      milestones: milestones.length, reached: milestones.filter((item) => item.word === 'reached').length, epics: epics.length,
      complete: epics.filter((item) => item.word === 'complete').length, features: counted.features, shipped: counted.shipped,
      in_flight: counted.in_flight, designing: counted.designing, proposed: counted.proposed, ideas: counted.ideas, blocked: 0,
      waiting_on_you: features.filter((item) => item.waiting_on_you !== null).length, cases: NO_CASES,
    },
    milestones,
  };
}

/** The roadmap lane's whole picture holding `roadmap` alone (none for null): what the live bus carries in a picture. */
export function roadmapPictureOf(roadmap: Roadmap | null): RoadmapPicture {
  return { generated_at: '2026-10-30T10:00:00Z', roadmaps: roadmap === null ? [] : [roadmap], unplaced: { epics: [], features: [] } };
}
