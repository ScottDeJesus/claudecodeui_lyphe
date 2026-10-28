import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCodebook } from '@/modules/affected-areas/hooks/useCodebook';
import { useDayOne } from '@/modules/affected-areas/hooks/useDayOne';
import { useImageUrls } from '@/modules/affected-areas/hooks/useImageUrl';
import { useMarkedRegions } from '@/modules/affected-areas/hooks/useMarkedRegions';
import { usePano } from '@/modules/affected-areas/hooks/usePano';
import { usePanoPlace } from '@/modules/affected-areas/hooks/usePanoPlace';
import { useTilePhotos } from '@/modules/affected-areas/hooks/useTilePhotos';
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
import { tourName, tourUnread } from '@/modules/affected-areas/utils/tourModel';
import type { Face, Region } from '@/shared/affected-areas-types';
import type { ToursScreenKey } from '@/shared/types';

/** A screen arriving: Verve's page entrance, as the Cerberus tab's own views enter. It plays each time one opens. */
// `backwards`, never `both`: a forward-filled transform animation keeps the screen a containing block for fixed
// descendants after it ends (the computed transform reads `none`, the animation still fills), and the sphere's iPhone
// fullscreen is a fixed stage — it would fill this screen's box instead of the phone's screen. The keyframes end at the
// element's own state, so the last frame is the same either way.
const SCREEN_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_backwards]';

/**
 * THE TOURS VIEW: the affected areas a reader marked on a DocuSketch tour, drawn on the single photo so a change can
 * be spotted, and where the operator judges them. A switch at its top (Tours · Mark · Tables) chooses among three
 * surfaces, and each keeps its place while another shows:
 * - Tours, three screens, one at a time, each opened from the one before:
 *   1. `TourPicker`: search, and the recent tours with how far each is read.
 *   2. `TourScreen`: a tour's job (what the reader is told), its rooms, the day-one sketch (the plan drawn from the panos'
 *      room layouts, with its own Read the room layout) and its panos as a gallery, with Read the rest.
 *   3. `PanoScreen`: a pano's six faces, the shown one outlined and numbered beside the list of its areas, what the
 *      reader understood, the room's drying numbers, the read press, and the presses that judge an area.
 * - Mark (`MarkScreen`): a queue the engine orders, one area at a time.
 * - Tables (`TablesScreen`): how right the reader is per kind, and the line that decides each kind.
 *
 * THE VIEW KEEPS ITS PLACE. Its root holds the open tour and pano and, through `usePanoPlace`, what the pano shows (360°
 * or a face), where the sphere looks and the chosen region, and the Cerberus tab keeps it mounted (hidden) after its first
 * show, so all of it survives a visit to Fleet. It reads nothing on its own while hidden: it reads on open and on a
 * person's presses, never on a timer. A surface the switch shows again reads again, quietly, on that press: a judgment
 * made on one moves the others.
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
  // Where the person is in the open pano: 360° or a face, where the sphere looks, the area chosen, enlarged or not, and the
  // layer (`usePanoPlace`).
  const place = usePanoPlace();
  // The read of the open pano's six photos: a Retry on a photo that did not arrive bumps it, and the six are fetched again
  // under the new key (`useImageUrls`), for the sphere and the shown view alike.
  const [photoAttempt, setPhotoAttempt] = useState(0);
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
  // A room is a (roomKey, floor) pair: a key on two floors is two rooms, and the pano stands in the one on its own floor.
  const panoRoom = pano.value ?? entry;
  const room = panoRoom === null
    ? null
    : (detail?.rooms.find((candidate) => candidate.roomKey === panoRoom.roomKey && candidate.floor === panoRoom.floor) ?? null);
  // What Read the rest would read and spend: every pano with a view that needs a read (none yet, or not current), a pano never cut included, and
  // their unread views; the press says both before it spends.
  const unread = tourUnread(detail?.panos ?? []);

  // ── The photos, the walk and the presses. Everything below them is composition. ──
  // The open pano's six photos, by view sha: the sphere stitches all six and a shown view draws its own out of the same
  // record, so opening a view costs no second read. A sha absent while it loads, null when its bytes did not arrive.
  const panoViews = (marked.pano ?? entry)?.views ?? [];
  const photos = useImageUrls(panoViews.map((view) => view.sha256), photoAttempt);
  // The gallery's tiles: each pano's Ahead view, fetched only while the tour screen shows them, and only the tiles it draws
  // until its "+N" opens the rest.
  const { photos: tilePhotos, onOverflowOpen } = useTilePhotos(tourId, panoId, detail?.panos ?? null);

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
  // The day-one sketch's data and layout walk. The walk sends only while its meter and Stop are on screen (the tour screen of
  // the Tours surface, not a pano or Mark), and an answer that moved the plan has the tour and the open pano read again.
  const dayOne = useDayOne(tourId, detail, {
    shown,
    isShown: () => viewShown() && activeScreen === 'tours' && panoId === null,
    onPlanMoved: () => { afterAnswer(); if (panoId !== null && viewShown()) pano.reload(); },
  });

  /** Brings the view's top into view when the panel was scrolled past it, and leaves a panel already showing it alone. */
  const showTop = () => {
    const top = topRef.current;
    if (top !== null && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
  };
  const onQuery = setQuery;
  const onOpenTour = (openedTourId: string) => {
    setTourId(openedTourId);
    setPanoId(null);
    place.letGo();
    showTop();
  };
  const onBack = () => {
    setTourId(null);
    setPanoId(null);
    place.letGo();
    // Back is a press, and the picker is about how far each tour is read: what was read on the tour just left shows in
    // its row. A quiet read, so the list stays on screen until the new one lands.
    tours.reload();
  };
  const onOpenPano = (openedPanoId: string) => {
    setPanoId(openedPanoId);
    place.openPano(detail?.panos.find((candidate) => candidate.panoId === openedPanoId));
    showTop();
  };
  // The sketch's presses: an area opens its photo's pano at its face with its region chosen, an object (no region) at its face.
  const onOpenPanoAt = (openedPanoId: string, face: Face, regionId: string | null) => {
    onOpenPano(openedPanoId);
    if (regionId === null) place.onShow(face);
    else place.onMarkOn(face, regionId);
  };
  const onBackToTour = () => {
    setPanoId(null);
    place.letGo();
    showTop();
    // Back is a press, and a judgment on the pano moved its tile's area count, its room's "Affected per the photos" and
    // the face a pano opens on: the tour is read again, quietly, as Back to the picker reads the list. One GET per Back;
    // the pano is not read again (`usePano` reads by tour and pano, which a tour reload does not change).
    tour.reload();
  };
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
        photos={tilePhotos}
        unreadPanos={unread.panos}
        unreadViews={unread.views}
        walk={walk}
        dayOne={dayOne}
        codebook={codebook.value}
        onBack={onBack}
        onOpenPano={onOpenPano}
        onOpenPanoAt={onOpenPanoAt}
        onOverflowOpen={onOverflowOpen}
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
        shown={place.shown}
        selectedRegionId={place.selectedRegionId}
        layer={place.layer}
        photos={photos}
        enlarged={place.enlarged}
        sphereLook={place.sphereLook}
        press={pano.press}
        walk={walk}
        unreadPanos={unread.panos}
        unreadViews={unread.views}
        onBack={onBackToTour}
        onShow={place.onShow}
        onSelectRegion={place.onSelectRegion}
        onLayer={place.onLayer}
        onLook={place.onLook}
        onMarkOn={place.onMarkOn}
        onFullscreen={place.onFullscreen}
        onRetryPhotos={() => setPhotoAttempt((attempt) => attempt + 1)}
        onMarked={(region: Region) => marked.replace(tourId, panoId, region)}
        onMissed={(viewSha: string, region: Region) => marked.append(tourId, panoId, viewSha, region)}
        onEnlarge={place.onEnlarge}
        onShrink={place.onShrink}
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
