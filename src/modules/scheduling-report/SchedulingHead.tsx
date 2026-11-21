import { RefreshCw, X } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { SchedulingFilters, SchedulingTally, SchedulingWindow } from '@/modules/scheduling-report/utils/schedulingModel';
import { agoWord, whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { Tone } from '@/shared/types';
import { Badge, Button, IconWord, SegmentedControl } from '@/shared/ui';

type SchedulingHeadProps = {
  /** The window on screen. */
  days: SchedulingWindow;
  /** The window's sessions, counted: people's only, as the server narrowed them to the person asked for. */
  tally: SchedulingTally;
  /** The window held more entries than one answer carries, so every figure here is a floor. */
  truncated: boolean;
  /** What the view is narrowed to: a person re-scopes every figure of the head, and the head says so. */
  filters: SchedulingFilters;
  /** The clock the last session's age is counted from, epoch ms. */
  now: number;
  onWindow: (days: SchedulingWindow) => void;
  onRefresh: () => void;
  onFilter: (filters: SchedulingFilters) => void;
};

const WINDOWS: SchedulingWindow[] = [7, 30, 90];

/**
 * THE VIEW'S HEAD: the view's answer, ranked UNDER the tab's. The Cerberus tab has its own header above this one, with
 * the page's one big headline; this is a section's heading inside that page, so its serif is the size the tab's inner
 * pieces use (21 to 24 px). It needs no eyebrow: the face at the tab's foot already names the view.
 *
 * On the left, top to bottom: the headline, whose italic accent takes the state's tone and says it in words
 * ("3 sessions *hit a speed bump*", "All *clean*", "Nothing scheduled *yet*"); the scope, only while the view is narrowed
 * to one person; and the summary, which gives the headline its "compared to what": the sessions in the window, how many
 * booked, changed and cancelled a visit, and the last one's age and who pressed it.
 *
 * AMBER, NEVER RED. A speed bump is something to read, and this view takes no action, so the headline wears the warn ink
 * however bad the worst bump was; the red is kept for the row and the reason that earned it.
 *
 * A NARROWED VIEW SAYS SO, RIGHT UNDER THE HEADLINE IT CHANGED. One person's chip re-scopes every figure here, and the
 * chips are a column away (two screens below on a phone) on a view that keeps its filters between visits. So while it is
 * set the head names the scope in words, in the info tone, with the press that lifts it beside it: an "All *clean*" that
 * is one person's never reads as everyone's.
 *
 * A WINDOW CUT SHORT COUNTS FLOORS. When the window held more entries than one answer carries, every figure is of the
 * newest alone, so each says "at least" or "more than", and "All clean" becomes "The newest N are clean".
 *
 * On the right, wrapping under the left on a phone: the 7 / 30 / 90-day switch and Refresh. Machine calls are in none of
 * these figures, listed or not.
 *
 * Used by this module's root, `SchedulingView`, at its top.
 */
export function SchedulingHead({ days, tally, truncated, filters, now, onWindow, onRefresh, onFilter }: SchedulingHeadProps) {
  const { t } = useTranslation();
  const h = 'cerberus.scheduling.head';
  const who = filters.by === null ? null : whoWord(t, filters.by);
  const more = truncated ? 'More' : '';

  const headline: { lead: string; accent: string; tone: Tone } = tally.bumps > 0
    ? { lead: t(`${h}.bumps${more}`, { count: tally.bumps }), accent: t(`${h}.bumpsAccent`, { count: tally.bumps }), tone: 'warn' }
    : tally.sessions === 0
      ? { lead: t(`${h}.none`), accent: t(who === null ? `${h}.noneAccent` : `${h}.noneScopedAccent`), tone: 'neutral' }
      : { lead: t(`${h}.clean${more}`, { count: tally.sessions }), accent: t(`${h}.cleanAccent`), tone: 'positive' };

  // The summary's parts. Each is held whole while it fits and wraps inside itself only when it is wider than the VIEW,
  // so the head breaks between parts and a long sentence is never cut at the edge.
  const parts = tally.sessions === 0
    ? [t(who === null ? `${h}.summary.none` : `${h}.summary.noneScoped`, { days, who })]
    : [
      t(`${h}.summary.sessions${more}`, { count: tally.sessions, days }),
      t(`${h}.summary.booked${more}`, { count: tally.booked }),
      t(`${h}.summary.changed${more}`, { count: tally.changed }),
      t(`${h}.summary.cancelled${more}`, { count: tally.cancelled }),
      ...(tally.last === null ? [] : [t(`${h}.summary.last`, { ago: agoWord(t, tally.last.started_at, now), who: whoWord(t, tally.last.actor) })]),
    ];

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3" data-scheduling-head>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2 className="font-serif text-[length:clamp(21px,5.6cqi,24px)] font-normal leading-[1.15] text-foreground">
          {/* Keyed by its words, so a headline that changes rises in afresh, as the tab's own header does. */}
          <span key={`${headline.lead}|${headline.accent}`} className="inline-block motion-safe:animate-shape-rise">
            {headline.lead} <em data-tone={headline.tone} className="italic text-tone-ink">{headline.accent}</em>
          </span>
        </h2>
        {who !== null && (
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" data-scheduling-scope>
            <Badge as="span" tone="info" className="min-w-0 whitespace-normal break-words">{t(`${h}.scope`, { who })}</Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-none px-2.5 text-xs finger:size-11 finger:px-0"
              aria-label={t(`${h}.scopeClear`)}
              title={t(`${h}.scopeClear`)}
              onClick={() => onFilter({ ...filters, by: null })}
              data-scheduling-scope-clear
            >
              <IconWord icon={X} word={t(`${h}.scopeClear`)} />
            </Button>
          </p>
        )}
        <p className="text-[13.5px] text-muted-foreground" data-scheduling-summary>
          {parts.map((part, index) => (
            <Fragment key={part}>
              {index > 0 && ' '}
              <span className="inline-block max-w-full">{index < parts.length - 1 ? `${part} ·` : part}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <SegmentedControl
          label={t(`${h}.window`)}
          options={WINDOWS.map((length) => ({ value: String(length), label: t(`${h}.days`, { count: length }) }))}
          value={String(days)}
          onChange={(value) => onWindow(Number(value) as SchedulingWindow)}
        />
        <Button variant="outline" size="sm" className="h-8 flex-none finger:size-11 finger:px-0 max-md:h-11" aria-label={t(`${h}.refresh`)} title={t(`${h}.refresh`)} onClick={onRefresh}>
          <IconWord icon={RefreshCw} word={t(`${h}.refresh`)} />
        </Button>
      </div>
    </header>
  );
}
