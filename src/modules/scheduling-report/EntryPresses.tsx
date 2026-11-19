import { useTranslation } from 'react-i18next';

import { ActLine } from '@/modules/scheduling-report/ActLine';
import type { SchedulingAct } from '@/shared/scheduling-report-types';

type EntryPressesProps = {
  /** The entry's acts, oldest first. */
  acts: SchedulingAct[];
  /** Presses the form counted that got no HTTP answer: the server has no act for them. 0 with no report. */
  unanswered: number;
};

/**
 * EACH PRESS AND ITS ANSWER: every act of the entry, oldest first, one line each (`ActLine`): the clock, what was pressed
 * and from where, the answer in words with its status, the calendar's word, the lead-only note and the server's time.
 * The booked-then-undone session reads here as its two lines, Save then Undo.
 *
 * WHAT THE SERVER NEVER SAW IS SAID, NOT LEFT OUT. A press that got no answer left no act, so it cannot be a line: the
 * form's own count of them is one sentence under the list, so the lines and the form's count of presses never seem to
 * disagree. It is said in grey: the alarm for it is the red sentence under Speed bumps, and one fact is red once. With no
 * press at all (a form opened and closed) the section says so in one dashed line, never an empty box.
 *
 * Used by this module's `EntrySheet`, as its fourth section; a direct entry's one press is drawn by the same list.
 */
export function EntryPresses({ acts, unanswered }: EntryPressesProps) {
  const { t } = useTranslation();
  const p = 'cerberus.scheduling.sheet.presses';

  return (
    <div className="flex min-w-0 flex-col gap-2.5" data-scheduling-presses={acts.length}>
      {acts.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground">{t(`${p}.none`)}</p>
      ) : (
        <ol className="m-0 flex min-w-0 list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
          {acts.map((act) => <ActLine key={act.id} act={act} />)}
        </ol>
      )}
      {unanswered > 0 && <p className="m-0 text-xs text-muted-foreground" data-scheduling-unanswered={unanswered}>{t(`${p}.unanswered`, { count: unanswered })}</p>}
    </div>
  );
}
