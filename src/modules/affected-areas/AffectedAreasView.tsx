import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCodebook } from '@/modules/affected-areas/hooks/useCodebook';
import { useImageUrl, useImageUrls } from '@/modules/affected-areas/hooks/useImageUrl';
import { usePano } from '@/modules/affected-areas/hooks/usePano';
import { useTour } from '@/modules/affected-areas/hooks/useTour';
import { useTourReader } from '@/modules/affected-areas/hooks/useTourReader';
import { useTours } from '@/modules/affected-areas/hooks/useTours';
import { isInLayout, useViewShown, useWhenShown } from '@/modules/affected-areas/hooks/useViewShown';
import { PanoScreen } from '@/modules/affected-areas/PanoScreen';
import { TourPicker } from '@/modules/affected-areas/TourPicker';
import { TourScreen } from '@/modules/affected-areas/TourScreen';
import { FACES, tourName, tourUnread } from '@/modules/affected-areas/utils/tourModel';
import type { Face, PanoEntry } from '@/shared/affected-areas-types';

/** A screen arriving: Verve's page entrance, as the Cerberus tab's own views enter. It plays each time one opens. */
const SCREEN_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/** The first face, in the strip's order, whose read found an area; Ahead when none did or the pano is not listed. */
function firstFaceWithAreas(entry: PanoEntry | undefined): Face {
  return FACES.find((face) => {
    const read = entry?.views.find((view) => view.face === face)?.read;
    return read?.status === 'read' && (read.standingCount ?? read.regionsCount) > 0;
  }) ?? 'ahead';
}

/**
 * THE TOURS VIEW: the affected areas a reader marked on a DocuSketch tour, drawn on the single photo so a change can
 * be spotted. Three screens, one at a time, each opened from the one before:
 * 1. `TourPicker`: search, and the recent tours with how far each is read.
 * 2. `TourScreen`: a tour's job (what the reader is told) and its panos as a gallery, with Read the rest.
 * 3. `PanoScreen`: a pano's six faces, the shown one outlined and numbered beside the list of its areas, what the
 *    reader understood, the room's drying numbers, and the read press.
 *
 * THE VIEW KEEPS ITS PLACE. Its root holds the open tour and pano, the face and the chosen region, and the Cerberus
 * tab keeps it mounted (hidden) after its first show, so all of it survives a visit to Fleet. It reads nothing on its
 * own while hidden: it reads on open and on a person's presses, never on a timer.
 *
 * The root is the data hub: every read, photo, walk and press is wired here, and the screens draw what they are
 * handed. Words are `affectedAreas.*`; endpoints are `api.affectedAreas`; tone is by judgment (`utils/regionLook.ts`).
 *
 * Used by the cerberus module's `CerberusPanel`, through this module's barrel, as the fourth view of its strip.
 */
export function AffectedAreasView() {
  const { t } = useTranslation();
  // The view's top, brought into view when a tour or a pano opens, wherever the panel was scrolled to.
  const topRef = useRef<HTMLDivElement>(null);
  // Whether a read was held back because the view was hidden when its cause arrived (an answer of a press or of the
  // walk). A ref: it is read once, when the view returns, and nothing draws from it.
  const heldRef = useRef(false);

  // The search field's text. Held here, not in the picker, so the list a person searched is the one Back returns to.
  const [query, setQuery] = useState('');
  // The open tour; null shows the picker. Held at the root of a view the tab keeps mounted, so a visit to Fleet keeps it.
  const [tourId, setTourId] = useState<string | null>(null);
  // The open pano; null shows its tour.
  const [panoId, setPanoId] = useState<string | null>(null);
  // The face the pano screen shows: the person's place among six, kept while they look at the list or the Lightbox.
  const [face, setFace] = useState<Face>('ahead');
  // The region chosen on the shown face, outline and row at once; null when none is.
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  // Whether the shown face is open in the Lightbox.
  const [enlarged, setEnlarged] = useState(false);

  // ── The reads. They happen on open and on a person's press, and never while the view is hidden: an answer that arrives
  // with the view away is held (`heldRef`) and read once, when it returns. ──
  // `shown` stops the search's rest timer while the view is away; the return reads what an answer left behind.
  const shown = useViewShown(topRef);
  const tours = useTours(query, shown);
  const tour = useTour(tourId);
  // The open pano as its tour lists it: `usePano` needs it to know a pano that was never cut.
  const entry = tour.value?.panos.find((candidate) => candidate.panoId === panoId) ?? null;
  const viewShown = () => isInLayout(topRef.current);
  // An answer of a press or of the walk changed how far something is read: the open tour is read again, and so is the
  // picker's list when it is what shows (a tour left open under a late answer is read again when it is next opened).
  const afterAnswer = () => {
    if (!viewShown()) {
      heldRef.current = true;
      return;
    }
    tour.reload();
    if (tourId === null) tours.reload();
  };
  const pano = usePano(tourId, panoId, entry, afterAnswer);
  const codebook = useCodebook();
  useWhenShown(shown, () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    tours.reload();
    tour.reload();
    pano.reload();
  });

  // What the reads answer, as the screens and the wires below need it.
  const detail = tour.value;
  const summary = tours.value?.find((candidate) => candidate.tourId === tourId) ?? null;
  const named = detail?.tour ?? summary;
  const roomKey = pano.value?.roomKey ?? entry?.roomKey ?? null;
  const room = detail?.rooms.find((candidate) => candidate.roomKey === roomKey) ?? null;
  // What Read the rest would read and spend: every pano with a face not read yet, a pano never cut included, and
  // their unread views; the press says both before it spends.
  const unread = tourUnread(detail?.panos ?? []);

  // ── The photos, the walk and the presses. Everything below them is composition. ──
  // The shown face's photo: the pano's view for that face, from the pano once it answered, else from the tour's listing.
  const shownView = (pano.value ?? entry)?.views.find((candidate) => candidate.face === face);
  const photo = useImageUrl(shownView?.sha256 ?? null);
  // The gallery's tiles: each pano's Ahead view, fetched only while the tour screen shows them.
  const tileShas = tourId !== null && panoId === null && detail !== null
    ? detail.panos.flatMap((candidate) => candidate.views.filter((view) => view.face === 'ahead').map((view) => view.sha256))
    : [];
  const photos = useImageUrls(tileShas);

  // The walk of the tour's unread panos. It is the viewer's: one armed press per pano, each answer read into the tour
  // (and into the pano on screen, when the walk just read that one), and none sent while the view is hidden.
  const reader = useTourReader(tourId, detail?.panos ?? [], {
    isShown: viewShown,
    onAnswer: (answered) => {
      afterAnswer();
      if (answered === panoId && viewShown()) pano.reload();
    },
  });
  const walk = reader.walk;

  /** Brings the view's top into view when the panel was scrolled past it, and leaves a panel already showing it alone. */
  const showTop = () => {
    const top = topRef.current;
    if (top !== null && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
  };
  const onQuery = setQuery;
  const onOpenTour = (openedTourId: string) => {
    setTourId(openedTourId);
    setPanoId(null);
    setSelectedRegionId(null);
    setEnlarged(false);
    showTop();
  };
  const onBack = () => {
    setTourId(null);
    setPanoId(null);
    setSelectedRegionId(null);
    setEnlarged(false);
    // Back is a press, and the picker is about how far each tour is read: what was read on the tour just left shows in
    // its row. A quiet read, so the list stays on screen until the new one lands.
    tours.reload();
  };
  const onOpenPano = (openedPanoId: string) => {
    setPanoId(openedPanoId);
    setFace(firstFaceWithAreas(detail?.panos.find((candidate) => candidate.panoId === openedPanoId)));
    setSelectedRegionId(null);
    showTop();
  };
  const onBackToTour = () => {
    setPanoId(null);
    setSelectedRegionId(null);
    setEnlarged(false);
    showTop();
  };
  const onFace = (shownFace: Face) => {
    setFace(shownFace);
    setSelectedRegionId(null);
  };
  // The photo and the list choose the same region; pressing the chosen one lets go of it.
  const onSelectRegion = (regionId: string) => setSelectedRegionId((chosen) => (chosen === regionId ? null : regionId));
  const onEnlarge = () => setEnlarged(true);
  const onShrink = () => setEnlarged(false);
  const onReadPano = () => pano.pressRead(false);
  const onReadAgain = () => pano.pressRead(true);
  const onReadRest = reader.start;
  const onStopRest = reader.stop;

  let screen;
  if (tourId === null) {
    screen = <TourPicker query={query} tours={tours.value} trouble={tours.trouble} onQuery={onQuery} onOpenTour={onOpenTour} onRetry={tours.retry} />;
  } else if (panoId === null) {
    screen = (
      <TourScreen
        summary={summary}
        detail={detail}
        trouble={tour.trouble}
        photos={photos}
        unreadPanos={unread.panos}
        unreadViews={unread.views}
        walk={walk}
        onBack={onBack}
        onOpenPano={onOpenPano}
        onReadRest={onReadRest}
        onStopRest={onStopRest}
        onRetry={tour.retry}
      />
    );
  } else {
    screen = (
      <PanoScreen
        entry={entry}
        detail={pano.value}
        trouble={pano.trouble}
        tourName={named === null ? '' : tourName(named, t)}
        room={room}
        codebook={codebook.value}
        face={face}
        selectedRegionId={selectedRegionId}
        photo={photo}
        enlarged={enlarged}
        press={pano.press}
        walk={walk}
        unreadPanos={unread.panos}
        unreadViews={unread.views}
        onBack={onBackToTour}
        onFace={onFace}
        onSelectRegion={onSelectRegion}
        onEnlarge={onEnlarge}
        onShrink={onShrink}
        onReadPano={onReadPano}
        onReadAgain={onReadAgain}
        onReadRest={onReadRest}
        onStopRest={onStopRest}
        onRetry={pano.retry}
      />
    );
  }

  return (
    <div ref={topRef} className="flex min-w-0 max-w-[1180px] flex-col px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      <div key={panoId ?? tourId ?? 'picker'} className={SCREEN_ENTER}>
        {screen}
      </div>
    </div>
  );
}
