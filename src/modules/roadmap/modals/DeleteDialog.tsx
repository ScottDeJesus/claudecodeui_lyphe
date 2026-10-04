import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { RoadmapKind } from '@/shared/roadmap-types';
import { ConfirmDialog } from '@/shared/ui';

type DeleteDialogProps = {
  /** The dispatcher's own word for what is deleted: `arc` is an epic, `plan` a feature. */
  kind: RoadmapKind;
  /** The item: its name for the write, its title for the question. */
  item: { name: string; title: string };
  /** Closes the question: `true` once the store took the delete, `false` on Cancel, Escape or the backdrop. */
  onClose: (written: boolean) => void;
};

/**
 * "Delete <title>?", asked before `remove`, because no press brings an item back.
 *
 * THE MESSAGE SAYS WHAT GOES: the item, and nothing with it. The store deletes only what holds nothing —
 * a feature before its design, an epic with no feature, a milestone with no epic, a roadmap with no
 * milestone — and every menu offers Delete only then, so each kind's sentence can say so plainly.
 *
 * A DISMISSAL WAITS FOR THE ANSWER (`DeletePlanDialog`'s rule): once Delete is pressed the write is
 * already at the dispatcher, so Cancel is disabled and Escape and the backdrop do nothing until it
 * answers. A landed delete closes it; a refusal leaves the question up beside the hook's toast.
 *
 * Used by the roadmap module: `FeatureDialog` (Delete idea… and Delete…) and the Roadmap face's dialog
 * host (Delete on a roadmap, a milestone or an epic).
 */
export function DeleteDialog({ kind, item, onClose }: DeleteDialogProps) {
  const { t } = useTranslation();
  const writes = useRoadmapWrites();
  useReturnFocus();

  // The delete is out, so Delete shows busy and the ways out wait for its answer: the write is already at the dispatcher.
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const landed = await writes.remove({ kind, name: item.name, itemTitle: item.title });
    // A landed delete closes the question; a refusal leaves it up, beside the hook's toast.
    if (landed) onClose(true);
    else setBusy(false);
  };

  const dismiss = () => {
    if (!busy) onClose(false);
  };

  return (
    <ConfirmDialog
      open
      title={t('roadmap.dialog.delete.title', { title: item.title })}
      message={<p data-roadmap-dialog="delete">{t(`roadmap.dialog.delete.message.${kind}`)}</p>}
      actions={[
        { label: t('roadmap.dialog.cancel'), variant: 'outline', onSelect: dismiss, disabled: busy },
        { label: t('roadmap.dialog.delete.confirm'), variant: 'destructive', onSelect: confirm, busy },
      ]}
      onDismiss={dismiss}
    />
  );
}
