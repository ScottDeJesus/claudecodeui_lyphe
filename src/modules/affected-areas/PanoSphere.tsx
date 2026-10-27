import { ArrowRight, Maximize2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LayerSwitch } from '@/modules/affected-areas/LayerSwitch';
import { useViewShown } from '@/modules/affected-areas/hooks/useViewShown';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { cubeFaces, sphereShapes } from '@/modules/affected-areas/utils/sphereFaces';
import { FACES, areaWords, kindName, panoCounts } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, Face, Region, ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import type { RegionLayer, SphereLook, SphereTrouble } from '@/shared/types';
import { Badge, Banner, Button, SphereView } from '@/shared/ui';

type PanoSphereProps = {
  /** The open pano's id: the sphere is keyed by it, so no outline of the last pano outlives it. */
  panoId: string;
  /** The pano's six views in the strip's order, from its detail once it answered, else from the tour's listing: the sphere's
   *  faces, every outline on it (a listed view carries none yet), the chosen area's view and the caption's counts. */
  views: (ViewEntry | ViewDetail)[];
  /** The six photos as object URLs by view sha, as `useImageUrls` hands them out: a sha absent while its photo loads, null
   *  where its bytes did not arrive. */
  photos: Record<string, string | null>;
  /** The room in words ("Kitchen"), never its key: the sphere's accessible name. */
  room: string;
  /** What the sphere outlines: every area, or only the ones the engine says stand. The list beside it keeps every area. */
  layer: RegionLayer;
  /** The chosen area, on any of the six views; null when none is. */
  selectedRegionId: string | null;
  /** Whether the sphere fills the screen: Enlarge, on 360°. */
  enlarged: boolean;
  /** The kinds' labels; null until the codebook answers, and the chosen line speaks a kind's key until then. */
  codebook: Codebook | null;
  /** The pano's detail is still on its way: the caption says the areas are being read, instead of counting the listing's views,
   *  which carry no regions and would read as "0 areas". */
  reading: boolean;
  onLayer: (layer: RegionLayer) => void;
  /** An outline or its badge pressed on the sphere chooses that area, outline and row at once, and pressing the chosen one
   *  lets go of it, as on a view (the root's `onSelectRegion`). */
  onSelectRegion: (regionId: string) => void;
  /** Where the sphere looks when it is drawn: Ahead's for a pano just opened, the view's a person returns to 360° from, then
   *  wherever it came to rest. A new value turns it there. */
  look: SphereLook;
  /** Where the sphere came to rest after a drag, a zoom or a turn: the root keeps it, so a return to 360° finds it there. */
  onLook: (look: SphereLook) => void;
  /** Enlarge pressed, and the sphere's own entering and leaving of fullscreen: the root's `enlarged`. */
  onFullscreen: (on: boolean) => void;
  /** Mark it on {view}: that view shown with the area still chosen, its presses under its photo. */
  onMarkOn: (face: Face, regionId: string) => void;
  /** Try again, on a photo that did not arrive: the root reads the six photos again. */
  onRetryPhotos: () => void;
};

type ChosenAreaProps = {
  region: Region;
  /** The view the area was marked on: its line names it, and Mark it on opens it. */
  face: Face;
  codebook: Codebook | null;
  onMarkOn: (face: Face, regionId: string) => void;
};

/**
 * The chosen area's line under the sphere: its number on a badge in its look's tone (as its row draws it), its kind, the view
 * it is on, and Mark it on {view}, the one way from the sphere to a press. The view's name is what tells it from an area of
 * the same number on another view. The group is named "3. Marked with blue tape · Floor"; the badge carries the number.
 */
function ChosenArea({ region, face, codebook, onMarkOn }: ChosenAreaProps) {
  const { t } = useTranslation();
  const look = REGION_LOOK[regionState(region)];
  // The kind the area counts as, a rename applied, as its row and its presses name it.
  const kind = kindName(region.effectiveClass ?? region.class, codebook);
  const view = t(`affectedAreas.faces.${face}`);

  return (
    <section
      role="group"
      aria-label={t('affectedAreas.sphere.chosen', { n: region.ordinal, kind, view })}
      data-sphere-chosen=""
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Badge as="span" tone={look.tone} className="min-w-[26px] flex-none justify-center border-tone-dot px-1.5 font-bold tabular-nums">
          {region.ordinal}
        </Badge>
        {/* One phrase, "Marked with blue tape · Floor": a long kind gives way, never the view that tells two 3s apart. */}
        <span className="flex min-w-0 items-baseline gap-1 text-sm">
          <span className="min-w-0 truncate font-semibold text-foreground">{kind}</span>
          <span className="flex-none text-muted-foreground">· {view}</span>
          {/* FILL: placement — "· Counted in {room}" when the area's placement credits a room other than the pano's, "· Seen in {n}
              photos" when `placement.views` > 1: muted after the view, giving way before the view does. */}
        </span>
      </div>
      <Button
        variant="tonal"
        size="sm"
        className="flex-none max-md:h-11"
        data-sphere-press="mark-on"
        // That view shown with the area still chosen: its presses stand under its photo, and nothing is sent from here.
        onClick={() => onMarkOn(face, region.regionId)}
      >
        {t('affectedAreas.sphere.markOn', { view })}
        <ArrowRight aria-hidden="true" />
      </Button>
    </section>
  );
}

/**
 * 360°, THE PHOTO COLUMN: the pano's six views stitched back into one sphere he drags round, every area of every read view
 * outlined on it in the look it wears on its view and numbered as its row. Read top to bottom:
 * 1. The layer switch (Standing · All), where it stands over a view's photo, so it never moves between 360° and a view.
 * 2. The sphere (`SphereView`), square to the column and framed as a view's photo is. It is mounted only while this block is
 *    seen (`useViewShown`): hidden under Fleet, Mark or Tables it lets go of its textures and its frame loop, and comes back
 *    where `look` says. A photo that did not arrive, or a device that cannot draw it, is one sentence in its place.
 * 3. While an area is chosen, its line (`ChosenArea`): its number in its look, its kind and its view, and Mark it on {view},
 *    which opens that view with the area chosen, where its presses are. Nothing on the sphere writes a row.
 * 4. The caption, accounting for every outline across the six views as a view's caption does for one ("0 areas · 5 proposed ·
 *    6 of 6 views read"), with Enlarge (on 360°, the sphere's own fullscreen); while the detail is on its way it says it is
 *    reading instead; under it, how to turn and zoom the sphere.
 * 5. Choosing an area brings the switch, the sphere and its line into view together (`blockRef`, below), as `FacePhoto` does on
 *    a view: on a phone the list stands below the sphere, and a row pressed there must not turn a sphere out of sight.
 *
 * Words never sit on the photo: the number on the sphere meets its row in the list beside it (`PanoAreas`), and the view's name
 * over that list tells apart two areas numbered 1.
 *
 * States: the photos loading (the box's skeleton, Enlarge waiting for the sphere); drawn, with an area chosen or none; on
 * Standing, only what stands outlined while the caption still counts every area; a photo that did not arrive (one sentence,
 * with Try again); a device that cannot draw the sphere (one sentence, sending him to the views). In a trouble the switch,
 * Enlarge and the hint go, none of them having a sphere to act on, while the chosen line stays: Mark it on still reaches the
 * presses, and the strip above still offers the six views.
 *
 * Handles: `data-sphere-trouble` (the trouble) on the column's block, `data-sphere-chosen` on the chosen line and
 * `data-sphere-press="mark-on"` on its press.
 *
 * Used by the affected-areas module's `PanoScreen`, in its figure while 360° is shown.
 */
export function PanoSphere({
  panoId, views, photos, room, layer, selectedRegionId, enlarged, codebook, reading, onLayer, onSelectRegion, look, onLook,
  onFullscreen, onMarkOn, onRetryPhotos,
}: PanoSphereProps) {
  const { t } = useTranslation();
  // The column's block: the switch, the sphere and the chosen line, watched for whether the screen is seen and brought into view
  // when an area is chosen. A ref: nothing draws from it.
  const blockRef = useRef<HTMLDivElement>(null);
  // Whether the block is in layout: the sphere is mounted only then, so under Fleet, Mark or Tables it lets go of its
  // textures and its frame loop, and comes back where `look` says.
  const blockShown = useViewShown(blockRef);
  // Choosing an area brings this block into view a frame later, no further than needed, as `FacePhoto` does on a view: on a
  // phone a row pressed in the list below would otherwise turn a sphere nobody sees.
  useEffect(() => {
    if (selectedRegionId === null) return undefined;
    const frame = requestAnimationFrame(() => blockRef.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedRegionId]);
  // The six photos as the cube the viewer stitches: null until all six have arrived, while the box draws its skeleton.
  const faces = useMemo(() => cubeFaces(views, photos), [views, photos]);
  // Every area of every read view in its look, the layer's rule applied (the chosen one always drawn). Memoized because the
  // screen re-renders on every look the sphere reports.
  const regions = useMemo(
    () => sphereShapes(views.filter((view): view is ViewDetail => 'regions' in view), layer, selectedRegionId),
    [views, layer, selectedRegionId],
  );
  // Why the sphere is not drawn: what `SphereView` reported (`photo_failed`, or `no_webgl`), else a photo of the six that came
  // back null. Let go by Try again, which re-reads the photos through the root's attempt.
  const [reported, setReported] = useState<SphereTrouble | null>(null);
  const trouble = reported ?? (views.some((view) => photos[view.sha256] === null) ? 'photo_failed' : null);
  const counts = panoCounts(views);

  // The chosen area and the view it was marked on, found among the six: its line names both.
  const chosen = views
    .flatMap((view) => ('regions' in view ? view.regions.map((region) => ({ face: view.face, region })) : []))
    .find(({ region }) => region.regionId === selectedRegionId) ?? null;
  const label = t('affectedAreas.sphere.label', { room });
  // How far the pano is read always stands in the caption. With none of the six read it stands alone ("0 of 6 views read"):
  // an area count there would read as nothing found. While the detail is on its way the listing's views carry no regions, so a
  // count would say "0 areas" over a pano that has them: the caption says it is reading instead.
  const viewsRead = t('affectedAreas.sphere.viewsRead', { read: counts.read, total: FACES.length });
  const caption = reading
    ? t('affectedAreas.pano.reading')
    : counts.read === 0
      ? viewsRead
      : [...areaWords(counts, t), viewsRead].filter((part) => part !== null).join(' · ');

  return (
    <>
      <div ref={blockRef} className="flex min-w-0 flex-col gap-2" data-sphere-trouble={trouble ?? undefined}>
        {trouble === null && (
          // The face photo's tool row, the switch at its start: the same place and height on 360° as on a view.
          <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 max-md:min-h-11">
            <div className="min-w-0">
              <LayerSwitch layer={layer} onLayer={onLayer} />
            </div>
          </div>
        )}
        {trouble === 'photo_failed' && (
          <div role="alert">
            <Banner
              tone="warn"
              action={(
                <Button
                  variant="tonal"
                  size="sm"
                  className="h-8 flex-none px-2.5 text-xs max-md:h-11"
                  // The root reads the six photos again under a new attempt, and the report is let go with it.
                  onClick={() => {
                    setReported(null);
                    onRetryPhotos();
                  }}
                >
                  {t('affectedAreas.trouble.retry')}
                </Button>
              )}
            >
              <p className="text-sm font-medium">{t('affectedAreas.sphere.photoFailed')}</p>
            </Banner>
          </div>
        )}
        {trouble === 'no_webgl' && (
          <div role="status">
            <Banner tone="neutral">
              <p className="text-sm font-medium">{t('affectedAreas.sphere.noWebgl')}</p>
            </Banner>
          </div>
        )}
        {trouble === null && (
          <div className="ring-1 ring-border">
            {/* Keyed by the pano: another pano is another viewer, and no outline of the last one outlives it. Mounted only
                while this block is seen, so hidden it holds no textures and runs no frame loop. */}
            {blockShown && (
              <SphereView
                key={panoId}
                faces={faces}
                regions={regions}
                selectedId={selectedRegionId}
                onSelect={onSelectRegion}
                look={look}
                onLook={onLook}
                fullscreen={enlarged}
                onFullscreen={onFullscreen}
                label={label}
                zoomHint={t('affectedAreas.sphere.ctrlZoom')}
                onTrouble={setReported}
              />
            )}
          </div>
        )}
        {chosen !== null && <ChosenArea region={chosen.region} face={chosen.face} codebook={codebook} onMarkOn={onMarkOn} />}
      </div>
      <figcaption className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 text-[12.5px] text-muted-foreground">{caption}</span>
          {trouble === null && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-none max-md:h-11"
              disabled={faces === null}
              // On 360° Enlarge is the sphere's own fullscreen; its exit, Escape or its own button, says false through it.
              onClick={() => onFullscreen(true)}
            >
              <Maximize2 aria-hidden="true" />
              {t('affectedAreas.pano.enlarge')}
            </Button>
          )}
        </div>
        {trouble === null && <p className="text-xs text-muted-foreground">{t('affectedAreas.sphere.hint')}</p>}
      </figcaption>
    </>
  );
}
