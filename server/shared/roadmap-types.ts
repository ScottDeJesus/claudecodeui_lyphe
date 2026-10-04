//----------------- ROADMAP CONTRACTS ------------
// The shapes the roadmap lane puts on a wire: the picture `dispatcher roadmap show --json` prints,
// the `/ws` frame that carries it, and the closed words a write may name — in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason every
// other sibling here exists: that file is 2231 lines, the house ceiling for a module is 300, and
// the Kanban board established the pattern (`server/shared/kanban-types.ts` beside ten more).
//
// The client mirror is `src/shared/roadmap-types.ts`, field for field. A change here without the
// same change there is a picture the screen cannot read, so the two are edited together, always.
//
// Two readings the whole contract stands on: every WORD (`word`, `step`, `waiting_on_you`) is the
// dispatcher's own — this server derives none and spells none it was not told — and every time is
// the dispatcher's UTC string (`2026-10-03T23:46:28Z`), except `RoadmapStateEvent.at`, the frame's
// own clock in epoch MILLISECONDS.
//
// `server/shared/types.ts` is not opened by anything in this lane.

import type { DispatcherCommandResult } from './dispatcher-command.js';

//----------------- THE WORDS THE DISPATCHER DERIVES ------------

/**
 * A feature's one word, as `report_roadmap.py` derives it at read time from the plan's own state.
 * Consumers: the roadmap lane's reader (`roadmap-state.service.ts`, which refuses any other word)
 * and the screen, which draws it.
 */
export type RoadmapFeatureWord = 'idea' | 'proposed' | 'designing' | 'in flight' | 'shipped';

/**
 * The finer step under a feature's word. `designing` carries the steps `designing`, `questions`,
 * `cutting`, `parked` and `accept`; `in flight` carries `building`, `paused`, `queued`, `waiting`
 * and `starting`; every other word is its own step. Consumers: the roadmap lane's reader and the screen.
 */
export type RoadmapFeatureStep =
  | 'idea'
  | 'proposed'
  | 'designing'
  | 'questions'
  | 'cutting'
  | 'accept'
  | 'parked'
  | 'building'
  | 'waiting'
  | 'queued'
  | 'paused'
  | 'starting'
  | 'shipped';

/** An epic's (arc's) word. Consumers: the roadmap lane's reader and the screen. */
export type RoadmapEpicWord = 'empty' | 'not started' | 'in progress' | 'complete';

/** A milestone's word; the epic's, but `reached` where an epic says `complete`. Consumers: the reader and the screen. */
export type RoadmapMilestoneWord = 'empty' | 'not started' | 'in progress' | 'reached';

/** A whole roadmap's word. Consumers: the roadmap lane's reader and the screen. */
export type RoadmapWord = 'no path yet' | 'on the way' | 'every milestone reached';

// ---------------------------

//----------------- THE PICTURE ------------

/**
 * One task of a feature's plan — a cut phase, with the dispatcher's own key for it.
 * `done_at` is null until the task is done. Consumers: the roadmap lane's reader
 * (`roadmap-state.service.ts`, which refuses any other status) and the screen.
 */
export type RoadmapTask = {
  key: string;
  title: string;
  status: 'not started' | 'running' | 'done';
  done_at: string | null;
};

/**
 * One feature: a plan on the roadmap, from an idea to shipped. `waiting_on_you` names what the
 * operator owes it (`questions` to answer, an `accept` to press) or is null; `blocked` is the
 * operator's own reason, a mark the picture shows and nothing reads, or null; `waits_on` names the
 * plans it waits on. `repo` is always a string, and `project` a label or null. Consumers: the roadmap
 * lane's reader and the screen.
 */
export type RoadmapFeature = {
  name: string;
  title: string;
  goal: string | null;
  project: string | null;
  repo: string;
  position: number;
  blocked: string | null;
  word: RoadmapFeatureWord;
  step: RoadmapFeatureStep;
  waiting_on_you: 'questions' | 'accept' | null;
  waits_on: string[];
  tasks: RoadmapTask[];
  created_at: string;
  promoted_at: string | null;
  approved_at: string | null;
  shipped_at: string | null;
};

/**
 * One epic (an arc on the wire's other face): a body of features under a milestone.
 * `designed_whole` is true when the epic's features were cut together as one design. Consumers: the
 * roadmap lane's reader and the screen.
 */
export type RoadmapEpic = {
  name: string;
  title: string;
  goal: string | null;
  position: number;
  created_at: string;
  blocked: string | null;
  designed_whole: boolean;
  word: RoadmapEpicWord;
  completed_at: string | null;
  standing: {
    features: number;
    shipped: number;
    in_flight: number;
    designing: number;
    proposed: number;
    ideas: number;
  };
  features: RoadmapFeature[];
};

/** One milestone: a place on the way, made of epics. Consumers: the roadmap lane's reader and the screen. */
export type RoadmapMilestone = {
  name: string;
  title: string;
  goal: string | null;
  position: number;
  created_at: string;
  blocked: string | null;
  word: RoadmapMilestoneWord;
  reached_at: string | null;
  standing: { epics: number; complete: number; features: number; shipped: number };
  epics: RoadmapEpic[];
};

/**
 * One roadmap, the whole path to something. `current` is the name of its first milestone, in order,
 * that is not reached, or null when there is none (no path yet, or every milestone reached).
 * Consumers: the roadmap lane's reader and the screen, which draws one roadmap at a time.
 */
export type Roadmap = {
  name: string;
  title: string;
  goal: string | null;
  position: number;
  created_at: string;
  word: RoadmapWord;
  current: string | null;
  standing: {
    milestones: number;
    reached: number;
    epics: number;
    complete: number;
    features: number;
    shipped: number;
    in_flight: number;
    designing: number;
    proposed: number;
    ideas: number;
    blocked: number;
    waiting_on_you: number;
  };
  milestones: RoadmapMilestone[];
};

/**
 * The document `dispatcher roadmap show --json` prints, read whole. `unplaced` is what the store
 * holds that no roadmap reaches yet: epics under no milestone and features under no epic.
 * `generated_at` moves on every read, so the lane compares pictures without it. Consumers: the roadmap
 * lane (`roadmap-state.service.ts` reads it, the module polls and serves it) and the screen.
 */
export type RoadmapPicture = {
  generated_at: string;
  roadmaps: Roadmap[];
  unplaced: {
    epics: { name: string; title: string }[];
    features: { name: string; title: string; word: RoadmapFeatureWord }[];
  };
};

/**
 * The `/ws` frame the roadmap lane broadcasts: the picture, tagged and stamped. `at` is epoch
 * milliseconds at the moment the frame was cut. Consumers: the roadmap module (which sends it) and
 * the screen's feed (which reads it).
 */
export type RoadmapStateEvent = { kind: 'roadmap_state'; at: number } & RoadmapPicture;

// ---------------------------

//----------------- THE WORDS A WRITE MAY NAME ------------

/**
 * The four things a roadmap is made of, as the dispatcher's `roadmap add` spells them. `arc` is an
 * epic's word and `plan` a feature's. Consumers: `roadmap-write.service.ts`, which fences a request's
 * `kind` against exactly these, and the screen's forms.
 */
export type RoadmapKind = 'roadmap' | 'milestone' | 'arc' | 'plan';

/**
 * The nine writes the lane relays, each one a dispatcher verb. `promote` is `dispatcher design`; the
 * other eight are `dispatcher roadmap <act>`. Consumers: `roadmap-write.service.ts` (which spells the
 * argv for each) and the routes (one per act).
 */
export type RoadmapAct =
  | 'add'
  | 'edit'
  | 'move'
  | 'propose'
  | 'unpropose'
  | 'block'
  | 'unblock'
  | 'remove'
  | 'promote';

/**
 * What a relayed write answers with: the dispatcher's own result, whole, plus the act that was pressed
 * and the name it acted on. `name` is the request's own name or, for an add that sent none, the name
 * the dispatcher minted and printed in its `ADDED <kind> <name>` line; `null` where neither exists (a
 * refusal before the mint). Consumers: the roadmap routes (the body of every write's answer) and the
 * screen, which reads the minted name back to select what it just added.
 */
export type RoadmapWriteResult = DispatcherCommandResult & { act: RoadmapAct; name: string | null };
