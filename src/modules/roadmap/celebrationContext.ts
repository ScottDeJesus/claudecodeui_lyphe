import { createContext } from 'react';

/**
 * One completion worth celebrating, at one of the four sizes (a task, a feature, an epic or a
 * milestone). `name` is the item's own (a feature's, an epic's or a milestone's; a task moment is its
 * FEATURE's, since the dot that blooms is the feature's) and `title` what the screen calls it;
 * `at` is the dispatcher's UTC string for the completion (`done_at`, `shipped_at`, `completed_at` or
 * `reached_at`), which is both the order moments play in and, for every size but a task, the stamp
 * the seen-list advances to. `summary` is the one line a catch-up adds: "<n> features
 * shipped while you were away", or the other milestones a long absence reached. Used by
 * `useCelebrations` (which builds them) and `CelebrationLayer` (which draws the milestone's).
 */
export type Moment = {
  level: 'task' | 'feature' | 'epic' | 'milestone';
  name: string;
  title: string;
  at: string;
  summary?: string;
};

/**
 * What is playing right now, by name, for the tree's nodes that carry their own motion: the tasks and
 * features whose dot is blooming, the epics whose ring is drawing and bursting, and the milestone whose
 * ring is drawing and whose connector from the goal draws itself (or `null`). A task's name is its
 * feature's, since the dot that blooms is the feature's. Provided by `RoadmapTreeFace`, from
 * `useCelebrations`; read by the tree's nodes (`tree/TreeGoal`'s connectors, `tree/TreeMilestoneNode`
 * and `tree/TreeEpicNode`).
 */
export type CelebrationActive = {
  tasks: Set<string>;
  features: Set<string>;
  epics: Set<string>;
  milestone: string | null;
};

/**
 * The celebration context. Its default is the still screen — every set empty and no milestone — so
 * a tree node drawn under no provider reads "nothing is playing" rather than failing. Provided by
 * `RoadmapTreeFace` from its own `useCelebrations`; read by the tree's nodes (`tree/TreeGoal`'s
 * connectors, `tree/TreeMilestoneNode` and `tree/TreeEpicNode`).
 */
export const CelebrationContext = createContext<CelebrationActive>({
  tasks: new Set(),
  features: new Set(),
  epics: new Set(),
  milestone: null,
});
