import { ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { soulName, stageRunning, type KanbanWalkStage } from '@/modules/kanban/utils/walkModel';
import { spendText } from '@/shared/spend';
import { Button, SignalLoop } from '@/shared/ui';

/**
 * WHO DID A STEP, HOW IT CAME OUT, WHAT IT SPENT, AND THE WAY TO READ ALL OF IT.
 *
 * One line per sitting, under the step it belongs to: the soul by name, the stage as the walk
 * names it, how it ended, its spend, and one press that opens its transcript. A step that went
 * round twice (a fix after a failed review) has two lines, in the order they ran, so the rounds
 * are counted by reading down.
 *
 * WORK IS MOTION AND A WORD, NEVER A COLOUR ALONE. A sitting still out wears the house loop and
 * "Working". One that has ended says its own closing word as it wrote it, in plain ink: a verdict
 * is the soul's sentence, and this screen does not grade it. The one toned thing here is a sitting
 * that ended without finishing, because that is the line that explains a card that has stopped.
 *
 * SPEND IS READ THE HOUSE'S ONE WAY (`spendText`): dollars where a vendor billed, tokens where the
 * subscription paid, and nothing at all where there is no figure. Never a `$0.00`.
 *
 * THE TRANSCRIPT IS ONE PRESS AWAY AND NOT ON THE CARD: its mark alone (the lines of a page), its
 * words its name. 44 px under a finger; a sitting that was never launched has no transcript and
 * so has no press.
 */

type DrawerStepStagesProps = {
  stages: KanbanWalkStage[];
  /** Opens one sitting's transcript. The shell owns where it is read. */
  onRead: (stage: KanbanWalkStage) => void;
};

/** Rendered by DrawerChecklist under a step, and under the list for sittings no step claims. */
export function DrawerStepStages({ stages, onRead }: DrawerStepStagesProps) {
  const { t } = useTranslation();
  if (stages.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1 pt-1" data-step-stages>
      {stages.map((stage, index) => {
        const running = stageRunning(stage);
        const name = soulName(stage.soul);
        const spend = spendText(t, stage.cost_usd, stage.tokens_in, stage.tokens_out, stage.tokens, stage.paid_vendor ?? null);
        const endedEarly = !running && stage.status !== 'done';
        const transcript = t('kanban.stages.transcriptOf', { soul: name, stage: stage.name });

        return (
          // The index is part of the key: a stage a walk re-enters keeps its name.
          <li key={`${stage.name}-${index}`} className="flex min-w-0 items-center gap-2 text-xs leading-[17px]" data-stage={stage.name}>
            {/* The words wrap among themselves and the press keeps the row's right edge at every width, so a column of sittings
                is a column of presses a thumb finds in one place. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
              {running && <SignalLoop state="working" signal="secondary" size={12} />}
              <span className="text-foreground">{name}</span>
              <span className="bug-figure">{stage.name}</span>
              {running && <span className="text-muted-foreground">{t('kanban.stages.working')}</span>}
              {!running && stage.verdict && <span className="min-w-0 break-words text-muted-foreground">{stage.verdict}</span>}
              {endedEarly && (
                <span className="flex items-center gap-1 text-[var(--warn-ink)]">
                  <span aria-hidden="true">▲</span>
                  {t('kanban.stages.endedEarly', { status: stage.status })}
                </span>
              )}
              <span className="bug-figure ml-auto">{spend}</span>
            </div>
            {stage.launch_id !== null && (
              <Button variant="outline" size="icon" className="size-7 shrink-0 finger:size-11" aria-label={transcript} title={transcript} onClick={() => onRead(stage)}>
                <ScrollText aria-hidden="true" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
