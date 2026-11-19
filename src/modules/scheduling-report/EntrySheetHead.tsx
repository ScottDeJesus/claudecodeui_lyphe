import { useTranslation } from 'react-i18next';

import { FactList } from '@/modules/scheduling-report/FactList';
import type { Fact } from '@/modules/scheduling-report/FactList';
import { agoWord, dayClockWord, durationWord, endingSentence, jobWord, openerWord, surfaceWord, verdictLook, whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry } from '@/shared/scheduling-report-types';
import { Badge, Banner } from '@/shared/ui';

type EntrySheetHeadProps = {
  /** The entry: as the overview listed it until its own read answers, then as that read holds it. */
  entry: SchedulingEntry;
  now: number;
};

/**
 * THE SHEET'S HEAD: the entry in one screen, before any section. It stands from the overview's row the moment the sheet
 * opens, so the reader has the verdict while the entry's own read is still out.
 *
 * Top to bottom: the verdict as word, tone and icon beside the one sentence of what happened ("A visit was booked, then
 * undone."); then the facts: who pressed and when, the job, the door the form was opened from (or, with no form, the
 * surface the change was made on), and how long the form was open.
 *
 * THREE KINDS OF ENTRY SAY WHAT THEY ARE, in one line under the facts. A form still open says its report arrives when it
 * closes. A form whose report never arrived says what is therefore not known, in the warn tone, since that is itself a
 * speed bump. A machine's call says it is in no figure of the view.
 *
 * NOT YET IS NOT NEVER. A form still open has no door and no length to show, and its two facts say "not known yet"; only
 * a form whose report never came says "not reported". The same words for both made an open form read as a fault.
 *
 * Used by this module's `EntrySheet`, as its first block.
 */
export function EntrySheetHead({ entry, now }: EntrySheetHeadProps) {
  const { t } = useTranslation();
  const s = 'cerberus.scheduling.sheet';
  const look = verdictLook(t, entry);
  const machine = entry.actor_kind === 'machine';
  const stillOpen = entry.state === 'open';

  const facts: Fact[] = [
    { label: t(`${s}.facts.who`), parts: [whoWord(t, entry.actor), dayClockWord(entry.started_at), agoWord(t, entry.started_at, now)] },
    { label: t(`${s}.facts.job`), parts: [jobWord(t, entry.job), ...(entry.job?.loss_type ? [entry.job.loss_type] : [])] },
    entry.form
      ? { label: t(`${s}.facts.door`), parts: [entry.opener === null ? t(stillOpen ? `${s}.facts.notYet` : `${s}.facts.doorNone`) : openerWord(t, entry.opener)] }
      : { label: t(`${s}.facts.made`), parts: [entry.surface === null ? t(`${s}.facts.doorNone`) : surfaceWord(t, entry.surface)] },
    ...(entry.form ? [{ label: t(`${s}.facts.formOpen`), parts: [entry.open_seconds === null ? t(stillOpen ? `${s}.facts.notYet` : `${s}.facts.formOpenNone`) : durationWord(t, entry.open_seconds * 1000)] }] : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-scheduling-sheet-head data-scheduling-entry={entry.id}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Badge as="span" tone={look.tone} className="flex-none">
          <look.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
          {look.word}
        </Badge>
        <p className="m-0 min-w-0 break-words text-[15px] font-medium leading-snug text-foreground" data-scheduling-ending>{endingSentence(t, entry)}</p>
      </div>

      <FactList facts={facts} />

      {machine && <Banner tone="neutral"><p className="text-[13px]">{t(`${s}.note.machine`)}</p></Banner>}
      {!machine && stillOpen && <Banner tone="info"><p className="text-[13px]">{t(`${s}.note.open`)}</p></Banner>}
      {!machine && entry.state === 'not_reported' && <Banner tone="warn"><p className="text-[13px]">{t(`${s}.note.notReported`)}</p></Banner>}
    </div>
  );
}
