import { RefreshCw } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import type { LiveStatus, UploadsFilters, UploadsTally, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
import { agoWord, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { Tone } from '@/shared/types';
import { Badge, Button, SegmentedControl } from '@/shared/ui';

type UploadsHeadProps = {
  /** The window on screen. */
  days: UploadsWindow;
  /** The window's armed runs, counted, as the server narrowed them to the person and the account asked for. */
  tally: UploadsTally;
  /** The live run: whether it works or waits on a person and whether it is a test; null with none. */
  live: LiveStatus | null;
  /** The window held more runs than one answer carries, so every figure here is a floor. */
  truncated: boolean;
  /** What the view is narrowed to: a person or an account re-scopes every figure of the head, and the head says so. */
  filters: UploadsFilters;
  /** The clock the last run's age is counted from, epoch ms. */
  now: number;
  onWindow: (days: UploadsWindow) => void;
  onRefresh: () => void;
  onFilter: (filters: UploadsFilters) => void;
};

const WINDOWS: UploadsWindow[] = [7, 30, 90];

/**
 * THE VIEW'S HEAD: the view's answer, ranked UNDER the tab's. The Cerberus tab has its own header above this one, with
 * the page's one big headline (34 px); this is a section's heading inside that page, so its serif is the size the tab's
 * inner pieces use (21 to 24 px) and its eyebrow names the view without saying "Cerberus" again.
 *
 * On the left, top to bottom: the eyebrow; the headline, whose italic accent takes the state's tone and says it in words
 * ("An upload is *running*", "3 runs *hit a hiccup*", "All *clean*", "No upload *yet*"); the scope, only while the view is
 * narrowed; and the summary, which gives the headline its "compared to what": the runs in the window, how many ran clean,
 * how many hit a hiccup, and the last run's age and who pressed it.
 *
 * WHAT IS HAPPENING NOW LEADS. A live run takes the headline from the window's hiccups: one waiting on a person is the
 * one thing here somebody may have to go and do, so it wears the warn ink, and one working wears the info ink. The hiccup
 * count is still in the summary and the pills. A live DRY run leads in its own words ("A test run is running"): it is
 * never "an upload", least of all over a summary that says no upload ran.
 *
 * A NARROWED VIEW SAYS SO, RIGHT UNDER THE HEADLINE IT CHANGED. One person's chip or one account's re-scopes every figure
 * here, and the chips are a column away (two screens below on a phone) on a view that keeps its filters between visits.
 * So while either is set the head names the scope in words, in the info tone, with the press that lifts it beside it: an
 * "All *clean*" that is one person's never reads as everyone's. With no run in that scope the headline and the summary say
 * this person or this account has none; "nobody pressed" is said only of a window nobody narrowed.
 *
 * A WINDOW CUT SHORT COUNTS FLOORS. When the window held more runs than one answer carries, every figure is of the newest
 * runs alone, so each says "at least" or "more than", and "All clean" becomes "The newest N are clean".
 *
 * On the right, wrapping under the left on a phone: the 7 / 30 / 90-day switch and Refresh. Test runs are in none of
 * these figures.
 *
 * Used by this module's root, `UploadsView`, at its top.
 */
export function UploadsHead({ days, tally, live, truncated, filters, now, onWindow, onRefresh, onFilter }: UploadsHeadProps) {
  const { t } = useTranslation();
  const h = 'cerberus.uploads.head';
  const who = filters.by === null ? null : whoWord(t, filters.by);
  const account = filters.account === null ? null : filters.account.slice(0, 8);
  // Which of the two server-side narrowings is in force: it picks the scope's words, its empty sentence and its way back.
  const scope = who !== null && account !== null ? 'both' : who !== null ? 'by' : account !== null ? 'account' : null;
  const more = truncated ? 'More' : '';

  const headline: { lead: string; accent: string; tone: Tone } = live !== null
    ? {
      lead: live.test ? t(`${h}.testLead`) : t(live.state === 'waiting' ? `${h}.waiting` : `${h}.running`),
      accent: t(live.state === 'waiting' ? `${h}.waitingAccent` : `${h}.runningAccent`),
      tone: live.state === 'waiting' ? 'warn' : 'info',
    }
    : tally.hiccups > 0
      ? { lead: t(`${h}.hiccups${more}`, { count: tally.hiccups }), accent: t(`${h}.hiccupsAccent`, { count: tally.hiccups }), tone: 'warn' }
      : tally.runs === 0
        ? { lead: t(`${h}.none`), accent: t(scope === null ? `${h}.noneAccent` : `${h}.noneScopedAccent`), tone: 'neutral' }
        : { lead: t(`${h}.clean${more}`, { count: tally.runs }), accent: t(`${h}.cleanAccent`), tone: 'positive' };

  // The summary's parts. Each is held whole while it fits and wraps inside itself only when it is wider than the VIEW
  // (never the window: the view can be 490 px in an 820 px window), so the head breaks between parts and a long sentence is never cut at the edge.
  const parts = tally.runs === 0
    ? [t(scope === null ? `${h}.summary.none` : `${h}.summary.noneScoped.${scope}`, { days, who, account })]
    : [
      t(`${h}.summary.runs${more}`, { count: tally.runs, days }),
      t(`${h}.summary.clean${more}`, { count: tally.clean }),
      t(`${h}.summary.hiccups${more}`, { count: tally.hiccups }),
      ...(tally.last === null ? [] : [t(`${h}.summary.last`, { ago: agoWord(t, tally.last.started_at, now), who: whoWord(t, tally.last.generated_by) })]),
    ];

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3" data-uploads-head>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t(`${h}.eyebrow`)}</p>
        <h2 className="font-serif text-[length:clamp(21px,5.6cqi,24px)] font-normal leading-[1.15] text-foreground">
          {/* Keyed by its words, so a headline that changes rises in afresh, as the tab's own header does. */}
          <span key={`${headline.lead}|${headline.accent}`} className="inline-block motion-safe:animate-shape-rise">
            {headline.lead} <em data-tone={headline.tone} className="italic text-tone-ink">{headline.accent}</em>
          </span>
        </h2>
        {scope !== null && (
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5" data-uploads-scope={scope}>
            <Badge as="span" tone="info" className="min-w-0 whitespace-normal break-words">{t(`${h}.scope.${scope}`, { who, account })}</Badge>
            <Button variant="outline" size="sm" className="h-7 flex-none px-2.5 text-xs finger:h-11" onClick={() => onFilter({ ...filters, by: null, account: null })} data-uploads-scope-clear>
              {t(`${h}.scopeClear.${scope}`)}
            </Button>
          </p>
        )}
        <p className="text-[13.5px] text-muted-foreground" data-uploads-summary>
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
          onChange={(value) => onWindow(Number(value) as UploadsWindow)}
        />
        <Button variant="outline" size="sm" className="h-8 flex-none max-md:h-11" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          {t(`${h}.refresh`)}
        </Button>
      </div>
    </header>
  );
}
