import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCodebook } from '@/modules/affected-areas/hooks/useCodebook';
import { useImageUrl, useImageUrls } from '@/modules/affected-areas/hooks/useImageUrl';
import { useMarkedRegions } from '@/modules/affected-areas/hooks/useMarkedRegions';
import { usePano } from '@/modules/affected-areas/hooks/usePano';
import { useTour } from '@/modules/affected-areas/hooks/useTour';
import { useTourReader } from '@/modules/affected-areas/hooks/useTourReader';
import { useTours } from '@/modules/affected-areas/hooks/useTours';
import { isInLayout, useViewShown, useWhenShown } from '@/modules/affected-areas/hooks/useViewShown';
import { MarkScreen } from '@/modules/affected-areas/MarkScreen';
import { PanoScreen } from '@/modules/affected-areas/PanoScreen';
import { TablesScreen } from '@/modules/affected-areas/TablesScreen';
import { TourPicker } from '@/modules/affected-areas/TourPicker';
import { TourScreen } from '@/modules/affected-areas/TourScreen';
import { ToursSwitch } from '@/modules/affected-areas/ToursSwitch';
import { FACES, listedAreas, tourName, tourUnread } from '@/modules/affected-areas/utils/tourModel';
import type { Face, PanoEntry, Region } from '@/shared/affected-areas-types';
import type { RegionLayer, ToursScreenKey } from '@/shared/types';

/** A screen arriving: Verve's page entrance, as the Cerberus tab's own views enter. It plays each time one opens. */
const SCREEN_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/**
 * The first face, in the strip's order, whose read found an area, standing or proposed; Ahead when none did or the
 * pano is not listed.
 */
function firstFaceWithAreas(entry: PanoEntry | undefined): Face {
  return FACES.find((face) => {
    const read = entry?.views.find((view) => view.face === face)?.read;
    if (read?.status !== 'read') return false;
    const { standing, found } = listedAreas(read);
    return standing > 0 || found > 0;
  }) ?? 'ahead';
}

/**
 * THE TOURS VIEW: the affected areas a reader marked on a DocuSketch tour, drawn on the single photo so a change can
 * be spotted, and where the operator judges them. A switch at its top (Tours · Mark · Tables) chooses among three
 * surfaces, and each keeps its place while another shows:
 * - Tours, three screens, one at a time, each opened from the one before:
 *   1. `TourPicker`: search, and the recent tours with how far each is read.
 *   2. `TourScreen`: a tour's job (what the reader is told) and its panos as a gallery, with Read the rest.
 *   3. `PanoScreen`: a pano's six faces, the shown one outlined and numbered beside the list of its areas, what the
 *      reader understood, the room's drying numbers, the read press, and the presses that judge an area.
 * - Mark (`MarkScreen`): a queue the engine orders, one area at a time.
 * - Tables (`TablesScreen`): how right the reader is per kind, and the line that decides each kind.
 *
 * THE VIEW KEEPS ITS PLACE. Its root holds the open tour and pano, the face and the chosen region, and the Cerberus
 * tab keeps it mounted (hidden) after its first show, so all of it survives a visit to Fleet. It reads nothing on its
 * own while hidden: it reads on open and on a person's presses, never on a timer. A surface the switch shows again
 * reads again, quietly, on that press: a judgment made on one moves the others.
 *
 * The root is the data hub for the Tours screens: every read, photo, walk and press is wired here, and the screens draw
 * what they are handed. Mark and Tables read and press for themselves (`useQueue`, `useProving`). Words are
 * `affectedAreas.*`; endpoints are `api.affectedAreas`; tone is by judgment (`utils/regionLook.ts`).
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
  // What the pano's photo draws: every area (All, the default: the operator is judging what the model proposed, and hiding
  // the unsure ones would hide the ones that most need his eye) or only the ones the engine says stand.
  const [layer, setLayer] = useState<RegionLayer>('all');
  // The surface the switch shows: Tours, Mark or Tables.
  const [activeScreen, setActiveScreen] = useState<ToursScreenKey>('tours');
  // The surfaces the switch has shown. Mark and Tables mount on their first show and stay mounted (hidden while another
  // shows), so each keeps its place and reads nothing until it is first asked for.
  const [openedScreens, setOpenedScreens] = useState<readonly ToursScreenKey[]>(['tours']);

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
  // The pano with the operator's presses laid over it: a mark's answer replaces its region and a drawn area is appended,
  // so the screen never fetches the pano again to show one change, and an answer outranks a read begun before it.
  const marked = useMarkedRegions(pano.value);
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
    // A new pano opens on All again, whatever the last one was set to; a face of the same pano keeps the person's choice.
    setLayer('all');
    showTop();
  };
  const onBackToTour = () => {
    setPanoId(null);
    setSelectedRegionId(null);
    setEnlarged(false);
    showTop();
    // Back is a press, and a judgment on the pano moved its tile's area count, its room's "Affected per the photos" and
    // the face a pano opens on: the tour is read again, quietly, as Back to the picker reads the list. One GET per Back;
    // the pano is not read again (`usePano` reads by tour and pano, which a tour reload does not change).
    tour.reload();
  };
  const onFace = (shownFace: Face) => {
    setFace(shownFace);
    setSelectedRegionId(null);
  };
  // The photo and the list choose the same region; pressing the chosen one lets go of it.
  const onSelectRegion = (regionId: string) => setSelectedRegionId((chosen) => (chosen === regionId ? null : regionId));
  const onLayer = setLayer;
  // The switch: showing a surface again reads what it shows, quietly, on that press (never on a timer). Mark and Tables
  // read themselves when their `shown` turns true; Tours reads what it is on: the open pano, else the open tour, else the list.
  const onScreen = (next: ToursScreenKey) => {
    if (next === activeScreen) return;
    setActiveScreen(next);
    setOpenedScreens((opened) => (opened.includes(next) ? opened : [...opened, next]));
    if (next !== 'tours') return;
    if (panoId !== null) pano.reload();
    else if (tourId !== null) tour.reload();
    else tours.reload();
  };
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
        detail={marked.pano}
        trouble={pano.trouble}
        tourName={named === null ? '' : tourName(named, t)}
        room={room}
        codebook={codebook.value}
        face={face}
        selectedRegionId={selectedRegionId}
        layer={layer}
        photo={photo}
        enlarged={enlarged}
        press={pano.press}
        walk={walk}
        unreadPanos={unread.panos}
        unreadViews={unread.views}
        onBack={onBackToTour}
        onFace={onFace}
        onSelectRegion={onSelectRegion}
        onLayer={onLayer}
        onMarked={(region: Region) => marked.replace(tourId, panoId, region)}
        onMissed={(viewSha: string, region: Region) => marked.append(tourId, panoId, viewSha, region)}
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
      {/* The switch stands outside the keyed entrance, so it never re-enters; each surface under it keeps its place. */}
      <ToursSwitch screen={activeScreen} onScreen={onScreen} />
      <div hidden={activeScreen !== 'tours'}>
        <div key={panoId ?? tourId ?? 'picker'} className={SCREEN_ENTER}>
          {screen}
        </div>
      </div>
      {openedScreens.includes('mark') && (
        <div hidden={activeScreen !== 'mark'}>
          <MarkScreen codebook={codebook.value} shown={activeScreen === 'mark' && shown} />
        </div>
      )}
      {openedScreens.includes('tables') && (
        <div hidden={activeScreen !== 'tables'}>
          <TablesScreen shown={activeScreen === 'tables' && shown} />
        </div>
      )}
    </div>
  );
}
