import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { ConfirmDialog } from '@/shared/ui';

type PromoteDialogProps = {
  /** The feature: its name for the write, its title for the question. */
  feature: { name: string; title: string };
  /** Closes the question: `true` once the dispatcher took the promote, `false` on Cancel, Escape or the backdrop. */
  onClose: (written: boolean) => void;
};

/**
 * "Send <title> to design?" — Promote, confirmed. Promotion is `dispatcher design`: it starts a real
 * Eupalinos on a real model, and one stray tap on a row-sized button should not. The sentence says what
 * happens next, and that the Accept stays the gate on building, so nothing is built from this press alone.
 *
 * Its own file so the question is one piece. It is drawn over `FeatureDialog`, which ignores a close
 * while it is up, so one Escape closes only the question. A dismissal waits for the answer, as
 * `DeleteDialog`'s does; a landed promote closes it, a refusal leaves it up beside the hook's toast.
 *
 * Used by the roadmap module's `FeatureDialog` (Promote, and a goal written first for Promote).
 */
export function PromoteDialog({ feature, onClose }: PromoteDialogProps) {
  const { t } = useTranslation();
  const writes = useRoadmapWrites();
  useReturnFocus();

  // The promote is out, so Send to design shows busy and the ways out wait for its answer: a real Eupalinos is starting.
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    const landed = await writes.promote({ name: feature.name, itemTitle: feature.title });
    // A landed promote closes the question; a refusal leaves it up, beside the hook's toast.
    if (landed) onClose(true);
    else setBusy(false);
  };

  const dismiss = () => {
    if (!busy) onClose(false);
  };

  return (
    <ConfirmDialog
      open
      title={t('roadmap.dialog.promote.title', { title: feature.title })}
      message={<p data-roadmap-dialog="promote">{t('roadmap.dialog.promote.message')}</p>}
      actions={[
        { label: t('roadmap.dialog.cancel'), variant: 'outline', onSelect: dismiss, disabled: busy },
        { label: t('roadmap.dialog.promote.confirm'), variant: 'default', onSelect: confirm, busy },
      ]}
      onDismiss={dismiss}
    />
  );
}
