import { Camera, ChevronLeft, Maximize2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { ReadControl } from '@/modules/affected-areas/ReadControl';
import { RegionList } from '@/modules/affected-areas/RegionList';
import { RoomDrying } from '@/modules/affected-areas/RoomDrying';
import { UnderstandingCard } from '@/modules/affected-areas/UnderstandingCard';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { capitalized, FACES, roomWords, spoken } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, Face, PanoDetail, PanoEntry, RoomEntry, ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, PanoPress, RegionShape, TourReaderProgress } from '@/shared/types';
import { Button, Card, EmptyState, Lightbox, RegionImage, Tabs } from '@/shared/ui';
import { formatRelativeTime, formatShortDate } from '@/shared/utils';

type PanoScreenProps = {
  /** The pano as its tour lists it — room, floor, its views and their reads — drawn while the detail is read. */
  entry: PanoEntry | null;
  /** The pano with what the reader understood and marked on each face; null while it is read or when it failed. */
  detail: PanoDetail | null;
  trouble: AffectedAreasTrouble | null;
  /** The tour's name: the way back. */
  tourName: string;
  /** The pano's room in its tour: its drying numbers. */
  room: RoomEntry | null;
  /** The kinds' labels and the contract a read is current under; null until the codebook answers. */
  codebook: Codebook | null;
  face: Face;
  selectedRegionId: string | null;
  /** The shown face's photo as an object URL; null while it loads, when it failed, or for a face with no view. */
  photo: string | null;
  /** Whether the shown face is open in the Lightbox. */
  enlarged: boolean;
  press: PanoPress;
  walk: TourReaderProgress;
  unreadPanos: number;
  unreadViews: number;
  onBack: () => void;
  onFace: (face: Face) => void;
  onSelectRegion: (regionId: string) => void;
  onEnlarge: () => void;
  onShrink: () => void;
  onReadPano: () => void;
  onReadAgain: () => void;
  onReadRest: () => void;
  onStopRest: () => void;
  onRetry: () => void;
};

/** Two columns once the panel is wide enough to hold the face beside its list: the face three parts, the list two. */
const COLUMNS = 'grid items-start gap-5 [@container(min-width:720px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';

/**
 * A face's areas and the regions set aside on it; undefined while the face is unread. Once the pano has answered, both
 * are counted off its regions, so together they are every outline drawn: set aside is `standing === false` (unsure, or
 * marked not a change) and the areas are the rest, as the engine's own count holds them. Before it answers, the
 * tour's listing gives the areas alone (standing once marks exist, else every one the reader marked).
 */
function faceCounts(view: ViewEntry | ViewDetail | undefined): { areas: number; setAside: number } | undefined {
  const read = view?.read;
  if (view === undefined || read?.status !== 'read') return undefined;
  if ('regions' in view) {
    const setAside = view.regions.filter((region) => region.standing === false).length;
    return { areas: view.regions.length - setAside, setAside };
  }
  return { areas: read.standingCount ?? read.regionsCount, setAside: 0 };
}

/** Verve's waiting surface in the shape of a list of areas, while the pano's regions are read. */
function ReadingList() {
  return (
    <Card aria-hidden="true" className="flex flex-col gap-3 px-4 py-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <div className="vv-skeleton h-6 w-[26px] flex-none rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="vv-skeleton h-4 w-2/5" />
            <div className="vv-skeleton h-3 w-4/5" />
          </div>
        </div>
      ))}
    </Card>
  );
}

/**
 * A PANO: its room, the press, its six faces, and the shown face drawn with its regions beside their list.
 *
 * Read top to bottom: the way back (the tour's name), the room and when it was captured, with `ReadControl` beside
 * them once the pano has answered; the face strip, Ahead · Right · Behind · Left · Ceiling · Floor, each counting its
 * areas; then the face: its photo with every region outlined in its look and numbered (`RegionImage`), a caption that
 * accounts for every outline ("3 areas · 2 set aside · read 3h ago") with Enlarge, and beside it `RegionList`, the same
 * numbers in words under "Marked on this view". Choosing a region on either chooses it on both. Under them,
 * `UnderstandingCard` (what the reader made of the face) and `RoomDrying` (the room's numbers).
 *
 * Wide, the face keeps its place while a long list scrolls past it (thirty regions is a tall list); narrow, the
 * blocks stack in reading order. Enlarge opens the house `Lightbox` around a second `RegionImage`: its zoom and pan
 * are `useZoomPan`'s, and the outlines and badges ride the same transform as the photo, so they stay on it at every
 * zoom. That copy takes no presses (no `onSelect`), so a drag anywhere pans; the inline face draws at fit.
 *
 * States: the pano read (header and photo first, from the tour's own listing); a pano never cut (one sentence, while
 * the dry run cuts it); a face not read yet (its photo, and where to press); a face read with nothing found; the lane's
 * fault or the pano gone (the header and the banner alone: no press beside a pano that did not answer, and a fault the
 * press would repeat is said once).
 *
 * Used by the affected-areas module's view root.
 */
export function PanoScreen({
  entry, detail, trouble, tourName, room, codebook, face, selectedRegionId, photo, enlarged, press, walk, unreadPanos,
  unreadViews, onBack, onFace, onSelectRegion, onEnlarge, onShrink, onReadPano, onReadAgain, onReadRest, onStopRest, onRetry,
}: PanoScreenProps) {
  const { t } = useTranslation();
  // The face strip's scroller: on a phone the chosen face may stand past its edge, and is brought into it.
  const stripRef = useRef<HTMLDivElement>(null);
  const views: (ViewEntry | ViewDetail)[] = detail?.views ?? entry?.views ?? [];
  // The strip appears once the pano has views; its tab is looked for when it does.
  const hasViews = views.length > 0;
  // A pano opened on its Floor, or a face pressed half out of the strip's edge, is scrolled into the strip's view. The
  // strip's own box is moved and nothing else: the page does not scroll for it (`scrollIntoView` would walk every
  // scrollable ancestor).
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector('[role="tab"][aria-selected="true"]');
    if (strip === null || strip === undefined || tab === null || tab === undefined) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left < stripBox.left) strip.scrollLeft -= stripBox.left - tabBox.left;
    else if (tabBox.right > stripBox.right) strip.scrollLeft += tabBox.right - stripBox.right;
  }, [face, hasViews]);
  const view = views.find((candidate) => candidate.face === face);
  const regions = detail?.views.find((candidate) => candidate.face === face)?.regions ?? [];
  const understanding = detail?.views.find((candidate) => candidate.face === face)?.understanding ?? null;
  const floor = detail?.floor ?? entry?.floor ?? null;
  const capturedAt = detail?.capturedAt ?? entry?.capturedAt ?? null;
  const roomTitle = roomWords(detail?.roomName ?? entry?.roomName ?? null, floor, false, t);
  const faceName = t(`affectedAreas.faces.${face}`);
  const alt = t('affectedAreas.pano.photo', { face: faceName, room: roomTitle });
  const kindLabel = (cls: string) => codebook?.classes.find((kind) => kind.key === cls)?.label ?? capitalized(spoken(cls));

  // Each region in its look: tone by judgment, never by kind (`utils/regionLook.ts`); the kind is its accessible name.
  const shapes: RegionShape[] = regions.map((region) => {
    const look = REGION_LOOK[regionState(region)];
    return {
      id: region.regionId, ordinal: region.ordinal, polygon: region.polygon, box: region.box,
      tone: look.tone, edge: look.edge, wash: look.wash, label: kindLabel(region.class),
    };
  });

  const meta = [
    floor === null ? null : t('affectedAreas.pano.floor', { floor }),
    capturedAt === null ? null : t('affectedAreas.pano.captured', { when: formatShortDate(capturedAt) }),
  ].filter((part) => part !== null).join(' · ');
  const counts = faceCounts(view);
  const caption = counts === undefined
    ? t('affectedAreas.pano.faceUnread')
    : [
        t('affectedAreas.pano.faceAreas', { count: counts.areas }),
        counts.setAside > 0 ? t('affectedAreas.pano.setAside', { count: counts.setAside }) : null,
        t('affectedAreas.pano.faceRead', { when: formatRelativeTime(view?.read?.readAt) }),
      ].filter((part) => part !== null).join(' · ');
  const ratio = view !== undefined && view.height > 0 ? view.width / view.height : 1;

  let list;
  if (view?.read?.status !== 'read') {
    list = (
      <Card className="flex flex-col gap-1 px-[18px] py-4">
        <p className="text-[15px] font-medium text-foreground">{t('affectedAreas.pano.unread', { face: faceName })}</p>
        <p className="text-[13.5px] text-muted-foreground">{t('affectedAreas.pano.unreadMessage')}</p>
      </Card>
    );
  } else if (detail === null) list = trouble === null ? <ReadingList /> : null;
  else if (regions.length === 0) list = <EmptyState title={t('affectedAreas.pano.nothing')} message={t('affectedAreas.pano.nothingMessage')} />;
  else {
    list = (
      <RegionList
        regions={regions}
        selectedId={selectedRegionId}
        kindLabel={kindLabel}
        label={t('affectedAreas.pano.listLabel', { face: faceName })}
        onSelect={onSelectRegion}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col items-start gap-1">
          <Button variant="ghost" size="sm" className="-ml-3 max-w-full max-md:h-11" aria-label={t('affectedAreas.pano.back', { tour: tourName })} onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
            <span className="truncate">{tourName}</span>
          </Button>
          {entry === null && detail === null ? (
            <div aria-hidden="true" className="flex w-full flex-col gap-2 pt-1">
              <div className="vv-skeleton h-6 w-2/5" />
              <div className="vv-skeleton h-3.5 w-1/3" />
            </div>
          ) : (
            <>
              <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{roomTitle}</h2>
              {meta !== '' && <p className="text-[12.5px] text-muted-foreground">{meta}</p>}
            </>
          )}
        </div>
        {/* The press waits for the pano's answer, as the tour screen's does; a fault the screen already says is not said again in it. */}
        {detail !== null && (
          <div className="min-w-0 max-w-[420px] flex-[0_1_auto]">
            <ReadControl
              pano={{
                press: press.trouble !== null && press.trouble === trouble ? { ...press, trouble: null } : press,
                views,
                contract: codebook?.contractVersion ?? null,
                onRead: onReadPano,
                onReadAgain,
              }}
              walk={walk}
              unreadPanos={unreadPanos}
              unreadViews={unreadViews}
              onReadRest={onReadRest}
              onStopRest={onStopRest}
            />
          </div>
        )}
      </header>

      {trouble !== null && <LaneTrouble trouble={trouble} subject="pano" onRetry={onRetry} />}

      {/* A pano that did not answer draws its banner alone, never a face beside an empty column. A pano whose cut was
          refused is told so by the press above, which a promise that its views are coming would contradict. */}
      {detail === null && trouble !== null ? null : views.length === 0 ? (
        detail !== null ? (
          press.plan?.status === 'refused' ? null : <EmptyState icon={Camera} title={t('affectedAreas.pano.uncut')} message={t('affectedAreas.pano.uncutMessage')} />
        ) : (
          <div aria-busy="true">
            <p role="status" className="sr-only">{t('affectedAreas.pano.reading')}</p>
            <div aria-hidden="true" className="vv-skeleton aspect-square w-full max-w-[560px] rounded-none" />
          </div>
        )
      ) : (
        <>
          {/* Six faces and their counts are wider than a phone: the strip keeps each tab on one line and scrolls sideways
              in its own box (the library's idiom for an underline strip wider than its row), never squeezing a count
              under its name. Wide, the strip spreads across the row as it always does. */}
          <div ref={stripRef} className="min-w-0 overflow-x-auto whitespace-nowrap">
            <Tabs
              variant="underline"
              tabs={FACES.map((id) => ({ id, label: t(`affectedAreas.faces.${id}`), count: faceCounts(views.find((candidate) => candidate.face === id))?.areas, tone: 'info' }))}
              active={face}
              onChange={(id) => {
                const next = FACES.find((candidate) => candidate === id);
                if (next) onFace(next);
              }}
              ariaLabel={t('affectedAreas.pano.facesLabel')}
            />
          </div>

          <div className={COLUMNS}>
            <figure className="m-0 flex min-w-0 flex-col gap-2 [@container(min-width:720px)]:sticky [@container(min-width:720px)]:top-4">
              <div className="ring-1 ring-border">
                <RegionImage
                  src={photo}
                  alt={alt}
                  width={view?.width ?? 1}
                  height={view?.height ?? 1}
                  regions={shapes}
                  selectedId={selectedRegionId}
                  onSelect={onSelectRegion}
                />
              </div>
              <figcaption className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-[12.5px] text-muted-foreground">{caption}</span>
                <Button variant="ghost" size="sm" className="flex-none max-md:h-11" onClick={onEnlarge}>
                  <Maximize2 aria-hidden="true" />
                  {t('affectedAreas.pano.enlarge')}
                </Button>
              </figcaption>
            </figure>
            <div className="min-w-0">{list}</div>
          </div>

          <div className={COLUMNS}>
            {understanding !== null && <UnderstandingCard understanding={understanding} read={view?.read ?? null} />}
            <div className="min-w-0 [@container(min-width:720px)]:col-start-2">
              <RoomDrying room={room} />
            </div>
          </div>
        </>
      )}

      {enlarged && view !== undefined && (
        <Lightbox label={alt} onClose={onShrink}>
          <div className="shadow-2xl" style={{ width: `min(92vw, calc(88vh * ${ratio}))` }}>
            <RegionImage src={photo} alt={alt} width={view.width} height={view.height} regions={shapes} selectedId={selectedRegionId} />
          </div>
        </Lightbox>
      )}
    </div>
  );
}
