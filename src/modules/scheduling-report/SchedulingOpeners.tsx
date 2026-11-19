import { useTranslation } from 'react-i18next';

import { openerWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry, SchedulingOverview } from '@/shared/scheduling-report-types';

type SchedulingOpenersProps = {
  /** Each door the form was opened from, with how many of the listed entries started there. */
  openers: SchedulingOverview['openers'];
  /** The listed entries: the ones with no form, and the forms that have not reported, are counted from them. */
  entries: SchedulingEntry[];
};

/**
 * WHERE IT STARTS: the doors the Schedule-a-visit form is opened from, most used first. Each door is one line: its name
 * as Restorly's reader knows it, and how many forms were opened there out of all that named a door ("5 of 22").
 *
 * WORDS AND A NUMBER, NO BAR. The order is the comparison, and the count says compared to what. A bar a line was tried
 * and taken out: the kit's meter fills in the accent, a warm orange that sits beside How often's amber speed bumps and
 * read as ten more of them, on a view whose one colour to notice is that amber.
 *
 * THE COUNTS ADD UP IN WORDS. A form names its door in its report, so two kinds of entry are in no line above: a change
 * made with no form (on the grid, by Undo, through the API), and a form whose report has not arrived. Each is said in one
 * sentence under the list, only when there are any, so the lines and the Sessions count never seem to disagree.
 *
 * With no form opened in the window the list is one sentence; a door this build has no name for is drawn as its own word.
 *
 * Used by this module's `SchedulingBody`, at the foot of the left column.
 */
export function SchedulingOpeners({ openers, entries }: SchedulingOpenersProps) {
  const { t } = useTranslation();
  const o = 'cerberus.scheduling.starts';
  // Most used first, whatever order the answer came in; doors that tie keep the answer's order.
  const ordered = [...openers].sort((a, b) => b.entries - a.entries);
  const total = ordered.reduce((sum, row) => sum + row.entries, 0);
  const direct = entries.filter((entry) => !entry.form).length;
  const unreported = entries.filter((entry) => entry.form && entry.opener === null).length;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-scheduling-openers>
      {ordered.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground">{t(`${o}.none`)}</p>
      ) : (
        <ul className="m-0 flex min-w-0 list-none flex-col divide-y divide-border rounded-lg border border-border p-0">
          {ordered.map((row) => (
            <li key={row.opener} className="flex min-w-0 items-baseline justify-between gap-3 px-3 py-2 text-[13px]" data-scheduling-opener={row.opener}>
              <span className="min-w-0 break-words text-foreground">{openerWord(t, row.opener)}</span>
              <span className="flex-none text-xs tabular-nums text-muted-foreground">{t(`${o}.share`, { count: row.entries, total })}</span>
            </li>
          ))}
        </ul>
      )}
      {direct > 0 && <p className="m-0 text-xs text-muted-foreground" data-scheduling-openers-direct>{t(`${o}.direct`, { count: direct })}</p>}
      {unreported > 0 && <p className="m-0 text-xs text-muted-foreground" data-scheduling-openers-unreported>{t(`${o}.unreported`, { count: unreported })}</p>}
    </div>
  );
}
