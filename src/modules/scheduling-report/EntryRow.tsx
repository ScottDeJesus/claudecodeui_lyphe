import { HourglassIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { dayClockWord, durationWord, isUndoPress, jobWord, reasonWords, resultWord, surfaceWord, verdictLook, whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry } from '@/shared/scheduling-report-types';
import { Badge } from '@/shared/ui';

type EntryRowProps = {
  entry: SchedulingEntry;
  onOpenEntry: (id: string) => void;
};

/** How many reasons a row names before the rest are counted: the worst three, since the wire sends them worst first. */
const REASON_CHIPS = 3;

/**
 * ONE SESSION AS A ROW. The whole row is the press that opens the entry's sheet, at least 44 px tall; everything inside
 * it is a span, so nothing pressable is nested.
 *
 * The verdict leads, as a word with its tone and its icon, since "did it go well" is the question a list of sessions is
 * scanned for. Then the job (customer and project number) with the date and clock at the row's end. Under it, how it
 * ended in the full ink (Booked, Changed, Cancelled, Closed without booking; "Booked, then undone" when an Undo took it
 * back, as the sheet says it), then who pressed, the lead by name and how long the form was open. Last the marks: up to three reasons, worst first, then "+N"; "form still open" on an entry
 * whose form has not closed; and on a direct entry the surface it was made on (Dragged on the grid, Resized on the grid,
 * Undo, Through the API), which is all that says no form was used.
 *
 * A SPEED BUMP IS RINGED, A NOTE IS GREY. A reason that stands against the entry is a chip ringed in its tone, amber or
 * red; a reason that is only noted (not the best fit, a time of their own, the calendar paused) is the grey badge the
 * surface word wears. So down a list of clean rows nothing is ringed, and the eye stops only where something went wrong.
 *
 * AN UNDO'S OWN ROW SAYS UNDO ONCE. The server gives the Undo press itself the `undone` reason, and its result word
 * ("Undone") and its surface badge ("Undo") already say what it was, so that reason is not drawn a third time.
 *
 * A MACHINE'S ENTRY IS DRAWN QUIET: its mark is the neutral "Machine call" and all its reasons are grey, so it can never
 * be counted with people's sessions by eye. A customer, a login, a person's name and a reason's detail are data and reach
 * the row as text.
 *
 * It draws ONE `<li>`; the caller owns the `<ul>`. Used by this module's `EntryList` (the Sessions section) and
 * `SchedulingKindList` (the sessions a kind opens to).
 */
export function EntryRow({ entry, onOpenEntry }: EntryRowProps) {
  const { t } = useTranslation();
  const r = 'cerberus.scheduling.sessions';
  const look = verdictLook(t, entry);
  const machine = entry.actor_kind === 'machine';
  const reasons = isUndoPress(entry) ? entry.reasons.filter((reason) => reason.code !== 'undone') : entry.reasons;
  const more = reasons.length - REASON_CHIPS;
  const job = jobWord(t, entry.job);
  const when = dayClockWord(entry.started_at);
  const result = resultWord(t, entry);
  const stillOpen = entry.state === 'open';

  return (
    <li className="min-w-0" data-scheduling-entry={entry.id} data-scheduling-verdict={machine ? 'machine' : entry.verdict} data-scheduling-state={entry.state}>
      <button
        type="button"
        onClick={() => onOpenEntry(entry.id)}
        // One keyboard ring, the app's own outline, drawn INSIDE the row: the list clips what stands outside it.
        className="flex min-h-11 w-full min-w-0 flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-muted focus-visible:[outline-offset:-2px]"
        aria-label={t(`${r}.open`, { verdict: look.word, result, job, when })}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={look.tone} className="flex-none">
            <look.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
            {look.word}
          </Badge>
          <span className="min-w-0 flex-1 basis-40 break-words text-sm font-medium leading-snug text-foreground">{job}</span>
          <span className="flex-none font-mono text-xs tabular-nums text-muted-foreground">{when}</span>
        </span>
        <span className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">{result}</span>
          {' · '}{whoWord(t, entry.actor)}
          {entry.lead !== null && <>{' · '}{entry.lead.name === null ? t(`${r}.leadGone`) : t(`${r}.lead`, { name: entry.lead.name })}</>}
          {entry.open_seconds !== null && <>{' · '}<span className="tabular-nums">{t(`${r}.formOpen`, { length: durationWord(t, entry.open_seconds * 1000) })}</span></>}
        </span>
        {(reasons.length > 0 || stillOpen || entry.surface !== null) && (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {/* Each reason a word in its tone's ink (a machine's, and a neutral one, in the quiet ink), parted by a dot: no box of its own inside the row. */}
            {reasons.slice(0, REASON_CHIPS).map((reason, index) => (
              <span
                key={reason.code}
                data-tone={machine || reason.tone === 'neutral' ? undefined : reason.tone}
                className={machine || reason.tone === 'neutral' ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-tone-ink'}
                data-scheduling-reason-word={reason.code}
              >
                {index > 0 && <span aria-hidden="true" className="mr-1.5 text-muted-foreground">·</span>}
                {reasonWords(t, reason).chip}
              </span>
            ))}
            {more > 0 && <span className="text-xs text-muted-foreground">{t(`${r}.moreReasons`, { count: more })}</span>}
            {stillOpen && (
              <Badge as="span" tone="info" title={t(`${r}.stillOpenTitle`)}>
                <HourglassIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                {t(`${r}.stillOpen`)}
              </Badge>
            )}
            {entry.surface !== null && <Badge as="span" tone="neutral" title={t(`${r}.directTitle`)}>{surfaceWord(t, entry.surface)}</Badge>}
          </span>
        )}
      </button>
    </li>
  );
}
