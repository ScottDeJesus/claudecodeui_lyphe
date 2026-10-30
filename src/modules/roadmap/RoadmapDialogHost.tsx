import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import type { FaceDialog, RoadmapFace } from '@/modules/roadmap/faceContext';
import { OpenDialog } from '@/modules/roadmap/modals/OpenDialog';
import type { RoadmapFeature } from '@/shared/roadmap-types';

/** The doors a host hands what it holds, for a press drawn outside the roadmap's own panels. */
type RoadmapDialogDoors = {
  /** A feature's empty goal, pressed (`FeatureFacts`' "Write its goal"): the goal editor, as the feature dialog opens it. */
  writeGoal: (feature: RoadmapFeature) => void;
};

/**
 * THE ROADMAP'S DIALOGS ON A PAGE WITH NO ROADMAP FACE. Every press of the roadmap's panels that opens a dialog (an
 * epic's ⋯ menu: Add a feature, Edit, Move, Mark blocked, Delete; its Add a feature) opens it through
 * `RoadmapFaceContext`, which `RoadmapTreeFace` provides; under no provider the context's default logs and does
 * nothing. The host provides it as the face does — one dialog at a time, as a dialog is modal — and draws that dialog
 * (`OpenDialog`, which portals over the page). A feature dialog's Open its card and Answer on its card close it first,
 * then hand the plan to `onOpenCard`, the page's own way to a card. What the host holds is drawn by `children`, which
 * is handed `writeGoal` for a feature's empty goal: the one press `FeatureFacts` takes as a prop rather than from the
 * context.
 *
 * Used by the station module's `CardStage`, around the stage's roadmap facts (`EpicPanel`, `FeatureFacts`).
 */
export function RoadmapDialogHost({ onOpenCard, children }: {
  /** A dialog's Open its card or Answer on its card, the dialog already closed: the page shows that plan's card. */
  onOpenCard: (plan: string) => void;
  /** What the host holds, drawn with the host's doors. */
  children: (doors: RoadmapDialogDoors) => ReactNode;
}) {
  // Which dialog is open over the page, and for which item: one at a time, as a dialog is modal; `null` for none. Its
  // setter is the context's `openDialog`, so every press under the host puts its dialog up here.
  const [dialog, setDialog] = useState<FaceDialog | null>(null);
  const face = useMemo<RoadmapFace>(() => ({ openDialog: setDialog }), []);
  // The goal editor is the face's `edit` dialog asked for the goal first: `FeatureDialog` opens the same one.
  const doors = useMemo<RoadmapDialogDoors>(() => ({
    writeGoal: (feature) => setDialog({ dialog: 'edit', kind: 'plan', item: feature, goalFirst: true }),
  }), []);

  return (
    <RoadmapFaceContext.Provider value={face}>
      {children(doors)}
      {dialog !== null && (
        <OpenDialog dialog={dialog} onClose={() => setDialog(null)} onOpenCard={(plan) => { setDialog(null); onOpenCard(plan); }} />
      )}
    </RoadmapFaceContext.Provider>
  );
}
