import { useTranslation } from 'react-i18next';

import { answerLook, calendarLook, clockWord, dayClockWord, pressedWord, spanWord, whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingAct } from '@/shared/scheduling-report-types';
import { Badge } from '@/shared/ui';

type ActLineProps = {
  act: SchedulingAct;
  /** The act belongs to ANOTHER entry (the visit's later history): its line leads with the day and names who pressed, which an entry's own presses leave to the sheet's head. */
  foreign?: boolean;
};

/**
 * ONE PRESS AND ITS ANSWER, as a line of a list. An act is one answered request to a scheduled-visit write route, recorded
 * at the server's own door, so this is what the server saw, not what the form meant.
 *
 * First line: the clock (to the second, since two presses can fall in one minute; the day too for another entry's act),
 * what was pressed and from where ("Pressed Save to book", "Dragged the visit on the grid"), and the answer as a word
 * with its tone and icon: done, refused and why, unavailable, a server fault.
 *
 * Second line, the facts of the answer, in grey: the HTTP status as the number it is, the calendar's word in its own tone
 * (paused, on the calendar, failed and why), "saved with the lead only" when the crew was cut down, the server's own
 * time, and for another entry's act who pressed it.
 *
 * Third line, only when the act carries them: the window it asked for or wrote, the lead by name and how many support,
 * and an edit's touched fields as the field names they are. A refusal's code, a calendar's reason, a name and a field are
 * data, drawn as text.
 *
 * It draws ONE `<li>`; the caller owns the list. Used by this module's `EntryPresses` (the entry's own presses) and
 * `EntryVisitNow` (what later touched the same visit).
 */
export function ActLine({ act, foreign = false }: ActLineProps) {
  const { t } = useTranslation();
  const a = 'cerberus.scheduling.acts';
  const answer = answerLook(t, act);
  const calendar = calendarLook(t, act);
  const crew = [
    ...(act.start_at === null ? [] : [spanWord(t, act.start_at, act.end_at)]),
    ...(act.lead === null ? [] : [act.lead.name === null ? t(`${a}.leadGone`) : t(`${a}.lead`, { name: act.lead.name })]),
    ...(act.support.length === 0 ? [] : [t(`${a}.support`, { count: act.support.length })]),
  ];

  return (
    <li className="flex min-w-0 flex-col gap-1.5 py-3 text-[13px] leading-snug" data-scheduling-act={act.id} data-scheduling-outcome={act.outcome}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex-none font-mono text-xs tabular-nums text-muted-foreground">{foreign ? dayClockWord(act.at) : clockWord(act.at, true)}</span>
        <span className="min-w-0 break-words font-medium text-foreground">{pressedWord(t, act)}</span>
        <Badge as="span" tone={answer.tone} className="min-w-0 whitespace-normal break-words">
          <answer.Icon className="mr-1 h-3 w-3 flex-none" aria-hidden="true" />
          {answer.word}
        </Badge>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{t(`${a}.status`, { status: act.status })}</span>
        {calendar !== null && <Badge as="span" tone={calendar.tone} className="min-w-0 whitespace-normal break-words">{calendar.word}</Badge>}
        {act.crew_downgraded && <Badge as="span" tone="neutral">{t(`${a}.leadOnly`)}</Badge>}
        <span className="tabular-nums">{t(`${a}.latency`, { ms: act.latency_ms })}</span>
        {foreign && <span className="min-w-0 break-words">{t(`${a}.by`, { who: whoWord(t, act.actor) })}</span>}
      </span>
      {crew.length > 0 && <span className="min-w-0 break-words text-xs text-muted-foreground">{crew.join(' · ')}</span>}
      {act.touched.length > 0 && (
        <span className="min-w-0 break-words text-xs text-muted-foreground">
          {t(`${a}.touched`)} <span className="font-mono">{act.touched.join(' · ')}</span>
        </span>
      )}
    </li>
  );
}
