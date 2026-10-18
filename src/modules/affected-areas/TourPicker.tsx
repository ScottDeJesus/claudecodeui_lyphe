import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { tourFacts, tourName, tourReadState } from '@/modules/affected-areas/utils/tourModel';
import type { TourSummary } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, Tone } from '@/shared/types';
import { Badge, Card, EmptyState, Input } from '@/shared/ui';

type TourPickerProps = {
  /** The search field's text, held by the view root so the list a person searched is the one Back returns to. */
  query: string;
  /** The tours the lane answered for the query, newest first; null while the read is out or when it failed. */
  tours: TourSummary[] | null;
  trouble: AffectedAreasTrouble | null;
  onQuery: (query: string) => void;
  onOpenTour: (tourId: string) => void;
  onRetry: () => void;
};

/** A tour's read state in colour: green once every pano is read, blue part way, grey before the first read. */
const STATE_TONE = { read: 'positive', partly: 'info', unread: 'neutral' } as const satisfies Record<string, Tone>;

/** The rows' stagger, Cerberus's 45 ms a row, capped so a long list is not still arriving seconds later. */
const STAGGER_MS = 45;
const STAGGER_ROWS = 12;


/** Four rows of Verve's waiting surface in the shape of a tour row, while the first read is out. */
function ReadingRows() {
  const { t } = useTranslation();
  return (
    <ul aria-busy="true" className="m-0 list-none p-0">
      <li className="sr-only" role="status">{t('affectedAreas.picker.reading')}</li>
      {[0, 1, 2, 3].map((row) => (
        <li key={row} aria-hidden="true" className="flex items-start gap-3 border-t border-border px-4 py-3.5 first:border-t-0">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="vv-skeleton h-[18px] w-2/5" />
            <div className="vv-skeleton h-3.5 w-3/5" />
            <div className="vv-skeleton h-3 w-4/5" />
          </div>
          <div className="vv-skeleton h-6 w-20 flex-none rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/**
 * THE PICKER: a search field (a customer's name, a claim number or an address), then the recent tours, newest first.
 *
 * Each row is the whole press target and reads top to bottom as the job's name (with "No job linked" for a tour no
 * job claims; its address stands in as its name), the address, then one line of what the tour holds and how far it
 * is read. Its badge says the same in a word and a colour: Read (green), Partly read (blue), Not read (grey). Names,
 * never ids (INV-76): a tour with neither a job nor an address reads "Tour with no job or address".
 *
 * States: the first read out (four shimmering rows), the lane's fault (its banner with Try again), no tours at all,
 * no tour matching the search, and the rows.
 *
 * Used by the affected-areas module's view root, which holds the query and reads the list.
 */
export function TourPicker({ query, tours, trouble, onQuery, onOpenTour, onRetry }: TourPickerProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const searching = query.trim() !== '';

  let body;
  if (trouble !== null) body = <div className="p-4"><LaneTrouble trouble={trouble} subject="tours" onRetry={onRetry} /></div>;
  else if (tours === null) body = <ReadingRows />;
  else if (tours.length === 0) {
    body = searching
      ? <EmptyState title={t('affectedAreas.picker.noMatch', { query: query.trim() })} message={t('affectedAreas.picker.noMatchMessage')} />
      : <EmptyState title={t('affectedAreas.picker.empty')} message={t('affectedAreas.picker.emptyMessage')} />;
  } else {
    body = (
      <ul aria-labelledby={headingId} className="m-0 list-none divide-y divide-border p-0">
        {tours.map((tour, index) => {
          const state = tourReadState(tour);
          return (
            <li key={tour.tourId}>
              <button
                type="button"
                onClick={() => onOpenTour(tour.tourId)}
                style={{ animationDelay: `${Math.min(index, STAGGER_ROWS) * STAGGER_MS}ms` }}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-background focus-visible:[outline-offset:-2px] motion-safe:animate-[vv-rise_.4s_theme(transitionTimingFunction.enter)_both]"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[15px] font-medium text-foreground [overflow-wrap:anywhere]">{tourName(tour, t)}</span>
                    {tour.jobId === null && <Badge as="span" tone="neutral" className="text-[11.5px]">{t('affectedAreas.picker.noJob')}</Badge>}
                  </span>
                  {tour.jobLabel !== null && tour.address !== null && (
                    <span className="text-[13px] text-muted-foreground [overflow-wrap:anywhere]">{tour.address}</span>
                  )}
                  <span className="text-[12.5px] text-muted-foreground">{tourFacts(tour, t, false)}</span>
                </span>
                <Badge as="span" tone={STATE_TONE[state]} className="flex-none">{t(`affectedAreas.tour.state.${state}`)}</Badge>
                <ChevronRight className="mt-1 size-4 flex-none text-ink-faint" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <div className="w-full max-w-[420px]">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('affectedAreas.picker.search')}
          aria-label={t('affectedAreas.picker.search')}
        />
      </div>
      <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">
          {searching ? t('affectedAreas.picker.matching', { query: query.trim() }) : t('affectedAreas.picker.recent')}
        </h2>
        {/* An empty answer stands alone: EmptyState draws its own frame, and a card around it would frame it twice. */}
        {tours !== null && tours.length === 0 && trouble === null ? body : <Card className="overflow-hidden">{body}</Card>}
      </section>
    </div>
  );
}
