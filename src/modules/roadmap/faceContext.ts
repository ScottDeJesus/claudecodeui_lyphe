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
 * `RoadmapTreeFace` as its one piece of dialog state, and drawn by `OpenDialog`.
 */
export type FaceDialog =
  | { dialog: 'add'; kind: RoadmapKind; parent: NamedItem | null }
  | { dialog: 'edit'; kind: RoadmapKind; item: EditableItem; goalFirst?: boolean }
  | { dialog: 'move'; kind: 'milestone' | 'arc' | 'plan'; name: string }
  | { dialog: 'block'; kind: 'milestone' | 'arc' | 'plan'; item: NamedItem }
  | { dialog: 'delete'; kind: RoadmapKind; item: NamedItem }
  | { dialog: 'feature'; name: string };

/**
 * What the Roadmap face hands every press under it: `openDialog` puts a dialog on the face, which holds one
 * at a time.
 */
export type RoadmapFace = {
  openDialog: (dialog: FaceDialog) => void;
};

/**
 * The face's context. Provided by `RoadmapTreeFace`, on every surface that draws the roadmap; read by
 * `RoadmapPicker` (its New roadmap…) and by the tree's panels (`RoadmapPanel`, `MilestonePanel`, `EpicPanel` and
 * `FeaturePanel`) for `openDialog`. A press with no face above it says so in the console rather than do
 * nothing in silence.
 */
export const RoadmapFaceContext = createContext<RoadmapFace>({
  openDialog: (dialog) => console.warn(`[roadmap] a press opened the ${dialog.dialog} dialog with no dialog host above it`),
});
