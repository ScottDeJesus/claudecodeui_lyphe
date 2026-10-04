//----------------- ROADMAP CONTRACTS ------------
// The client's view of the roadmap lane: every shape the Roadmap tab, its feed and its writes read
// off a wire or hand back to it.
//
// It mirrors `server/shared/roadmap-types.ts` field for field, and that file is the one place to
// look when a shape here seems wrong. The two edit TOGETHER: a field renamed on one side and not the
// other is a picture the screen quietly stops reading. The one section with no server twin is the
// last, the body a write sends: the server reads a body as `unknown` and fences each field itself
// (`roadmap-write.service.ts`), so the shape lives only where a body is built.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build. The one place the server's type
// leans on another file is `RoadmapWriteResult`, whose command-result fields (`ok`, `exit`, `stdout`,
// `stderr`, `reason`) the server takes from `server/shared/dispatcher-command.ts`; here they are
// spelled out, so this file stands alone.
//
// It is a SIBLING of `src/shared/types.ts` rather than an addition to it, for the reason the other
// sibling contracts are (`claude-update-types.ts`, the two `kanban-types.ts`): that file is past 2600
// lines and the house ceiling for a module is 300.
//
// Two readings the whole contract stands on: every WORD (`word`, `step`, `waiting_on_you`) is the
// dispatcher's own — the screen derives none and spells none it was not told — and every time is the
// dispatcher's UTC string (`2026-10-03T23:46:28Z`), except `RoadmapStateEvent.at`, the frame's own
// clock in epoch MILLISECONDS.

//----------------- THE WORDS THE DISPATCHER DERIVES ------------

/** A feature's one word, as the dispatcher derives it at read time from the plan's own state. */
export type RoadmapFeatureWord = 'idea' | 'proposed' | 'designing' | 'in flight' | 'shipped';

/**
 * The finer step under a feature's word. `designing` carries the steps `designing`, `questions`,
 * `cutting`, `parked` and `accept`; `in flight` carries `building`, `paused`, `queued`, `waiting`
 * and `starting`; every other word is its own step.
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

/** An epic's (arc's) word. */
export type RoadmapEpicWord = 'empty' | 'not started' | 'in progress' | 'complete';

/** A milestone's word; the epic's, but `reached` where an epic says `complete`. */
export type RoadmapMilestoneWord = 'empty' | 'not started' | 'in progress' | 'reached';

/** A whole roadmap's word. */
export type RoadmapWord = 'no path yet' | 'on the way' | 'every milestone reached';

// ---------------------------

//----------------- THE PICTURE ------------

/** One task of a feature's plan — a cut phase, with the dispatcher's own key for it. `done_at` is null until the task is done. */
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
 * plans it waits on. `repo` is always a string, and `project` a label or null.
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
 * `designed_whole` is true when the epic's features were cut together as one design.
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

/** One milestone: a place on the way, made of epics. */
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
 * `generated_at` moves on every read, so a reader compares pictures without it.
 */
export type RoadmapPicture = {
  generated_at: string;
  roadmaps: Roadmap[];
  unplaced: {
    epics: { name: string; title: string }[];
    features: { name: string; title: string; word: RoadmapFeatureWord }[];
  };
};

/** The `/ws` frame the roadmap lane broadcasts: the picture, tagged and stamped. `at` is epoch milliseconds when the frame was cut. */
export type RoadmapStateEvent = { kind: 'roadmap_state'; at: number } & RoadmapPicture;

// ---------------------------

//----------------- THE WORDS A WRITE MAY NAME ------------

/** The four things a roadmap is made of, as the dispatcher's `roadmap add` spells them. `arc` is an epic's word and `plan` a feature's. */
export type RoadmapKind = 'roadmap' | 'milestone' | 'arc' | 'plan';

/** The nine writes the lane relays, one route each. `promote` is `dispatcher design`; the other eight are `dispatcher roadmap <act>`. */
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
 * and the name it acted on. `ok`, `exit`, `stdout`, `stderr` and `reason` are the command result's own
 * fields — `reason` is present only when the dispatcher never got to answer. `name` is the request's
 * own name or, for an add that sent none, the name the dispatcher minted and printed in its `ADDED
 * <kind> <name>` line; `null` where neither exists (a refusal before the mint).
 */
export type RoadmapWriteResult = {
  ok: boolean;
  exit: number | null;
  stdout: string;
  stderr: string;
  reason?: 'timeout' | 'spawn-failed';
  act: RoadmapAct;
  name: string | null;
};

// ---------------------------

//----------------- THE BODY A WRITE SENDS ------------

/**
 * What a write's request body may carry — every field optional, because each act reads a different
 * few and the server fences them (`roadmap-write.service.ts`). `kind` is the dispatcher's own word
 * (`arc` for an epic, `plan` for a feature); `name` the item acted on (an add sends none, so the store
 * mints it); `parent` the container an add lands in; `to`, `before` and `after` where a move lands;
 * `why` a block's reason. `title` is a wire field for `add` and `edit` alone (`useRoadmapWrites` takes
 * it off any other act before sending). `itemTitle` is not a wire field for any act: it is what the
 * success toast calls the item, so a goal-only edit says "Real Title saved" without sending the old
 * title as a change (`useRoadmapWrites` always takes it off). Consumers: `api.roadmap` (the helpers'
 * body) and `useRoadmapWrites`.
 */
export type RoadmapWriteBody = {
  kind?: RoadmapKind;
  name?: string;
  parent?: string;
  to?: string;
  before?: string;
  after?: string;
  title?: string;
  itemTitle?: string;
  goal?: string;
  repo?: string;
  project?: string;
  why?: string;
};

// ---------------------------
