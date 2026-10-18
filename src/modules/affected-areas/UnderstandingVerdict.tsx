import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { JudgmentPress, MarkRefusal } from '@/modules/affected-areas/MarkPress';
import { REGION_LOOK } from '@/modules/affected-areas/utils/regionLook';
import type { Mark, UnderstandingMarkRequest } from '@/shared/affected-areas-types';
import { MARK_NOTE_MAX } from '@/shared/constants';
import { Button, TextArea } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

type UnderstandingVerdictProps = {
  /** The verdict whose mark is out, or null; while one is out both presses refuse a second. */
  out: UnderstandingMarkRequest['verdict'] | null;
  /** Why the last press was refused — the engine's reason or the lane's fault — or null. The next press clears it. */
  refusal: string | null;
  /** The mark this session's last press was answered with; null until one is made here. */
  answer: Mark | null;
  /** Wrong was pressed and the field asking what was wrong is open. */
  writing: boolean;
  onRight: () => void;
  /** Opens the field: a Wrong is sent from there, with its note. */
  onWrong: () => void;
  onSendWrong: (note: string) => void;
  onCancelWrong: () => void;
};

/** The field under Wrong, mounted while it is open so each Wrong opens it empty. */
function WrongNote({ sending, onSend, onCancel }: { sending: boolean; onSend: (note: string) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const countId = useId();
  // What is typed: what the reader got wrong, in the operator's words. Sent trimmed with the mark.
  const [draft, setDraft] = useState('');
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sending) onSend(draft.trim());
      }}
    >
      <TextArea
        value={draft}
        rows={3}
        maxLength={MARK_NOTE_MAX}
        autoFocus
        readOnly={sending}
        aria-label={t('affectedAreas.understanding.wrongLabel')}
        aria-describedby={countId}
        placeholder={t('affectedAreas.understanding.wrongPlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={countId} className="text-xs tabular-nums text-muted-foreground">
          {t('affectedAreas.mark.noteCount', { used: draft.length, max: MARK_NOTE_MAX })}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" className="max-md:h-11" busy={sending} onClick={onCancel}>
            {t('buttons.cancel')}
          </Button>
          <JudgmentPress
            type="submit"
            tone={REGION_LOOK.not_a_change.tone}
            glyph={<X aria-hidden="true" />}
            out={sending}
            data-understanding-press="send-wrong"
          >
            {t('affectedAreas.understanding.markWrong')}
          </JudgmentPress>
        </div>
      </div>
    </form>
  );
}

/**
 * RIGHT OR WRONG ON THE UNDERSTANDING: the last block of `UnderstandingCard`, "Is this account right?" with Right
 * and Wrong. Right is one press, one mark. Wrong opens a field for what was wrong, and Mark it wrong sends the mark
 * with that note: the note is what a reader's account is corrected by.
 *
 * Right wears the confirmed area's green and Wrong the set-aside grey (the region-look table), so a green press means
 * the reader was right wherever it stands. Once a press is answered the block says so ("You marked this account
 * wrong just now", with the note); a pano read again later carries no such mark, so it is said for this visit only.
 *
 * Handles: `data-understanding-mark` on the block, `data-understanding-press` on each press (`right`, `wrong`,
 * `send-wrong`).
 *
 * Used by the affected-areas module's `UnderstandingMark`, which holds the presses' state and sends them.
 */
export function UnderstandingVerdict({ out, refusal, answer, writing, onRight, onWrong, onSendWrong, onCancelWrong }: UnderstandingVerdictProps) {
  const { t } = useTranslation();
  const questionId = useId();
  const busy = out !== null;
  const wrong = answer?.verdict === 'understanding_wrong';

  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-3" data-understanding-mark="">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p id={questionId} className="text-[13px] font-medium text-foreground">{t('affectedAreas.understanding.question')}</p>
        <div role="group" aria-labelledby={questionId} className="flex flex-wrap gap-2">
          <JudgmentPress
            tone={REGION_LOOK.confirmed.tone}
            glyph={<Check aria-hidden="true" />}
            out={out === 'understanding_right'}
            busy={busy}
            data-understanding-press="right"
            onClick={onRight}
          >
            {t('affectedAreas.understanding.right')}
          </JudgmentPress>
          <JudgmentPress
            tone={REGION_LOOK.not_a_change.tone}
            glyph={<X aria-hidden="true" />}
            busy={busy || writing}
            aria-expanded={writing}
            data-understanding-press="wrong"
            onClick={onWrong}
          >
            {t('affectedAreas.understanding.wrong')}
          </JudgmentPress>
        </div>
      </div>

      {writing && <WrongNote sending={out === 'understanding_wrong'} onSend={onSendWrong} onCancel={onCancelWrong} />}
      {answer !== null && !writing && (
        <p className="flex min-w-0 items-start gap-1.5 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
          <span aria-hidden="true" data-tone={wrong ? REGION_LOOK.not_a_change.tone : REGION_LOOK.confirmed.tone} className="flex-none font-bold text-tone-ink">
            {wrong ? '✕' : '✓'}
          </span>
          <span>
            {t(wrong ? 'affectedAreas.understanding.markedWrong' : 'affectedAreas.understanding.markedRight', { when: formatRelativeTime(answer.markedAt) })}
            {wrong && answer.note !== null && <> {t('affectedAreas.understanding.markedNote', { note: answer.note })}</>}
          </span>
        </p>
      )}
      {busy && <p role="status" className="sr-only">{t('affectedAreas.mark.sending')}</p>}
      {refusal !== null && <MarkRefusal reason={refusal} />}
    </div>
  );
}
