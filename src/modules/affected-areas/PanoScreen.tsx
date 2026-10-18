import { Camera, ChevronLeft, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FaceStrip } from '@/modules/affected-areas/FaceStrip';
import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { LayerSwitch } from '@/modules/affected-areas/LayerSwitch';
import { MarkBar } from '@/modules/affected-areas/MarkBar';
import { MissedDraw } from '@/modules/affected-areas/MissedDraw';
import { ReadControl } from '@/modules/affected-areas/ReadControl';
import { ReadingList } from '@/modules/affected-areas/ReadingList';
import { RegionList } from '@/modules/affected-areas/RegionList';
import { RoomDrying } from '@/modules/affected-areas/RoomDrying';
import { UnderstandingCard } from '@/modules/affected-areas/UnderstandingCard';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { countedKind, faceCounts, kindName, roomWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, Face, PanoDetail, PanoEntry, Region, RoomEntry, ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import type { AffectedAreasTrouble, PanoPress, RegionLayer, RegionShape, TourReaderProgress } from '@/shared/types';
import { Button, Card, EmptyState, Lightbox, RegionImage } from '@/shared/ui';
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
  /** What the photo draws: every area (the default), or only the ones the engine says stand. Held by the view root, set by the layer switch. */
  layer: RegionLayer;
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
  onLayer: (layer: RegionLayer) => void;
  /** A mark's answer, the judged region: the view root puts it in place of the one it holds (`useMarkedRegions`). */
  onMarked: (region: Region) => void;
  /** Missed one's answer, the new human region and the sha of the view it was drawn on: the view root appends it. */
  onMissed: (viewSha: string, region: Region) => void;
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
 * A PANO: its room, the press, its six faces, and the shown face drawn with its regions beside their list.
 *
 * Read top to bottom: the way back (the tour's name), the room and when it was captured, with `ReadControl` beside
 * them once the pano has answered; the face strip, Ahead · Right · Behind · Left · Ceiling · Floor, each counting its
 * areas; then the face: its photo with every region outlined in its look and numbered (`RegionImage`), a caption that
 * accounts for every outline ("3 areas · 2 set aside · read 3h ago") with Enlarge, and beside it `RegionList`, the same
 * numbers in words under "Marked on this view". Choosing a region on either chooses it on both, and its presses
 * (`MarkBar`) stand under the photo; Missed one and the layer switch (All · Standing) stand over it (`MissedDraw`).
 * Under them, `UnderstandingCard` (what the reader made of the face) and `RoomDrying` (the room's numbers).
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
  entry, detail, trouble, tourName, room, codebook, face, selectedRegionId, layer, photo, enlarged, press, walk, unreadPanos,
  unreadViews, onBack, onFace, onSelectRegion, onLayer, onMarked, onMissed, onEnlarge, onShrink, onReadPano, onReadAgain,
  onReadRest, onStopRest, onRetry,
}: PanoScreenProps) {
  const { t } = useTranslation();
  const views: (ViewEntry | ViewDetail)[] = detail?.views ?? entry?.views ?? [];
  const view = views.find((candidate) => candidate.face === face);
  const regions = detail?.views.find((candidate) => candidate.face === face)?.regions ?? [];
  const understanding = detail?.views.find((candidate) => candidate.face === face)?.understanding ?? null;
  const floor = detail?.floor ?? entry?.floor ?? null;
  const capturedAt = detail?.capturedAt ?? entry?.capturedAt ?? null;
  const roomTitle = roomWords(detail?.roomName ?? entry?.roomName ?? null, floor, false, t);
  const faceName = t(`affectedAreas.faces.${face}`);
  const alt = t('affectedAreas.pano.photo', { face: faceName, room: roomTitle });
  const selected = regions.find((region) => region.regionId === selectedRegionId) ?? null;
  // The photo draws every area, or on Standing only the ones the engine says stand (its wire `standing` flag, never worked
  // out here). The chosen area stays drawn whatever its flag, so an area chosen in the list is never judged unseen. The
  // list keeps every area either way.
  const drawn = layer === 'standing' ? regions.filter((region) => region.standing !== false || region.regionId === selectedRegionId) : regions;
  // The badge a drawn area will take: one after the highest of ALL the face's areas, the layer's hidden ones too, as the engine numbers it.
  const nextOrdinal = regions.reduce((highest, region) => Math.max(highest, region.ordinal), 0) + 1;

  // Each region in its look: tone by judgment, never by kind (`utils/regionLook.ts`); the kind it counts as, a rename
  // included, is its accessible name.
  const shapes: RegionShape[] = drawn.map((region) => {
    const look = REGION_LOOK[regionState(region)];
    return {
      id: region.regionId, ordinal: region.ordinal, polygon: region.polygon, box: region.box,
      tone: look.tone, edge: look.edge, wash: look.wash, label: kindName(countedKind(region), codebook),
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
        kindLabel={(cls) => kindName(cls, codebook)}
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
          <FaceStrip views={views} face={face} onFace={onFace} />

          <div className={COLUMNS}>
            <figure className="m-0 flex min-w-0 flex-col gap-2 [@container(min-width:720px)]:sticky [@container(min-width:720px)]:top-4">
              {view !== undefined && detail !== null ? (
                // Missed one stands where the photo stood and draws it, with the layer switch at the start of its tool row and the
                // chosen area's presses under it. Keyed by the face's view, so a box drawn or held on one face, its note and its
                // refusal never ride to another face.
                <MissedDraw
                  key={view.sha256}
                  view={view}
                  photo={photo}
                  alt={alt}
                  shapes={shapes}
                  nextOrdinal={nextOrdinal}
                  selectedId={selectedRegionId}
                  onSelect={onSelectRegion}
                  codebook={codebook}
                  onMissed={(region) => onMissed(view.sha256, region)}
                  tools={<LayerSwitch layer={layer} onLayer={onLayer} />}
                  bar={selected === null ? undefined : <MarkBar key={selected.regionId} region={selected} codebook={codebook} queue="browse" onMarked={onMarked} />}
                />
              ) : (
                // Nothing to mark yet: the pano is still read, or the face has no view. The photo alone, as it was.
                <div className="ring-1 ring-border">
                  <RegionImage src={photo} alt={alt} width={view?.width ?? 1} height={view?.height ?? 1} regions={shapes} selectedId={selectedRegionId} onSelect={onSelectRegion} />
                </div>
              )}
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
