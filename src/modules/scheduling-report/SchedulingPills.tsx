import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SchedulingPillKey, SchedulingTally } from '@/modules/scheduling-report/utils/schedulingModel';
import { agoWord, verdictLook, whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { Tone } from '@/shared/types';
import { Badge, Pill, PillBar } from '@/shared/ui';
import { cn } from '@/shared/utils';

type SchedulingPillsProps = {
  /** The window's sessions, counted: people's only. */
  tally: SchedulingTally;
  /** The window held more entries than one answer carries, so each count is a floor. */
  truncated: boolean;
  /** The clock the last session's age is counted from, epoch ms. */
  now: number;
  /** Per pill, whether the section it carries the reader to is on the page: none of them over an empty window. */
  canGo: Record<SchedulingPillKey, boolean>;
  /** The pill last pressed, whose section the reader was carried to; null until one is. */
  activePill: SchedulingPillKey | null;
  onSelect: (key: SchedulingPillKey) => void;
};

/** `wrap` marks a value that is a phrase: it may break across lines on a phone, where a fixed pill would run off the edge. `Icon` leads a value whose tone says a verdict, so the colour is not its only sign. */
type PillSpec = { key: SchedulingPillKey; label: string; value: string; tone: Tone; title: string; wrap?: boolean; Icon?: LucideIcon };

/**
 * THE VIEW'S VITALS, five pills in the heal tab's grammar: a label and a figure in the tone that says whether to look.
 * Sessions is the window's count. Speed bumps is amber above none and green at none (grey when the window holds no
 * session at all, since nothing went clean either). Booked and Closed without booking are the two ends of a booking
 * form: a visit booked and not undone right after, or the form closed with nothing booked; both are counts, so both are
 * grey. Last session is its age and who pressed, in its verdict's tone and led by its verdict's icon (the check, the
 * triangle or the octagon every row draws): a phone shows no `title`, so the tone must not be the only thing saying it.
 *
 * THERE IS NO LIVE PILL AND NO HEALED PILL. A use of the form takes about a minute, and nothing files scheduling friction
 * yet: a pill that could only read "none" would be a promise the view cannot keep.
 *
 * EACH PILL IS A PRESS that carries the reader to the section its figure counted. A phone reads all five before
 * anything scrolls: the bar wraps, since a row that scrolled sideways would hide the one figure that says "look". Over an
 * empty window no section is on the page, so each pill still shows its figure and is not a press: it takes no focus and
 * no hover, so nothing lights up that leads nowhere.
 *
 * Used by this module's root, `SchedulingView`, under the head.
 */
export function SchedulingPills({ tally, truncated, now, canGo, activePill, onSelect }: SchedulingPillsProps) {
  const { t } = useTranslation();
  const p = 'cerberus.scheduling.pills';
  const last = tally.last;
  const lastLook = last === null ? null : verdictLook(t, last);
  // A window cut short counts the newest entries alone, so every count of it is a floor.
  const count = (figure: number) => (truncated ? t(`${p}.atLeast`, { count: figure }) : String(figure));

  const pills: PillSpec[] = [
    { key: 'sessions', label: t(`${p}.sessions`), value: count(tally.sessions), tone: 'neutral', title: t(`${p}.sessionsTitle`) },
    {
      key: 'bumps',
      label: t(`${p}.bumps`),
      value: count(tally.bumps),
      // Green only where there were sessions to go clean: a window with none has earned no colour.
      tone: tally.bumps > 0 ? 'warn' : tally.sessions > 0 ? 'positive' : 'neutral',
      title: t(`${p}.bumpsTitle`),
    },
    { key: 'booked', label: t(`${p}.booked`), value: count(tally.booked), tone: 'neutral', title: t(`${p}.bookedTitle`) },
    { key: 'closed', label: t(`${p}.closed`), value: count(tally.closed), tone: 'neutral', title: t(`${p}.closedTitle`) },
    {
      key: 'last',
      label: t(`${p}.last`),
      value: last === null ? t(`${p}.lastNone`) : `${agoWord(t, last.started_at, now)} · ${whoWord(t, last.actor)}`,
      tone: lastLook === null ? 'neutral' : lastLook.tone,
      title: lastLook === null ? t(`${p}.lastNoneTitle`) : lastLook.word,
      wrap: true,
      Icon: lastLook?.Icon,
    },
  ];

  return (
    // No tray of its own: the pills stand between two hairlines on the view's ground.
    <PillBar className="w-full flex-wrap rounded-none border-y border-border bg-transparent px-0 py-1" role="group" aria-label={t(`${p}.label`)} data-scheduling-pills>
      {pills.map((pill) => (
        <Pill
          key={pill.key}
          isActive={canGo[pill.key] && activePill === pill.key}
          onClick={() => onSelect(pill.key)}
          // With nowhere to carry the reader, the pill is a figure and not a press.
          disabled={!canGo[pill.key]}
          title={pill.title}
          // A phrase-valued pill may shrink and wrap; a number-valued one keeps its one line. 44 px under a finger.
          className={cn('finger:min-h-11 disabled:pointer-events-none', pill.wrap && 'min-w-0 max-w-full shrink text-left')}
          data-scheduling-pill={pill.key}
        >
          <span className="text-xs">{pill.label}</span>
          <Badge as="span" tone={pill.tone} className={pill.wrap ? 'min-w-0 whitespace-normal break-words' : undefined}>
            {pill.Icon !== undefined && <pill.Icon className="mr-1 h-3 w-3 flex-none" aria-hidden="true" />}
            {pill.value}
          </Badge>
        </Pill>
      ))}
    </PillBar>
  );
}
