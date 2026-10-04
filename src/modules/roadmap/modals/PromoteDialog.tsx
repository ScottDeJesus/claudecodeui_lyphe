// FILL: imports — the markers' own: react's useState, and useRoadmapWrites
import { useTranslation } from 'react-i18next';

import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import { ConfirmDialog } from '@/shared/ui';

// Each fill marker below governs the ONE statement under it, which holds a fake standing in for what the
// fill holds or does; `imports` marks where the fill adds the imports its markers need. Every other line
// is composition and stays as it is.

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
 * Its own file so the question is one piece, mounted in place of `FeatureDialog` — never over it, since
 * two dialogs open at once would split one Escape between them. A dismissal waits for the answer, as
 * `DeleteDialog`'s does; a landed promote closes it, a refusal leaves it up beside the hook's toast.
 *
 * Used by the roadmap module's `FeatureDialog` (Promote, and a goal written first for Promote).
 */
export function PromoteDialog({ feature, onClose }: PromoteDialogProps) {
  const { t } = useTranslation();
  useReturnFocus();

  // FILL: busy — component state, with its comment: the promote is out, so Send to design shows busy and the ways out wait for its answer
  const busy = false;
  // FILL: onPromote — writes.promote({ name: feature.name, itemTitle: feature.title }) with busy held; true → onClose(true); false → the question stays
  const confirm = () => {};

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
