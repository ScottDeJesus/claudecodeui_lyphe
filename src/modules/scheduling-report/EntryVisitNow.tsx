import { useTranslation } from 'react-i18next';

import { ActLine } from '@/modules/scheduling-report/ActLine';
import { dayClockWord, spanWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingAct, SchedulingVisitNow } from '@/shared/scheduling-report-types';
import { Badge } from '@/shared/ui';

type EntryVisitNowProps = {
  /** The visit as it stands, read through the scheduling module; null when the entry wrote none. */
  visit: SchedulingVisitNow | null;
  /** Later acts on the same visit that belong to other entries, oldest first. */
  after: SchedulingAct[];
};

/**
 * THE VISIT NOW: what became of the visit this entry touched. A session ending is not the visit standing: it may have been
 * moved, cut or cancelled since, by someone else, so this is where "is it still on the schedule" is answered.
 *
 * First the visit as it stands: its status in the visit's own word, its window, its type, and when it was cancelled if
 * it was. A cancelled visit wears the neutral mark with its word; nothing here is good or bad, it is what is so.
 *
 * Then what touched it afterwards: each later act on the same visit from ANOTHER entry (a drag on the grid, another
 * form, the API), oldest first, as the same line the presses use, with its day and who pressed. With none, one sentence
 * says nothing has touched it since.
 *
 * WITH NO VISIT, ONE SENTENCE: an entry that booked nothing wrote no visit, and the section says so, never a blank.
 *
 * Used by this module's `EntrySheet`, as its last section.
 */
export function EntryVisitNow({ visit, after }: EntryVisitNowProps) {
  const { t } = useTranslation();
  const v = 'cerberus.scheduling.sheet.visit';

  if (visit === null) {
    return <p className="m-0 text-[13px] text-muted-foreground" data-scheduling-visit="none">{t(`${v}.none`)}</p>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-scheduling-visit={visit.status}>
      <div className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-snug">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone="neutral" className="flex-none" title={t(`${v}.statusTitle`)}>{visit.status}</Badge>
          <span className="min-w-0 break-words font-medium text-foreground">{spanWord(t, visit.start_at, visit.end_at)}</span>
        </span>
        <span className="min-w-0 break-words text-xs text-muted-foreground">
          {visit.visit_type ?? t(`${v}.noType`)}
          {visit.cancelled_at !== null && <>{' · '}{t(`${v}.cancelledAt`, { when: dayClockWord(visit.cancelled_at) })}</>}
        </span>
      </div>
      {after.length === 0 ? (
        <p className="m-0 text-xs text-muted-foreground" data-scheduling-after="0">{t(`${v}.afterNone`)}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2" data-scheduling-after={after.length}>
          <p className="m-0 text-xs text-muted-foreground">{t(`${v}.after`, { count: after.length })}</p>
          <ol className="m-0 flex min-w-0 list-none flex-col divide-y divide-border border-y border-border p-0">
            {after.map((act) => <ActLine key={act.id} act={act} foreign />)}
          </ol>
        </div>
      )}
    </div>
  );
}
