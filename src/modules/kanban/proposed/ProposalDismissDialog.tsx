import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BugProposal } from '@/shared/types';
import { Banner, Button, DialogFrame, Field, TextArea } from '@/shared/ui';

/**
 * DISMISS A PROPOSAL: one question, why. The reason is required, because it is what the next person to find the
 * same thing reads, and it is kept with the proposal.
 *
 * THE DIALOG SAYS WHAT DISMISSING DOES before it asks: the proposal is closed, nothing is built, its words and
 * findings are kept, and (when it has any) its stopgap tickets stay as they are.
 *
 * DISMISS WAITS FOR A REASON, and the field says so under itself from the first moment, so a press that will not
 * go is never a puzzle. A reason is 1 to 500 characters, the dispatcher's own bound: past it the field turns amber
 * and says by how many, and the press waits again. Blank space alone is no reason.
 *
 * A refusal of the dispatcher's is said above the presses in its own sentence, and the dialog stays open on the
 * reason typed. Mounted only while it is open (`DialogFrame`), so every opening starts with an empty field.
 */

type ProposalDismissDialogProps = {
  proposal: BugProposal;
  /** The dismiss is out: both presses and the ✕ wait. */
  busy: boolean;
  /** The dispatcher's sentence for a dismiss it refused, or `null`. */
  refusal: string | null;
  /** Called with the reason, trimmed. */
  onDismiss: (reason: string) => void;
  onClose: () => void;
};

/** The longest reason the dispatcher takes (`bug proposal dismiss --reason`, 1 to 500). */
const REASON_MAX = 500;

/** Rendered by ProposedFeatures while a proposal is being dismissed. Nothing else mounts it. */
export function ProposalDismissDialog({ proposal, busy, refusal, onDismiss, onClose }: ProposalDismissDialogProps) {
  const { t } = useTranslation();
  const reasonId = useId();
  // The reason as typed; the dismiss is sent with it trimmed, and waits while it is blank or too long.
  const [reason, setReason] = useState('');

  const trimmed = reason.trim();
  const over = trimmed.length - REASON_MAX;

  return (
    <DialogFrame
      size="md"
      title={t('kanban.proposed.dismissDialog.title')}
      accent={{ words: t('kanban.proposed.dismissDialog.accent') }}
      busy={busy}
      onDismiss={onClose}
      data-proposal-dialog="dismiss"
    >
      <div className="flex flex-col gap-5">
        <p className="break-words text-sm leading-relaxed text-muted-foreground">
          {t('kanban.proposed.dismissDialog.about', { title: proposal.title })}
          {proposal.stopgaps.length > 0 && <> {t('kanban.proposed.dismissDialog.stopgaps')}</>}
        </p>
        <Field
          label={t('kanban.proposed.dismissDialog.reason')}
          htmlFor={reasonId}
          helper={t('kanban.proposed.dismissDialog.reasonHelper')}
          error={over > 0 ? t('kanban.proposed.dismissDialog.reasonTooLong', { count: over }) : undefined}
        >
          <TextArea
            id={reasonId}
            rows={4}
            required
            value={reason}
            invalid={over > 0}
            disabled={busy}
            placeholder={t('kanban.proposed.dismissDialog.reasonPlaceholder')}
            aria-describedby={over > 0 ? undefined : `${reasonId}-helper`}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" className="finger:h-11" disabled={busy} onClick={onClose}>{t('kanban.proposed.dismissDialog.cancel')}</Button>
          <Button className="finger:h-11" busy={busy} disabled={trimmed === '' || over > 0} onClick={() => onDismiss(trimmed)}>{t('kanban.proposed.dismissDialog.confirm')}</Button>
        </div>
      </div>
    </DialogFrame>
  );
}
