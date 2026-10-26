import { ChevronLeft } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ContextCard } from '@/modules/affected-areas/ContextCard';
import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { ReadControl } from '@/modules/affected-areas/ReadControl';
import { RoomGallery } from '@/modules/affected-areas/RoomGallery';
import { TourRooms } from '@/modules/affected-areas/TourRooms';
import { addressBesideName, tourFacts, tourName } from '@/modules/affected-areas/utils/tourModel';
import type { TourDetail, TourSummary } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, TourReaderProgress } from '@/shared/types';
import { Button } from '@/shared/ui';

type TourScreenProps = {
  /** The tour as the picker listed it: its header is drawn from this while the detail is read. */
  summary: TourSummary | null;
  /** The tour's context, rooms and panos; null while it is read or when the read failed. */
  detail: TourDetail | null;
  trouble: AffectedAreasTrouble | null;
  /** Each tile's photo, by the sha of its pano's Ahead view. */
  photos: Record<string, string | null>;
  /** Panos with a view that needs a read (none yet, or one that is not current): what Read the rest would read. */
  unreadPanos: number;
  /** Those panos' unread views: what Read the rest would spend. */
  unreadViews: number;
  walk: TourReaderProgress;
  onBack: () => void;
  onOpenPano: (panoId: string) => void;
  /** The gallery's "+N" opened the rest of the panos: their photos may be fetched now. */
  onOverflowOpen: () => void;
  onReadRest: () => void;
  onStopRest: () => void;
  onRetry: () => void;
};

const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/** Verve's waiting surface in the shape of the card and the gallery, while the detail is read. */
function ReadingBody() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <p role="status" className="sr-only">{t('affectedAreas.tour.reading')}</p>
      <div aria-hidden="true" className="vv-skeleton h-[148px] w-full rounded-[14px]" />
      <div aria-hidden="true" className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
        {Array.from({ length: 8 }, (_, tile) => <div key={tile} className="vv-skeleton aspect-square rounded-[10px]" />)}
      </div>
    </div>
  );
}

/**
 * A TOUR: whose it is, then what the reader is told about the job, then its rooms, then its panos.
 *
 * Read top to bottom: All tours (the way back), the job's name, its address, and one line of what the tour holds
 * and how far it is read, with the walk beside them where the pano screen keeps its press (what it would spend —
 * "45 panos · 270 views need a read" — and Read the rest of this tour, or "Reading 3 of 45" with Stop after this
 * pano while it runs); then `ContextCard`; then `TourRooms`, each room and who calls it affected; then "PANOS · 12"
 * and `RoomGallery`, whose tiles open a pano.
 *
 * The header draws at once from the picker's row while the detail is read; the card and the gallery wait under
 * Verve's waiting surface. A failed read keeps the header and says why, with Try again.
 *
 * Used by the affected-areas module's view root.
 */
export function TourScreen({
  summary, detail, trouble, photos, unreadPanos, unreadViews, walk, onBack, onOpenPano, onOverflowOpen, onReadRest, onStopRest, onRetry,
}: TourScreenProps) {
  const { t } = useTranslation();
  const panosHeadingId = useId();
  const tour = detail?.tour ?? summary;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col items-start gap-1">
          <Button variant="ghost" size="sm" className="-ml-3 max-md:h-11" onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
            {t('affectedAreas.tour.back')}
          </Button>
          {tour === null ? (
            <div aria-hidden="true" className="flex w-full flex-col gap-2 pt-1">
              <div className="vv-skeleton h-6 w-2/5" />
              <div className="vv-skeleton h-3.5 w-3/5" />
            </div>
          ) : (
            <>
              <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{tourName(tour, t)}</h2>
              {addressBesideName(tour) !== null && (
                <p className="text-[13.5px] text-muted-foreground [overflow-wrap:anywhere]">{addressBesideName(tour)}</p>
              )}
              <p className="text-[12.5px] text-muted-foreground">{tourFacts(tour, t, true)}</p>
            </>
          )}
        </div>
        {/* The press stands where the pano screen's does: top right, beside whose tour it is. */}
        {detail !== null && (
          <div className="min-w-0 max-w-[420px] flex-[0_1_auto]">
            <ReadControl pano={null} walk={walk} unreadPanos={unreadPanos} unreadViews={unreadViews} onReadRest={onReadRest} onStopRest={onStopRest} />
          </div>
        )}
      </header>

      {trouble !== null && <LaneTrouble trouble={trouble} subject="tour" onRetry={onRetry} />}
      {detail === null ? (
        trouble === null && <ReadingBody />
      ) : (
        <>
          <ContextCard key={detail.tour.tourId} context={detail.context} linked={detail.tour.jobId !== null} />
          <TourRooms rooms={detail.rooms} />
          {/* FILL: day-one — DayOneSketch with the tour's dayOne, layout status and the press */}
          <section aria-labelledby={panosHeadingId} className="flex min-w-0 flex-col gap-3">
            <h3 id={panosHeadingId} className={EYEBROW}>
              {t('affectedAreas.tour.panosTitle')} · {detail.panos.length}
            </h3>
            <RoomGallery
              key={detail.tour.tourId}
              panos={detail.panos}
              photos={photos}
              label={t('affectedAreas.tour.galleryLabel', { tour: tourName(detail.tour, t) })}
              onOpenPano={onOpenPano}
              onOverflowOpen={onOverflowOpen}
            />
          </section>
        </>
      )}
    </div>
  );
}
