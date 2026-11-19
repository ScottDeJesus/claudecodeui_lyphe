import { useTranslation } from 'react-i18next';

import { FactList } from '@/modules/scheduling-report/FactList';
import type { Fact } from '@/modules/scheduling-report/FactList';
import { durationWord, leadPlace, spanWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingPerson, SchedulingSession } from '@/shared/scheduling-report-types';

type EntryChosenProps = {
  /** The form's report. */
  session: SchedulingSession;
  /** The entry's lead as the read names them; null when none was chosen. */
  lead: SchedulingPerson | null;
};

const MS_PER_MINUTE = 60_000;

/**
 * WHAT WAS CHOSEN: what the person set in the form at their last press (or had set at close), from the form's own report,
 * each line beside what Restorly had offered for it. This is where "did they take the suggestion" is read.
 *
 * The lines: the lead by name and where they stood on the list ("the best fit", "3rd on the list", "not on the list"),
 * with whether they were shown as free; the support crew and temps, as counts; the window, and whether it was one of the
 * open times offered or a time of their own; the type, and whether it was changed from what the door proposed (and from
 * what); the length, and whether it was stepped by hand; and, only when it happened, that the job was changed from the
 * one the door proposed.
 *
 * Facts, not judgments, so nothing is toned: choosing someone other than the best fit is noted under Speed bumps, in
 * grey, and is nobody's mistake. A name and a visit type are data.
 *
 * Used by this module's `EntrySheet`, as its third section, for a form entry whose report has arrived.
 */
export function EntryChosen({ session, lead }: EntryChosenProps) {
  const { t } = useTranslation();
  const c = 'cerberus.scheduling.sheet.chosen';
  const { chosen, proposal } = session;
  const end = chosen.start_at === null ? null : new Date(Date.parse(chosen.start_at) + chosen.duration_minutes * MS_PER_MINUTE).toISOString();

  const facts: Fact[] = [
    {
      label: t(`${c}.lead`),
      parts: chosen.lead_id === null
        ? [leadPlace(t, chosen)]
        : [lead?.name ?? t(`${c}.leadGone`), leadPlace(t, chosen), ...(chosen.lead_available === null ? [] : [t(chosen.lead_available ? `${c}.leadFree` : `${c}.leadBusy`)])],
    },
    {
      label: t(`${c}.crew`),
      parts: chosen.support_count + chosen.temp_count === 0 ? [t(`${c}.crewNone`)] : [t(`${c}.support`, { count: chosen.support_count }), t(`${c}.temps`, { count: chosen.temp_count })],
    },
    { label: t(`${c}.when`), parts: chosen.start_at === null ? [t(`${c}.whenNone`)] : [spanWord(t, chosen.start_at, end), t(chosen.slot_picked ? `${c}.slotPicked` : `${c}.slotOwn`)] },
    { label: t(`${c}.type`), parts: [chosen.visit_type, !chosen.type_changed ? t(`${c}.typeKept`) : proposal.visit_type === null ? t(`${c}.typeChangedBare`) : t(`${c}.typeChanged`, { from: proposal.visit_type })] },
    { label: t(`${c}.length`), parts: [durationWord(t, chosen.duration_minutes * MS_PER_MINUTE), t(chosen.duration_stepped ? `${c}.lengthStepped` : `${c}.lengthKept`)] },
    ...(chosen.job_changed ? [{ label: t(`${c}.job`), parts: [t(`${c}.jobChanged`)] }] : []),
  ];

  return <div data-scheduling-chosen><FactList facts={facts} /></div>;
}
