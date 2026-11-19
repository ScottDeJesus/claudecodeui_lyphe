import { useTranslation } from 'react-i18next';

import { FactList } from '@/modules/scheduling-report/FactList';
import type { Fact } from '@/modules/scheduling-report/FactList';
import type { SchedulingSession } from '@/shared/scheduling-report-types';

/**
 * WHAT RESTORLY OFFERED: what the form put in front of the person at their last press (or at close, when nothing was
 * pressed), from the form's own report. Facts, not judgments: what went wrong among them is already a sentence under
 * Speed bumps, so nothing here is toned.
 *
 * The lines, in the order the form shows them: how many people were on the list and how many were free (or that nobody
 * was offered, or that who was free could not be read); the best fit by name; who the crew check left out, as a count,
 * and whether its line was amber; the open times, as a count, or that none came back, or that they are off; whether
 * drive times were checked; and the sizing hint (how many people, for how many hours).
 *
 * A person's name is data; a best fit the roster no longer holds says so, never a blank.
 *
 * Used by this module's `EntrySheet`, as its second section, for a form entry whose report has arrived.
 */
export function EntryOffered({ session }: { session: SchedulingSession }) {
  const { t } = useTranslation();
  const o = 'cerberus.scheduling.sheet.offered';
  const { offered, best_fit: bestFit } = session;

  const facts: Fact[] = [
    {
      label: t(`${o}.people`),
      parts: offered.none_offered
        ? [t(`${o}.nobody`)]
        : [t(`${o}.onList`, { count: offered.roster_count }), offered.availability_unread ? t(`${o}.freeUnread`) : t(`${o}.free`, { count: offered.available_count })],
    },
    { label: t(`${o}.bestFit`), parts: [bestFit === null ? t(`${o}.bestFitNone`) : bestFit.name ?? t(`${o}.bestFitGone`)] },
    {
      label: t(`${o}.crewCheck`),
      parts: [offered.left_out_count === 0 ? t(`${o}.leftOutNone`) : t(`${o}.leftOut`, { count: offered.left_out_count }), ...(offered.gate_warn ? [t(`${o}.gateWarn`)] : [])],
    },
    { label: t(`${o}.times`), parts: [!offered.slots_on ? t(`${o}.timesOff`) : offered.slots_count === 0 ? t(`${o}.timesNone`) : t(`${o}.timesCount`, { count: offered.slots_count })] },
    { label: t(`${o}.travel`), parts: [t(offered.travel_checked ? `${o}.travelChecked` : `${o}.travelNot`)] },
    {
      label: t(`${o}.hint`),
      parts: offered.hint_crew === null && offered.hint_hours === null
        ? [t(`${o}.hintNone`)]
        : [...(offered.hint_crew === null ? [] : [t(`${o}.hintCrew`, { count: offered.hint_crew })]), ...(offered.hint_hours === null ? [] : [t(`${o}.hintHours`, { hours: offered.hint_hours })])],
    },
  ];

  return <div data-scheduling-offered><FactList facts={facts} /></div>;
}
