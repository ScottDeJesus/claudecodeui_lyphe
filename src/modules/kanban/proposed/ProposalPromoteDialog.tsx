import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { BugProposal, ProposalEpicChoice, ProposalEpicsReading } from '@/shared/types';
import { Banner, Button, DialogFrame, Field, Select, Spinner } from '@/shared/ui';

/**
 * PROMOTE TO THE ROADMAP: one question, which epic. The proposal becomes an idea under it, and nothing is designed
 * until the operator sends it to design, which the dialog says before it asks.
 *
 * ONE `Select` OF EVERY EPIC, in the roadmap's own order, so the epics of one milestone stand together; each says
 * its roadmap and milestone beside its title, because two roadmaps may each hold an epic of the same name. Beside a
 * title they are cut short on a phone, so the chosen epic's roadmap and milestone are said whole under the field.
 *
 * THE ROADMAP IS READ WHEN THE DIALOG OPENS, and each of its readings is drawn where the `Select` would stand: the
 * ring while it is read; a sentence and Try again when it did not answer; a sentence that says where to add an epic
 * when there is none. In all three the Promote press waits, and Cancel never does.
 *
 * PROMOTE WAITS FOR A CHOICE. Nothing is chosen for the reader: an idea filed under the wrong epic is work to undo.
 * A refusal of the roadmap's is said above the presses in its own sentence, and the dialog stays open on the choice.
 *
 * Mounted only while it is open (`DialogFrame`), so every opening starts with no epic chosen.
 */

type ProposalPromoteDialogProps = {
  proposal: BugProposal;
  /** The promote is out: both presses and the ✕ wait. */
  busy: boolean;
  /** The roadmap's sentence for a promote it refused, or `null`. */
  refusal: string | null;
  /** Called with the chosen epic's name. */
  onPromote: (epic: string) => void;
  onClose: () => void;
};

/** Rendered by ProposedFeatures while a proposal is being promoted. Nothing else mounts it. */
export function ProposalPromoteDialog({ proposal, busy, refusal, onPromote, onClose }: ProposalPromoteDialogProps) {
  const { t } = useTranslation();
  // The epic chosen so far, by name; empty until the reader picks one, which is what Promote waits for.
  const [epic, setEpic] = useState('');

  // A failed read is not repeated on its own: only Try again bumps this, so the roadmap is read once more.
  const [attempt, setAttempt] = useState(0);
  const [epics, setEpics] = useState<ProposalEpicsReading>({ status: 'loading' });

  useEffect(() => {
    // An answer that lands after the dialog closed has no picker left to draw it, so it is dropped.
    let cancelled = false;
    const read = async (): Promise<ProposalEpicsReading> => {
      try {
        const response = await api.roadmap.picture();
        const flattened = response.ok ? epicChoices(await response.json()) : null;
        return flattened === null ? { status: 'unreachable' } : { status: 'ready', epics: flattened };
      } catch (error) {
        console.error('Error reading the roadmap for the promote dialog:', error);
        return { status: 'unreachable' };
      }
    };
    void read().then((next) => {
      if (!cancelled) setEpics(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retryEpics = () => {
    setEpics({ status: 'loading' });
    setAttempt((held) => held + 1);
  };

  const choices = epics.status === 'ready' ? epics.epics : [];
  const chosen = choices.find((choice) => choice.name === epic);

  const picker = () => {
    if (epics.status === 'loading') return <Spinner label={t('kanban.proposed.promoteDialog.loading')} />;
    if (epics.status === 'unreachable') {
      return (
        <Banner
          tone="warn"
          action={<Button variant="outline" size="sm" className="shrink-0 finger:h-11" onClick={retryEpics}>{t('kanban.proposed.promoteDialog.retry')}</Button>}
        >
          {t('kanban.proposed.promoteDialog.unreachable')}
        </Banner>
      );
    }
    if (choices.length === 0) return <Banner tone="info">{t('kanban.proposed.promoteDialog.noEpics')}</Banner>;
    return (
      <Field
        label={t('kanban.proposed.promoteDialog.epic')}
        // Once an epic is chosen its roadmap and milestone are said whole under the field: beside the title they are cut short on a phone.
        helper={chosen === undefined
          ? t('kanban.proposed.promoteDialog.epicHelper')
          : t('kanban.proposed.promoteDialog.epicChosen', { roadmap: chosen.roadmap, milestone: chosen.milestone })}
      >
        <Select
          ariaLabel={t('kanban.proposed.promoteDialog.epic')}
          placeholder={t('kanban.proposed.promoteDialog.epicPlaceholder')}
          options={choices.map((choice) => ({
            value: choice.name,
            label: choice.title,
            hint: t('kanban.proposed.promoteDialog.epicHint', { roadmap: choice.roadmap, milestone: choice.milestone }),
          }))}
          value={epic}
          disabled={busy}
          onChange={setEpic}
        />
      </Field>
    );
  };

  return (
    <DialogFrame
      size="md"
      title={t('kanban.proposed.promoteDialog.title')}
      accent={{ words: t('kanban.proposed.promoteDialog.accent') }}
      busy={busy}
      onDismiss={onClose}
      data-proposal-dialog="promote"
    >
      <div className="flex flex-col gap-5">
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{t('kanban.proposed.promoteDialog.about', { title: proposal.title })}</p>
        {picker()}
        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" className="finger:h-11" disabled={busy} onClick={onClose}>{t('kanban.proposed.promoteDialog.cancel')}</Button>
          <Button className="finger:h-11" busy={busy} disabled={epic === ''} onClick={() => onPromote(epic)}>{t('kanban.proposed.promoteDialog.confirm')}</Button>
        </div>
      </div>
    </DialogFrame>
  );
}

/**
 * The roadmap's epics, flattened in the roadmap's own order. An epic under no milestone is left out: an idea must
 * stand on a milestone a roadmap reaches. Null when the body has no roadmaps, which is the lane's answer until it
 * has read the dispatcher.
 */
function epicChoices(body: unknown): ProposalEpicChoice[] | null {
  if (!isRecord(body) || !Array.isArray(body.roadmaps)) return null;
  const choices: ProposalEpicChoice[] = [];
  for (const roadmap of body.roadmaps) {
    if (!isRecord(roadmap) || typeof roadmap.name !== 'string' || typeof roadmap.title !== 'string') continue;
    if (!Array.isArray(roadmap.milestones)) continue;
    for (const milestone of roadmap.milestones) {
      if (!isRecord(milestone) || typeof milestone.name !== 'string' || typeof milestone.title !== 'string') continue;
      if (!Array.isArray(milestone.epics)) continue;
      for (const epic of milestone.epics) {
        if (!isRecord(epic) || typeof epic.name !== 'string' || typeof epic.title !== 'string') continue;
        choices.push({ name: epic.name, title: epic.title, roadmap: roadmap.title, milestone: milestone.title });
      }
    }
  }
  return choices;
}

/** A non-null object, so a wire body can be read field by field; each field is then checked by its own type. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
