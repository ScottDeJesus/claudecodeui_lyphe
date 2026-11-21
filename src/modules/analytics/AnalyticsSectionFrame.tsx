import { CloudOff, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AnalyticsReading } from '@/modules/analytics/types';
import { Button, EmptyState, Spinner } from '@/shared/ui';

type AnalyticsSectionFrameProps<T> = {
  /** The section's one read, as `useAnalyticsSection` answers it. */
  reading: AnalyticsReading<T>;
  /** Asks again: Try again's press when the route did not answer, Refresh's when it did. */
  refresh: () => void;
  /** The answer's time: when its numbers were taken, in epoch seconds, read off the answer. */
  takenAt: (data: T) => number;
  /** Draws the section from the answer. Called only with an answer. */
  children: (data: T) => ReactNode;
};

/** The day and the hour the numbers were taken, in the reader's own words for them. */
function takenWords(seconds: number, language: string): { today: boolean; date: string; time: string } {
  const taken = new Date(seconds * 1000);
  return {
    today: taken.toDateString() === new Date().toDateString(),
    date: new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(taken),
    time: new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(taken),
  };
}

/**
 * WHAT EVERY ANALYTICS SECTION STANDS IN: one read, four states, drawn the same whichever section is open, so a section's
 * own file holds only its numbers.
 *
 * STILL READING: the kit's ring, under the panel's two controls. THE ROUTE DID NOT ANSWER: one sentence and Try again,
 * drawn as the Bugs dashboard draws the same failure and said to assistive tech as an alert. AN ANSWER: first the line
 * saying when its numbers were taken, with Refresh at its end, then the section. The line is first because the numbers
 * are a history's, not a live feed's: how old they are is read before they are, and Refresh stays on the first screen
 * of a long section.
 *
 * A NEWER ANSWER ON ITS WAY blanks nothing and moves nothing: the drawn numbers stand, the line says newer ones are being
 * read in the place of when these were taken, Refresh is busy and keeps its focus, and the section says it is busy to
 * assistive tech, then only.
 *
 * Rendered by each section's `Body` (sections/), once.
 */
export function AnalyticsSectionFrame<T>({ reading, refresh, takenAt, children }: AnalyticsSectionFrameProps<T>) {
  const { t, i18n } = useTranslation('common');

  if (reading.status === 'loading') {
    return (
      <div className="flex justify-center py-12" data-analytics-frame="loading">
        <Spinner label={t('analytics.frame.reading')} />
      </div>
    );
  }

  if (reading.status === 'unreachable') {
    return (
      // An alert: the reading ring's status goes with the ring, and a region that arrives with its words in it is only said as one.
      <div role="alert" data-analytics-frame="unreachable">
        <EmptyState
          icon={CloudOff}
          title={t('analytics.frame.unreachable')}
          actionLabel={t('analytics.frame.tryAgain')}
          onAction={refresh}
        />
      </div>
    );
  }

  const taken = takenWords(takenAt(reading.data), i18n.language);
  const takenLine = taken.today ? t('analytics.frame.takenToday', { time: taken.time }) : t('analytics.frame.takenOn', { date: taken.date, time: taken.time });
  const newerLine = t('analytics.frame.newer');

  return (
    <div className="flex flex-col gap-6" data-analytics-frame={reading.stale ? 'stale' : 'ready'}>
      {/* ONE LINE'S ROOM, WHICHEVER SENTENCE IS SAID. Both sentences always lie in the one cell, the one not being said unseen
          and unspoken, so the row is as tall with newer numbers on their way as without: Refresh stays under the thumb that
          pressed it and no number below it moves, at any width. */}
      <div className="flex items-center justify-between gap-3" data-analytics-taken="">
        <div className="grid min-w-0 flex-1 grid-cols-1 items-center text-sm text-muted-foreground">
          <p role="status" className="col-start-1 row-start-1">
            {reading.stale ? newerLine : takenLine}
          </p>
          <p aria-hidden="true" className="invisible col-start-1 row-start-1">
            {reading.stale ? takenLine : newerLine}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="flex-none finger:h-11"
          busy={reading.stale}
          onClick={refresh}
        >
          <RefreshCw aria-hidden="true" />
          {t('analytics.frame.refresh')}
        </Button>
      </div>

      <div className="flex flex-col gap-9" aria-busy={reading.stale ? true : undefined} data-analytics-section="">
        {children(reading.data)}
      </div>
    </div>
  );
}
