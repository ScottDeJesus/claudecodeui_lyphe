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
  /** Try again, on a drawing whose bytes did not arrive: its drawing read again. */
  onRetryDrawing: () => void;
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
  let joined = t('affectedAreas.dayOne.pins.some', { pinned, count: total });
  if (pinned === total) joined = total === 2 ? t('affectedAreas.dayOne.pins.both') : t('affectedAreas.dayOne.pins.all', { count: total });
  const words = [
    joined,
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

/**
 * The tallest the drawing stands: a deep plan at its full width would push its own caption (the scale, the pins, Enlarge)
 * below the fold of a laptop while it stands beside the room list, so it narrows to keep this height.
 */
const DRAWING_MAX_HEIGHT = 'min(70vh, 720px)';

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
 *    on it meets its row in `DayOneRooms`. The numbers stand clear of each other and of the spots (`badgePlacement="clear"`),
 *    and the spots lie under them. Pressing an area or an object opens its photo's pano at its face, with its region
 *    chosen; pressing a spot opens its pano. A deep plan narrows to `DRAWING_MAX_HEIGHT`, so its caption stays in view.
 * 2. The caption: the scale line and the pin line (each a dot in its tone and its words), and what the spots are, with
 *    Enlarge, which opens the drawing in the house `Lightbox` to zoom and pan, display only.
 *
 * States: the drawing loading (Verve's waiting surface in the drawing's own box, the caption and the rooms already there);
 * drawn; a drawing that moved (a rebuild changed it while the walk ran) keeps the last one on screen until the new one arrives;
 * its bytes did not arrive (the box says so in words, with Try again, and the rooms beside it still list everything
 * on the plan).
 * At 960 px of panel and up the figure stands beside the room list and stays in view while the list scrolls past it.
 *
 * Handles: `data-day-one-line="scale" | "pins" | "spots"` on the caption's lines.
 *
 * Used by the affected-areas module's `DayOneSketch`.
 */
export function DayOnePlan({ floor, drawing, codebook, onOpenPanoAt, onOpenPano, onRetryDrawing }: DayOnePlanProps) {
  const { t } = useTranslation();
  // Whether the drawing is open in the Lightbox. Only this figure asks, and a floor switched or a tour left forgets it.
  const [enlarged, setEnlarged] = useState(false);
  // The last drawing that arrived for this floor. A rebuild can change the drawing (its address is its content's hash) while a
  // walk runs, and the next one takes a moment to arrive: this one stays on screen until then, so an enlarged drawing stays open
  // and a number held with the keyboard stays held, rather than the plan going through its waiting surface.
  const [lastDrawing, setLastDrawing] = useState<string | undefined>(undefined);
  if (typeof drawing === 'string' && drawing !== lastDrawing) setLastDrawing(drawing);
  const picture = drawing === undefined ? lastDrawing : drawing;
  const items = numberedItems(floor, codebook, t);
  const shapes = items.map((item) => item.shape);
  const spots = spotsOf(floor, t);
  const rooms = t('affectedAreas.tour.rooms', { count: floor.rooms.length });
  const alt = floor.floor === null ? t('affectedAreas.dayOne.plan.alt', { rooms }) : t('affectedAreas.dayOne.plan.altFloor', { floor: floor.floor, rooms });
  const scale = scaleLine(floor.scale, t);
  const pins = pinLine(floor, t);
  // The box's aspect is the frame's: the drawing, every outline and every spot are in its 0..1, so they meet exactly.
  const frame = { width: floor.widthFt, height: floor.lengthFt };
  // Full width, unless that would stand the drawing taller than `DRAWING_MAX_HEIGHT`; its aspect is kept either way.
  const box = { width: `min(100%, calc(${DRAWING_MAX_HEIGHT} * ${frame.width / frame.height}))`, aspectRatio: `${frame.width} / ${frame.height}` };

  const openItem = (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (item !== undefined) onOpenPanoAt(item.photo.panoId, item.photo.face, item.photo.regionId);
  };

  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2 [@container(min-width:960px)]:sticky [@container(min-width:960px)]:top-4" data-day-one-plan="">
      {picture === undefined && (
        <div aria-busy="true" className="ring-1 ring-border" style={box}>
          <p role="status" className="sr-only">{t('affectedAreas.dayOne.plan.loading')}</p>
          <div aria-hidden="true" className="vv-skeleton size-full rounded-none" />
        </div>
      )}
      {/* No bytes, no picture: the box says so rather than wearing the photo tile's "Photo" over a floor plan, on the surface
          ground (the muted words read 5.06:1 there; on the muted ground they fell under AA), with Try again, as a photo that
          did not arrive offers on the pano screen. */}
      {picture === null && (
        <div role="status" data-day-one-failed="" className="flex flex-col items-center justify-center gap-3 bg-card p-6 text-center ring-1 ring-border" style={box}>
          <p className="max-w-[36ch] text-[12.5px] text-muted-foreground">{t('affectedAreas.dayOne.plan.drawingFailed')}</p>
          <Button variant="outline" size="sm" className="max-md:h-11" onClick={onRetryDrawing}>
            {t('affectedAreas.trouble.retry')}
          </Button>
        </div>
      )}
      {typeof picture === 'string' && (
        <div className="ring-1 ring-border" style={{ width: box.width }}>
          <RegionImage
            src={picture}
            alt={alt}
            width={frame.width}
            height={frame.height}
            regions={shapes}
            badgePlacement="clear"
            onSelect={openItem}
            spots={spots.map((spot) => ({ ...spot, onPress: () => onOpenPano(spot.id) }))}
          />
        </div>
      )}

      <figcaption className="flex items-start justify-between gap-3">
        <ul className="m-0 flex min-w-0 list-none flex-col gap-1 p-0">
          <CaptionLine words={scale.words} tone={scale.tone} handle="scale" />
          <CaptionLine words={pins.words} tone={pins.tone} handle="pins" />
          {typeof picture === 'string' && spots.length > 0 && (
            <li data-day-one-line="spots" className="flex min-w-0 items-start gap-2 text-[12.5px]">
              {/* The spot's own mark on a swatch of the drawing's own ground, so the legend looks like what it explains in
                  both themes. */}
              <span aria-hidden="true" className="vv-region-spot-swatch flex-none">
                <span className="vv-region-spot vv-region-spot--legend" />
              </span>
              <span className="text-muted-foreground">{t('affectedAreas.dayOne.plan.spotsLegend')}</span>
            </li>
          )}
        </ul>
        {typeof picture === 'string' && (
          <Button variant="ghost" size="sm" className="flex-none max-md:h-11" onClick={() => setEnlarged(true)}>
            <Maximize2 aria-hidden="true" />
            {t('affectedAreas.pano.enlarge')}
          </Button>
        )}
      </figcaption>

      {enlarged && typeof picture === 'string' && (
        <Lightbox label={alt} onClose={() => setEnlarged(false)}>
          {/* Display only, as every Lightbox copy is: no press on an outline or a spot, so a drag pans the drawing. */}
          <div className="shadow-2xl" style={{ width: `min(92vw, calc(88vh * ${frame.width / frame.height}))` }}>
            <RegionImage src={picture} alt={alt} width={frame.width} height={frame.height} regions={shapes} spots={spots} badgePlacement="clear" />
          </div>
        </Lightbox>
      )}
    </figure>
  );
}
