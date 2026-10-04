import type { FaceDialog } from '@/modules/roadmap/faceContext';
import { BlockDialog } from '@/modules/roadmap/modals/BlockDialog';
import { DeleteDialog } from '@/modules/roadmap/modals/DeleteDialog';
import { FeatureDialog } from '@/modules/roadmap/modals/FeatureDialog';
import { ItemDialog } from '@/modules/roadmap/modals/ItemDialog';
import { MoveDialog } from '@/modules/roadmap/modals/MoveDialog';

/**
 * The dialog the Roadmap face has open, mounted: the one `FaceDialog` the face holds, drawn as the dialog
 * it names with the target it carries. Every dialog closes through the one `onClose`, whether its write
 * landed or not — the picture that follows is what shows a write, so the face has no use for the answer.
 * Used by `RoadmapPath` and `RoadmapWidgetBody`, each in its one dialog slot.
 */
export function OpenDialog({ dialog, onClose, onOpenCard }: {
  dialog: FaceDialog;
  onClose: () => void;
  /**
   * Handed to a feature's dialog for its Open its card and Answer on its card: on the tab the face turns to
   * In flight on that plan; in the chat gutter's widget the dialog closes and the page lands on `?runner=<plan>`.
   */
  onOpenCard: (plan: string) => void;
}) {
  switch (dialog.dialog) {
    case 'add':
      return <ItemDialog kind={dialog.kind} parent={dialog.parent} onClose={onClose} />;
    case 'edit':
      return <ItemDialog kind={dialog.kind} item={dialog.item} goalFirst={dialog.goalFirst ? { then: null } : undefined} onClose={onClose} />;
    case 'move':
      return <MoveDialog kind={dialog.kind} name={dialog.name} onClose={onClose} />;
    case 'block':
      return <BlockDialog kind={dialog.kind} item={dialog.item} onClose={onClose} />;
    case 'delete':
      return <DeleteDialog kind={dialog.kind} item={dialog.item} onClose={onClose} />;
    case 'feature':
      return <FeatureDialog name={dialog.name} onOpenCard={onOpenCard} onClose={onClose} />;
  }
}
