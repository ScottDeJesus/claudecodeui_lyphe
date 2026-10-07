import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { useClock } from '@/modules/cerberus/hooks/useClock';
import { useCountTo } from '@/modules/cerberus/hooks/useCountTo';
import { RUN_LOOK } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import { agoPhrase } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusOverview } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

type CerberusHeaderProps = {
  /** The fleet as center last answered it. The root draws loading and unreachable while it has none, so the header always has one. */
  overview: CerberusOverview;
  /** The fleet is the last answer center gave, not this minute's: no read has answered for 90 s. The pill stops saying Live. */
  stale: boolean;
  /** Enroll a node, pressed. The root opens its Enroll dialog. */
  onEnroll: () => void;
};

/**
 * THE TAB'S HEADER: the answer before anyone clicks (`design/cerberus/Cerberus Tab.dc.html` :37-51).
 *
 * Read top to bottom on the left:
 * 1. the eyebrow, "Cerberus · fleet health";
 * 2. the headline, the biggest thing on the tab: "All *quiet*", "One check *needs you*" or "3 checks
 *    *need you*". Its accent words are italic, never bold, since the display serif has no bold. They
 *    take the state's tone: the positive ink at quiet, the warn ink while anything needs you, so the call
 *    to act is never painted in the passing green. A headline that changes rises in afresh; and "One fix
 *    *running*", its accent in the info ink, when the only check needing you has its fix running;
 * 3. the summary, "18 of 21 checks passing · 2 muted · 6 nodes · last result 2 s ago". The passing
 *    count opens on its number, counts to a new one over 1.4 s when it changes, and a screen reader
 *    hears only the number it lands on. The muted part is left out at none, and the age while center has
 *    received no result at all.
 *
 * On the right, wrapping under the left on a phone: the clock pill, then the button row. The pill says
 * Live only while the socket is up AND the fleet is this minute's.
 *
 * The headline's number is `counts.needsYou`, the same count the workspace strip's pill shows, so the
 * two never disagree. The header enters on Verve's page entrance with the rest of the tab.
 *
 * Used by the cerberus module's root, `CerberusPanel`, above its tabs.
 */
export function CerberusHeader({ overview, stale, onEnroll }: CerberusHeaderProps) {
  const { t } = useTranslation();
  const { counts } = overview;

  // Whether the browser's socket to this app is up: the one road by which center's hint that something
  // moved reaches the screen, so while it is down the tab is not live.
  const { isConnected: connected } = useWebSocket();
  // The pill's "Live HH:MM:SS" and the summary's "last result 12 s ago" both count from this one clock.
  const now = useClock();
  // The passing count as drawn: the number itself on mount, a 1.4 s count to each new one after.
  const shownPassing = useCountTo(counts.passing);

  const needs = counts.needsYou;
  // "One fix running" when the only check needing you has its fix running: its run is going, with no result yet.
  const onlyRun = needs === 1 ? overview.needsYou[0]?.run ?? null : null;
  const fixRunning = onlyRun !== null && onlyRun.result === null;
  const lead = fixRunning
    ? t('cerberus.fix.headline')
    : needs === 0 ? t('cerberus.header.headline.quiet') : t('cerberus.header.headline.needs', { count: needs });
  const accent = fixRunning
    ? t('cerberus.fix.headlineAccent')
    : needs === 0 ? t('cerberus.header.headline.quietAccent') : t('cerberus.header.headline.needsAccent', { count: needs });
  // The accent's tone: a fix's own while one runs (the info ink), else the state's.
  const accentTone = fixRunning ? RUN_LOOK.going.tone : needs === 0 ? 'positive' : 'warn';
  // The summary's parts after the passing count, each named so its place holds while its words change.
  const rest = [
    counts.muted > 0 ? { id: 'muted', words: t('cerberus.header.summary.muted', { count: counts.muted }) } : null,
    { id: 'nodes', words: t('cerberus.header.summary.nodes', { count: counts.nodes }) },
    overview.lastResultAt === null
      ? null
      : { id: 'age', words: t('cerberus.header.summary.lastResult', { ago: agoPhrase(t, overview.lastResultAt, now) }) },
  ].filter((part): part is { id: string; words: string } => part !== null);

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-[clamp(16px,4cqi,32px)] pt-[clamp(20px,5cqi,28px)] motion-safe:animate-[vv-pagein_.5s_theme(transitionTimingFunction.enter)_both]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t('cerberus.header.eyebrow')}</p>
        <h1 className="min-h-[38px] font-serif text-[length:clamp(28px,7.5cqi,34px)] font-normal leading-[1.1] text-foreground">
          {/* Keyed by its words, so a headline that changes rises in afresh, as the prototype's swap does. */}
          <span key={`${lead}|${accent}`} className="inline-block motion-safe:animate-shape-rise">
            {lead} <em data-tone={accentTone} className="italic text-tone-ink">{accent}</em>
          </span>
        </h1>
        <p className="text-[13.5px] tabular-nums text-muted-foreground">
          {/* Each part holds together and keeps its dot at its end, so a narrow header breaks the line between
              parts, never inside one and never before a dot. The count in motion is for the eye; a screen
              reader is handed the number it lands on. */}
          <span className="whitespace-nowrap">
            <span className="sr-only">{counts.passing}</span>
            <span aria-hidden className="font-medium text-foreground">{shownPassing}</span>{' '}
            {t('cerberus.header.summary.of', { count: counts.checks })} ·
          </span>
          {rest.map((part, index) => (
            <Fragment key={part.id}>
              {' '}
              <span className="whitespace-nowrap">{index < rest.length - 1 ? `${part.words} ·` : part.words}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <ClockPill live={connected && !stale} now={now} />
        <div className="flex flex-wrap gap-2.5">
          {/* SLOT: Update wardens — the updates plan's button goes here, before Enroll a node, where the
              prototype draws its Deploy (:48). Nothing is drawn for it until it lands. */}
          <Button variant="outline" size="sm" className="h-8 max-md:h-11" onClick={onEnroll}>
            {t('cerberus.header.enroll')}
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * The clock pill. While the browser's socket is up and the fleet is this minute's: the positive dot
 * breathing, "Live", and the time to the second. Otherwise the neutral dot stands still beside
 * "Reconnecting", with no time, since nothing on the tab is live then. That covers the socket down (a
 * change no longer reaches the screen the moment it lands) and the fleet stale (the reads stopped
 * answering). The tab is trying again either way: the socket reconnects on its own, and the provider
 * reads every 30 s. The word says it, so the dot is never the only sign.
 *
 * Only the mode word is a live region: a screen reader hears "Reconnecting" when the tab stops being
 * live and "Live" when it is back, never the clock ticking.
 */
function ClockPill({ live, now }: { live: boolean; now: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] tabular-nums text-muted-foreground">
      <span
        aria-hidden
        data-tone={live ? 'positive' : 'neutral'}
        className={cn('size-[7px] flex-none rounded-full bg-tone-dot', live && 'motion-safe:animate-cerberus-breathe')}
      />
      <span role="status">{live ? t('cerberus.header.live') : t('cerberus.header.reconnecting')}</span>
      {live && <span className="font-medium text-foreground">{hms(now)}</span>}
    </div>
  );
}
