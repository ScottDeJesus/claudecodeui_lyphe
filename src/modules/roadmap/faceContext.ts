import { createContext } from 'react';

import type { Roadmap, RoadmapEpic, RoadmapFeature, RoadmapKind, RoadmapMilestone } from '@/shared/roadmap-types';

/** What an edit opens on: the item as the picture draws it. */
type EditableItem = Roadmap | RoadmapMilestone | RoadmapEpic | RoadmapFeature;

/** The item a block or a delete is about: its name for the write, its title for the question. */
type NamedItem = { name: string; title: string };

/**
 * The one dialog the Roadmap face has open, and what it is open for. `add` lands a new item in `parent`
 * (the roadmap for a milestone, the milestone for an epic, the epic for a feature; `null` for a roadmap);
 * `edit` changes the item as it stood when pressed, asking for its goal first when `goalFirst`; `move`
 * and `feature` name their item and read it off each new picture; `block` and `delete` carry the item
 * they are about. `kind` is the dispatcher's own word: `arc` is an epic, `plan` a feature. Held by
 * `RoadmapPath` as its one piece of dialog state, and drawn by `OpenDialog`.
 */
export type FaceDialog =
  | { dialog: 'add'; kind: RoadmapKind; parent: NamedItem | null }
  | { dialog: 'edit'; kind: RoadmapKind; item: EditableItem; goalFirst?: boolean }
  | { dialog: 'move'; kind: 'milestone' | 'arc' | 'plan'; name: string }
  | { dialog: 'block'; kind: 'milestone' | 'arc' | 'plan'; item: NamedItem }
  | { dialog: 'delete'; kind: RoadmapKind; item: NamedItem }
  | { dialog: 'feature'; name: string };

/**
 * What the Roadmap face hands every press under it: `openDialog` puts a dialog on the face (the face
 * holds one at a time); `openCard` shows a feature's live card, which is `RoadmapTab`'s doing (it turns to
 * In flight and hands the plan down), so it is `null` on a surface that has no tab above it; and `focus`
 * puts a milestone on the stage, as pressing its station does — a milestone moved along the path keeps
 * the stage, where the stage would otherwise follow the current milestone to whichever took its place.
 */
export type RoadmapFace = {
  openDialog: (dialog: FaceDialog) => void;
  openCard: ((plan: string) => void) | null;
  focus: (milestone: string) => void;
};

/**
 * The face's context. Provided by `RoadmapPath`; read by `RoadmapHeader`, `RoadmapPicker`, `MilestonePath`,
 * `MilestoneFocus`, `EpicCard` and `RoadmapRail` for `openDialog` (`MilestoneFocus` also for `focus`), and by
 * `FeatureRow` (through `useRevealCard`) for `openCard`. A surface that draws these pieces without the face —
 * the chat gutter's widget — provides it with a host of its own; a press with none above it says so in the
 * console rather than do nothing in silence.
 */
export const RoadmapFaceContext = createContext<RoadmapFace>({
  openDialog: (dialog) => console.warn(`[roadmap] a press opened the ${dialog.dialog} dialog with no dialog host above it`),
  openCard: null,
  focus: () => {},
});
