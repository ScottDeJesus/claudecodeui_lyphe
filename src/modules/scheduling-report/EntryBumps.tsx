import { BotIcon, CircleCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isUndoPress, REASON_ICON, reasonWords } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry, SchedulingReason } from '@/shared/scheduling-report-types';

/**
 * SPEED BUMPS: every reason that stands against the entry, worst first, each as a whole sentence with its count or its
 * detail. The icon's shape says how bad (an octagon for what failed, a triangle for what was refused or went missing), so
 * the tone is never the only sign. With none, the one line says it went clean.
 *
 * WHAT IS ONLY NOTED COMES AFTER, UNDER ITS OWN WORD. A neutral reason (the calendar was paused, the lead was not the
 * best fit, a time of their own was chosen) is never a speed bump: it is listed below, in grey with the circled i, so a
 * clean session can still say what was unusual about it without being drawn as trouble.
 *
 * AN UNDO'S OWN SPEED BUMP IS THAT IT WAS AN UNDO. The server answers an Undo press as a speed bump with the one reason
 * `undone`; here that reason reads "This press was an Undo.", since the usual sentence would say the Undo was undone.
 *
 * A MACHINE'S CALL IS NEVER DRAWN CLEAN OR BUMPED, here as on its row. With no reason it says nothing stood against it,
 * in grey under the machine mark; its reasons keep their shapes and lose their colours.
 *
 * Used by this module's `EntrySheet`, as its first section.
 */
export function EntryBumps({ entry }: { entry: SchedulingEntry }) {
  const { t } = useTranslation();
  const b = 'cerberus.scheduling.sheet.bumps';
  const machine = entry.actor_kind === 'machine';
  const bumps = entry.reasons.filter((reason) => reason.tone !== 'neutral');
  const notes = entry.reasons.filter((reason) => reason.tone === 'neutral');
  const CleanIcon = machine ? BotIcon : CircleCheckIcon;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-scheduling-bumps={bumps.length}>
      {bumps.length === 0 ? (
        <p className="m-0 flex items-center gap-2 text-[13.5px] text-foreground" data-tone={machine ? 'neutral' : 'positive'}>
          <CleanIcon className="h-4 w-4 flex-none text-tone-ink" aria-hidden="true" />
          {t(machine ? `${b}.noneMachine` : `${b}.none`)}
        </p>
      ) : (
        <ReasonLines reasons={bumps} quiet={machine} ownUndo={isUndoPress(entry)} />
      )}
      {notes.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2" data-scheduling-notes={notes.length}>
          <p className="m-0 text-xs text-muted-foreground">{t(`${b}.noted`)}</p>
          <ReasonLines reasons={notes} quiet ownUndo={false} />
        </div>
      )}
    </div>
  );
}

/** The reasons as sentences, one a line, each led by its tone's icon; `quiet` greys them (a note, or a machine's), and `ownUndo` says the entry is itself an Undo press. */
function ReasonLines({ reasons, quiet, ownUndo }: { reasons: SchedulingReason[]; quiet: boolean; ownUndo: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0">
      {reasons.map((reason) => {
        const Icon = REASON_ICON[reason.tone] ?? REASON_ICON.neutral;
        return (
          <li key={reason.code} data-tone={quiet ? 'neutral' : reason.tone} data-scheduling-reason={reason.code} className="flex min-w-0 items-start gap-2.5 text-[13.5px] leading-snug text-foreground">
            <Icon className="mt-0.5 h-4 w-4 flex-none text-tone-ink" aria-hidden="true" />
            <span className="min-w-0 break-words">{reasonWords(t, reason, ownUndo).sentence}</span>
          </li>
        );
      })}
    </ul>
  );
}
