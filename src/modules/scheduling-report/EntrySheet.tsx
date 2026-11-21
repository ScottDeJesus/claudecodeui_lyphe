import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntryBumps } from '@/modules/scheduling-report/EntryBumps';
import { EntryChosen } from '@/modules/scheduling-report/EntryChosen';
import { EntryOffered } from '@/modules/scheduling-report/EntryOffered';
import { EntryPresses } from '@/modules/scheduling-report/EntryPresses';
import { EntrySheetHead } from '@/modules/scheduling-report/EntrySheetHead';
import { EntryVisitNow } from '@/modules/scheduling-report/EntryVisitNow';
import { TroubleBanner } from '@/modules/scheduling-report/TroubleBanner';
import type { EntrySheetRead } from '@/modules/scheduling-report/utils/schedulingModel';
import { verdictHeading } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry } from '@/shared/scheduling-report-types';
import { Rule, Sheet } from '@/shared/ui';

type EntrySheetProps = {
  /** The entry as the overview listed it, so the head stands while the entry's own read is out; null when the window no longer lists it. */
  summary: SchedulingEntry | null;
  /** The entry's own read. */
  sheet: EntrySheetRead;
  now: number;
  onClose: () => void;
  onRetry: () => void;
};

/** The sections a sheet draws, in order: all five for a form whose report has arrived, and the three that are not the report's for every other entry. */
const WITH_REPORT = ['bumps', 'offered', 'chosen', 'presses', 'visit'] as const;
const WITHOUT_REPORT = ['bumps', 'presses', 'visit'] as const;

/**
 * ONE ENTRY, in the shared Sheet over the tab: one at a time, closed by Escape, its ✕ or a press on the scrim.
 *
 * Its heading is the verdict as a plain sentence ("This session hit a speed bump"), with no accent word: the Sheet paints
 * an accent in the accent green, and a state must not be said in a colour that is not its tone. The verdict's badge,
 * right under the heading, carries the tone. Under it the head (what happened in one sentence, then the facts), then five
 * sections in the order a person asks them: what stood against it (Speed bumps), what the form put in front of them
 * (What Restorly offered), what they picked (What was chosen), what the server answered each time (Each press and its
 * answer), and what became of the visit (The visit now).
 *
 * A DIRECT ENTRY HAS NO FORM, so it draws three: its speed bumps, its one press and the visit now. A FORM WHOSE REPORT
 * HAS NOT ARRIVED (still open, or never reported) draws the same three, and its head says in one line why the other two
 * are not known: two empty sections would say less than that line.
 *
 * THE STATES. While the entry's own read is out, the head already stands from the overview's row and the sections are
 * drawn as their Rules over shimmering rows, so nothing moves when the answer lands. When that read failed, the lane's
 * own sentence stands under the head with Try again, and no section is drawn empty in its place. READ-ONLY: the sheet has
 * no footer, since Cerberus books, changes and cancels nothing.
 *
 * Used by this module's root, `SchedulingView`, which mounts it only while an entry is open and the view is shown.
 */
export function EntrySheet({ summary, sheet, now, onClose, onRetry }: EntrySheetProps) {
  const { t } = useTranslation();
  const s = 'cerberus.scheduling.sheet';
  const whole = sheet.whole;
  const entry = whole?.entry ?? summary;
  const heading = entry === null ? t(`${s}.heading.reading`) : verdictHeading(t, entry);
  // What the skeleton stands in for: the sections that will land, so none appears or goes when the answer does. Only a form
  // whose report is held brings all five; an entry the window no longer lists is read as one.
  const waiting = entry !== null && entry.state !== 'reported' ? WITHOUT_REPORT : WITH_REPORT;

  return (
    <Sheet open onClose={onClose} title={heading} width="min(680px, 100%)">
      <div className="flex min-w-0 flex-col gap-[22px] pb-safe-area-inset-bottom" data-scheduling-sheet={sheet.phase}>
        {entry !== null && <EntrySheetHead entry={entry} now={now} />}

        {sheet.phase === 'trouble' ? (
          // The entry's read failed: the lane's sentence and the way back. The head above, from the overview, still stands.
          <div role="alert">
            <TroubleBanner title={t(`${s}.trouble`)} detail={sheet.trouble} retry={t('cerberus.scheduling.trouble.retry')} onRetry={onRetry} />
          </div>
        ) : whole === null || entry === null ? (
          // The entry's read is out: the Rules over shimmering rows, shaped as what will land under each.
          <div aria-busy="true" className="flex flex-col gap-[22px]">
            {waiting.map((section) => (
              <SheetSection key={section} title={t(`${s}.${section}.title`)}>
                {(section === 'offered' || section === 'chosen' ? [0, 1, 2] : [0, 1]).map((row) => <div key={row} className="vv-skeleton h-7" />)}
              </SheetSection>
            ))}
          </div>
        ) : (
          <>
            <SheetSection title={t(`${s}.bumps.title`)}><EntryBumps entry={entry} /></SheetSection>
            {whole.session !== null && (
              <>
                <SheetSection title={t(`${s}.offered.title`)}><EntryOffered session={whole.session} /></SheetSection>
                <SheetSection title={t(`${s}.chosen.title`)}><EntryChosen session={whole.session} lead={entry.lead} /></SheetSection>
              </>
            )}
            <SheetSection title={t(`${s}.presses.title`)}><EntryPresses acts={whole.acts} unanswered={whole.session?.unanswered ?? 0} /></SheetSection>
            <SheetSection title={t(`${s}.visit.title`)}><EntryVisitNow visit={whole.visit_now} after={whole.after} /></SheetSection>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** One of the sheet's sections: its Rule, then what it holds. */
function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
      <Rule id={headingId}>{title}</Rule>
      {children}
    </section>
  );
}
