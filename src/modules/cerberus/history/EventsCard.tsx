import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import type { CerberusFeedFoot, TimelineEvent } from '@/shared/types';
import { Button, Card, EmptyState, Timeline } from '@/shared/ui';

type EventsCardProps = {
  /** The feed's rows, newest first, `null` until the first page answers. */
  events: TimelineEvent[] | null;
  /** The oldest row's moment as the eyebrow says it: "09:00", or "2026-10-05 08:05" before today. `null` with no rows. */
  since: string | null;
  /** The first page did not answer. */
  failed: boolean;
  earlier: CerberusFeedFoot;
  /**
   * The open row's position. The feed owns it because a re-read prepends rows at its head, and a
   * timeline left to keep its own would leave a different event open (Timeline's own rule).
   */
  openIndex: number | null;
  onToggle: (index: number) => void;
  onEarlier: () => void;
  onRetry: () => void;
};

/**
 * The feed's placeholder: five rows in a timeline row's shape (dot, source pill, two lines, time). It
 * waits 150 ms before it fades in, as the look-up card's does, so a first page that answers at once
 * never flashes it. It is a status region, so the wait is said as well as drawn.
 */
function WaitingFeed() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex animate-[vv-fade_200ms_ease_150ms_both] flex-col">
      <span className="sr-only">{t('cerberus.history.readingEvents')}</span>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} aria-hidden className="flex items-start gap-2.5 py-[11px]">
          <div className="vv-skeleton mt-[7px] size-2 flex-none rounded-full" />
          <div className="vv-skeleton h-5 w-16 flex-none rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="vv-skeleton h-3.5 w-4/5" />
            <div className="vv-skeleton h-3 w-3/5" />
          </div>
          <div className="vv-skeleton h-3 w-12 flex-none" />
        </div>
      ))}
    </div>
  );
}

/** Under the rows: Show earlier, the page being read, that page's failure with its retry, or the record's start. */
function FeedFoot({ earlier, onEarlier }: { earlier: CerberusFeedFoot; onEarlier: () => void }) {
  const { t } = useTranslation();
  if (earlier === 'failed') return <UnreachableBanner onRetry={onEarlier} />;
  if (earlier === 'none') {
    return <p className="border-t border-muted pt-3 text-[12.5px] text-ink-faint">{t('cerberus.history.nothingEarlier')}</p>;
  }
  const reading = earlier === 'reading';
  return (
    <div className="border-t border-muted pt-2">
      <Button variant="ghost" size="sm" className="max-md:h-11" disabled={reading} aria-busy={reading || undefined} onClick={onEarlier}>
        {reading ? t('cerberus.history.readingEarlier') : t('cerberus.history.showEarlier')}
      </Button>
    </div>
  );
}

/**
 * "EVERYTHING SINCE HH:MM": every line of What happened, newest first, in the library's `Timeline` at
 * full density, so each row carries its summary as well as its title. A row opens to its raw key,
 * node and movement. The eyebrow names the oldest row's moment, so it always says exactly how far
 * back the rows reach, and Show earlier moves it back a page at a time.
 *
 * Its states: the first page being read, unread (Cerberus out of reach, with Try again), nothing ever
 * happened ("Nothing has happened yet"), and the rows with their foot.
 *
 * Used by `HistoryView`, which reads the feed and handles every press.
 */
export function EventsCard({ events, since, failed, earlier, openIndex, onToggle, onEarlier, onRetry }: EventsCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  let body;
  if (events === null) body = failed ? <UnreachableBanner onRetry={onRetry} /> : <WaitingFeed />;
  else if (events.length === 0) body = <EmptyState title={t('cerberus.history.empty')} message={t('cerberus.history.emptyMessage')} />;
  else {
    body = (
      <>
        <Timeline events={events} density="full" openIndex={openIndex} onToggle={onToggle} />
        <FeedFoot earlier={earlier} onEarlier={onEarlier} />
      </>
    );
  }
  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2 px-[18px] py-4">
      <h2 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
        {since === null ? t('cerberus.history.everything') : t('cerberus.history.since', { time: since })}
      </h2>
      {body}
    </Card>
  );
}
