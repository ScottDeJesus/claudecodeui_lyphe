import type { TFunction } from 'i18next';
import { Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { feet, inches, numberedItems } from '@/modules/affected-areas/utils/dayOneModel';
import { listWords, roomWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, DayOneFloor, Face, ScaleLine } from '@/shared/affected-areas-types';
import type { Tone } from '@/shared/types';
import { Button, Lightbox, RegionImage } from '@/shared/ui';

type DayOnePlanProps = {
  /** The floor shown: its rooms, spots, areas, fixtures, contents, scale and pins, every position in 0..1 of its drawing. */
  floor: DayOneFloor;
  /** The floor's drawing as a URL an `<img>` loads; undefined while its bytes load, null where they did not arrive. */
  drawing: string | null | undefined;
  /** The kinds' labels; null until the codebook answers, and an area's kind is spoken from its key until then. */
  codebook: Codebook | null;
  /** An area or an object pressed: its photo's pano opened at its face, with its region chosen when it has one. */
  onOpenPanoAt: (panoId: string, face: Face, regionId: string | null) => void;
  /** A spot pressed: its pano opened. */
  onOpenPano: (panoId: string) => void;
};

/**
 * The scale line: the camera's height and what checked it ("Camera at 62.4 in, from 2 door slabs and the floor tile; the
 * stand says 63"), or, unverified, the stand's word alone, said as such. Positive when verified, neutral on one source,
 * warn when nothing in the photos checked it: then every size on the plan rests on the stand's height.
 */
function scaleLine(scale: ScaleLine, t: TFunction): { words: string; tone: Tone } {
  const stand = inches(scale.presetIn);
  if (scale.verdict === 'unverified' || scale.sources.length === 0) return { words: t('affectedAreas.dayOne.scale.unverified', { stand }), tone: 'warn' };
  const count = (kind: string) => scale.sources.filter((source) => source.kind === kind).length;
  const from = listWords([
    count('door_slab') > 0 ? t('affectedAreas.dayOne.scale.doorSlabs', { count: count('door_slab') }) : null,
    count('tile') > 0 ? t('affectedAreas.dayOne.scale.floorTile') : null,
    count('appliance') > 0 ? t('affectedAreas.dayOne.scale.appliances', { count: count('appliance') }) : null,
  ].filter((part) => part !== null), t);
  const verified = scale.verdict === 'verified';
  return { words: t(verified ? 'affectedAreas.dayOne.scale.verified' : 'affectedAreas.dayOne.scale.oneSource', { camera: inches(scale.cameraIn), from, stand }), tone: verified ? 'positive' : 'neutral' };
}

/**
 * The pin line: how many rooms are pinned to another through a doorway both cameras see, the groups set side by side when
 * the pinned rooms do not all join, and how well the loops close ("6 of 7 rooms pinned through doorways · 1 loop closes
 * within 0.4 ft", the worst loop's closure). Positive when every room joins one plan, warn when any room or group stands
 * apart: where it sits on the drawing is then not measured against the rest.
 */
function pinLine(floor: DayOneFloor, t: TFunction): { words: string; tone: Tone } {
  const total = floor.rooms.length;
  if (total < 2) return { words: t('affectedAreas.dayOne.pins.single'), tone: 'neutral' };
  const pinned = total - floor.pins.unpinnedRooms.length;
  const groups = floor.pins.components - floor.pins.unpinnedRooms.length;
  const worst = floor.pins.loops.reduce((most, loop) => Math.max(most, loop.closureFt), 0);
  const words = [
    pinned === total ? t('affectedAreas.dayOne.pins.all', { count: total }) : t('affectedAreas.dayOne.pins.some', { pinned, count: total }),
    groups > 1 ? t('affectedAreas.dayOne.pins.groups', { count: groups }) : null,
    floor.pins.loops.length > 0 ? t('affectedAreas.dayOne.pins.loops', { count: floor.pins.loops.length, ft: feet(worst) }) : null,
  ].filter((part) => part !== null).join(' · ');
  return { words, tone: pinned === total && groups <= 1 ? 'positive' : 'warn' };
}

/**
 * Each spot named for its room ("Kitchen 360° photo"); a room with several shots numbers them, its root first ("Dinning
 * Room 360° photo, 2 of 2"), so no two presses share a name.
 */
function spotsOf(floor: DayOneFloor, t: TFunction): { id: string; x: number; y: number; label: string }[] {
  const ordered = [...floor.spots].sort((a, b) => Number(b.root) - Number(a.root));
  return floor.spots.map((spot) => {
    const room = roomWords(spot.roomName, null, false, t);
    const shots = ordered.filter((other) => other.roomName === spot.roomName);
    const label = shots.length > 1
      // `total`, not `count`: a `count` would send i18next looking for plural keys this sentence does not need.
      ? t('affectedAreas.dayOne.spotNth', { room, n: shots.indexOf(spot) + 1, total: shots.length })
      : t('affectedAreas.dayOne.spot', { room });
    return { id: spot.panoId, x: spot.x, y: spot.y, label };
  });
}

/** One line of the caption: a dot in its tone and its words, the words in the tone's ink when they warn. */
function CaptionLine({ words, tone, handle }: { words: string; tone: Tone; handle: string }) {
  return (
    <li data-tone={tone} data-day-one-line={handle} className="flex min-w-0 items-start gap-2 text-[12.5px]">
      <span aria-hidden="true" className="mt-1.5 size-2 flex-none rounded-full bg-tone-dot" />
      <span className={tone === 'warn' ? 'text-tone-ink' : 'text-muted-foreground'}>{words}</span>
    </li>
  );
}

/**
 * THE DRAWING of one floor of the day-one plan, with what lies on it, and its caption. Read top to bottom:
 * 1. The engine's own drawing of the plan (rooms, walls, door gaps, names, a scale bar), framed as a view's photo is, with
 *    `RegionImage` over it: each area in its look, each fixture and piece of contents in the neutral tone with the light wash,
 *    each numbered as its row beside it (`numberedItems`), and each pano's spot. Words never sit on the drawing: a number
 *    on it meets its row in `DayOneRooms`. Pressing an area or an object opens its photo's pano at its face, with its region
 *    chosen; pressing a spot opens its pano.
 * 2. The caption: the scale line and the pin line (each a dot in its tone and its words), with Enlarge, which opens the
 *    drawing in the house `Lightbox` to zoom and pan, display only.
 *
 * States: the drawing loading (Verve's waiting surface in the drawing's own box, the caption and the rooms already there);
 * drawn; its bytes did not arrive (the neutral tile, the areas and spots still laid on its frame, and one line saying so).
 * At 720 px of panel and up the figure stands beside the room list and stays in view while the list scrolls past it.
 *
 * Handles: `data-day-one-line="scale" | "pins"` on the caption's lines.
 *
 * Used by the affected-areas module's `DayOneSketch`.
 */
export function DayOnePlan({ floor, drawing, codebook, onOpenPanoAt, onOpenPano }: DayOnePlanProps) {
  const { t } = useTranslation();
  // Whether the drawing is open in the Lightbox. Only this figure asks, and a floor switched or a tour left forgets it.
  const [enlarged, setEnlarged] = useState(false);
  const items = numberedItems(floor, codebook, t);
  const shapes = items.map((item) => item.shape);
  const spots = spotsOf(floor, t);
  const rooms = t('affectedAreas.tour.rooms', { count: floor.rooms.length });
  const alt = floor.floor === null ? t('affectedAreas.dayOne.plan.alt', { rooms }) : t('affectedAreas.dayOne.plan.altFloor', { floor: floor.floor, rooms });
  const scale = scaleLine(floor.scale, t);
  const pins = pinLine(floor, t);
  // The box's aspect is the frame's: the drawing, every outline and every spot are in its 0..1, so they meet exactly.
  const frame = { width: floor.widthFt, height: floor.lengthFt };

  const openItem = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined) onOpenPanoAt(item.photo.panoId, item.photo.face, item.photo.regionId);
  };

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2 [@container(min-width:720px)]:sticky [@container(min-width:720px)]:top-4" data-day-one-plan="">
      {drawing === undefined ? (
        <div aria-busy="true" className="ring-1 ring-border">
          <p role="status" className="sr-only">{t('affectedAreas.dayOne.plan.loading')}</p>
          <div aria-hidden="true" className="vv-skeleton w-full rounded-none" style={{ aspectRatio: `${frame.width} / ${frame.height}` }} />
        </div>
      ) : (
        <div className="ring-1 ring-border">
          <RegionImage
            // FILL: drawing — the floor's SVG through `api.affectedAreas.planDrawing(drawingSha)` with the token, made an
            // object URL as `hooks/useImageUrl.ts` makes a view's and revoked when it changes.
            src={drawing}
            alt={alt}
            width={frame.width}
            height={frame.height}
            regions={shapes}
            // FILL: onOpenPanoAt — the root's verb: `onOpenPano(panoId)`, then `place.onMarkOn(face, regionId)` when a region is named.
            onSelect={openItem}
            // FILL: onOpenPano — the root's `onOpenPano` (`AffectedAreasView`), as a gallery tile opens its pano.
            spots={spots.map((spot) => ({ ...spot, onPress: () => onOpenPano(spot.id) }))}
          />
        </div>
      )}

      <figcaption className="flex items-start justify-between gap-3">
        <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
          <CaptionLine words={scale.words} tone={scale.tone} handle="scale" />
          <CaptionLine words={pins.words} tone={pins.tone} handle="pins" />
          {drawing === null && <li className="text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.plan.drawingFailed')}</li>}
        </ul>
        {drawing !== undefined && (
          <Button variant="ghost" size="sm" className="flex-none max-md:h-11" onClick={() => setEnlarged(true)}>
            <Maximize2 aria-hidden="true" />
            {t('affectedAreas.pano.enlarge')}
          </Button>
        )}
      </figcaption>

      {enlarged && drawing !== undefined && (
        <Lightbox label={alt} onClose={() => setEnlarged(false)}>
          {/* Display only, as every Lightbox copy is: no press on an outline or a spot, so a drag pans the drawing. */}
          <div className="shadow-2xl" style={{ width: `min(92vw, calc(88vh * ${frame.width / frame.height}))` }}>
            <RegionImage src={drawing} alt={alt} width={frame.width} height={frame.height} regions={shapes} spots={spots} />
          </div>
        </Lightbox>
      )}
    </figure>
  );
}
