import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RndCandidate } from '@/shared/rnd-types';
import { Banner, Button, DialogFrame, Field, Input } from '@/shared/ui';

type RejectDialogProps = {
  candidate: RndCandidate;
  /** The rejection is out: both presses and the way back wait. */
  busy: boolean;
  /** The dispatcher's sentence for a rejection it refused, or null. */
  refusal: string | null;
  /** Called with the reason, trimmed. */
  onReject: (why: string) => void;
  onClose: () => void;
};

/**
 * REJECT A CANDIDATE: one question, why. The reason is required, because the next scout reads it: it is what keeps the same
 * thing from being filed again. The dialog says so before it asks, and that Bring back undoes it.
 *
 * REJECT WAITS FOR A REASON, and the field says so under itself from the first moment, so a press that will not go is never a
 * puzzle. Blank space alone is no reason. Enter in the field is the press.
 *
 * A refusal of the dispatcher's is said above the presses in its own sentence, and the dialog stays open on the reason typed.
 * Mounted only while it is open, so every opening starts with an empty field.
 *
 * Rendered by RndPanel inside the open candidate, while Reject is being asked.
 */
export function RejectDialog({ candidate, busy, refusal, onReject, onClose }: RejectDialogProps) {
  const { t } = useTranslation();
  const whyId = useId();
  const [why, setWhy] = useState('');
  const trimmed = why.trim();

  return (
    <DialogFrame size="md" title={t('rnd.reject.title')} accent={{ words: t('rnd.reject.accent') }} busy={busy} onDismiss={onClose} data-rnd-dialog="reject">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed !== '' && !busy) onReject(trimmed);
        }}
      >
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{t('rnd.reject.about', { title: candidate.title })}</p>
        <Field label={t('rnd.reject.why')} htmlFor={whyId} helper={t('rnd.reject.whyHelper')}>
          <Input
            id={whyId}
            required
            value={why}
            disabled={busy}
            placeholder={t('rnd.reject.whyPlaceholder')}
            aria-describedby={whyId + '-helper'}
            className="finger:h-11"
            onChange={(event) => setWhy(event.target.value)}
          />
        </Field>
        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button type="button" variant="ghost" className="finger:h-11" disabled={busy} onClick={onClose}>{t('rnd.reject.cancel')}</Button>
          <Button type="submit" className="finger:h-11" busy={busy} disabled={trimmed === ''} data-rnd-act="reject-confirm">{t('rnd.reject.confirm')}</Button>
        </div>
      </form>
    </DialogFrame>
  );
}
