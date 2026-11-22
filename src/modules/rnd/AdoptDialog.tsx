import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RndCandidate } from '@/shared/rnd-types';
import { Banner, Button, DialogFrame, Field, Input, Select } from '@/shared/ui';

/** An epic a candidate can be adopted under: its name on the roadmap, its title, and the milestone it stands on. */
export type RndEpicChoice = { name: string; title: string; milestone: string };

type AdoptDialogProps = {
  candidate: RndCandidate;
  /** The roadmap's epics, in the roadmap's own order. */
  epics: RndEpicChoice[];
  /** The adoption is out: both presses and the way back wait. */
  busy: boolean;
  /** The dispatcher's sentence for an adoption it refused, or null. */
  refusal: string | null;
  /** Called with the epic's name and his goal words, trimmed; null when he gave none. */
  onAdopt: (arc: string, goal: string | null) => void;
  onClose: () => void;
};

/**
 * ADOPT A PROVED CANDIDATE: one question, under which epic. Every feature enters through the roadmap, so adopting is choosing
 * where on it this one stands; the dialog says first what adopting does (it becomes an idea there, and its question, verdict and
 * evidence go with it).
 *
 * ADOPT WAITS FOR AN EPIC. His goal words are optional and say so under the field. A roadmap with no epic says so in place of the
 * list, with where to make one, and the press stays held.
 *
 * A refusal of the dispatcher's is said above the presses in its own sentence, and the dialog stays open on what he chose.
 * Mounted only while it is open, so every opening starts clean.
 *
 * Rendered by RndPanel inside the open candidate, while Adopt is being asked.
 */
export function AdoptDialog({ candidate, epics, busy, refusal, onAdopt, onClose }: AdoptDialogProps) {
  const { t } = useTranslation();
  const goalId = useId();
  const [epic, setEpic] = useState('');
  const [goal, setGoal] = useState('');
  const trimmed = goal.trim();

  return (
    <DialogFrame size="md" title={t('rnd.adopt.title')} accent={{ words: t('rnd.adopt.accent') }} busy={busy} onDismiss={onClose} data-rnd-dialog="adopt">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (epic !== '' && !busy) onAdopt(epic, trimmed === '' ? null : trimmed);
        }}
      >
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{t('rnd.adopt.about', { title: candidate.title })}</p>
        {epics.length === 0 ? (
          <Banner tone="info">{t('rnd.adopt.noEpics')}</Banner>
        ) : (
          <>
            <Field label={t('rnd.adopt.epic')}>
              <Select
                ariaLabel={t('rnd.adopt.epic')}
                placeholder={t('rnd.adopt.epicPlaceholder')}
                options={epics.map((choice) => ({ value: choice.name, label: choice.title, hint: choice.milestone }))}
                value={epic}
                onChange={setEpic}
                disabled={busy}
              />
            </Field>
            <Field label={t('rnd.adopt.goal')} htmlFor={goalId} helper={t('rnd.adopt.goalHelper')}>
              <Input
                id={goalId}
                value={goal}
                disabled={busy}
                aria-describedby={goalId + '-helper'}
                className="finger:h-11"
                onChange={(event) => setGoal(event.target.value)}
              />
            </Field>
          </>
        )}
        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button type="button" variant="ghost" className="finger:h-11" disabled={busy} onClick={onClose}>{t('rnd.adopt.cancel')}</Button>
          <Button type="submit" className="finger:h-11" busy={busy} disabled={epic === ''} data-rnd-act="adopt-confirm">{t('rnd.adopt.confirm')}</Button>
        </div>
      </form>
    </DialogFrame>
  );
}
