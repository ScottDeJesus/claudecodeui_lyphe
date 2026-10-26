import type { RegionShape } from '@/shared/types';
import { cn } from '@/shared/utils';
import { PhotoFill } from '@/shared/ui/PhotoFill';
import { RegionDrawLayer } from '@/shared/ui/RegionDrawLayer';
import type { DrawnBox } from '@/shared/ui/RegionDrawLayer';

type RegionImageProps = {
  /** The photo, or `null` for the neutral tile; the regions still draw over it and still select. */
  src: string | null;
  alt: string;
  /** The photo's natural size. Only their ratio is used: it sets the box's aspect, so the box IS the image. */
  width: number;
  height: number;
  regions: RegionShape[];
  selectedId?: string | null;
  /** Called with a region's id when its outline or its badge is pressed. Omit it and the regions are drawn, not pressable. */
  onSelect?: (id: string) => void;
  /**
   * Set, the photo takes a box dragged on it (mouse, pen or one finger) and the regions stop selecting. `onDrawn` gets the
   * box on release, `[x0, y0, x1, y1]` in 0..1 of the image with x0 < x1 and y0 < y1; Escape calls `onCancel`. Null or omitted: no drawing.
   */
  drawing?: { onDrawn: (box: DrawnBox) => void; onCancel: () => void } | null;
  /**
   * The region the screen is about: it draws at full wash and every other region is dimmed (`.vv-region--dim`). Null or omitted, or
   * naming no region here: nothing is dimmed — an id that matches nothing must not grey the whole photo.
   */
  focusId?: string | null;
  /**
   * Points laid on the picture, each a round mark centred at `x`, `y` in 0..1 of the image, above every region: where a camera
   * stood (the day-one sketch's panos). With `onPress` a spot is a button named by its `label`, one tab stop each after the
   * badges; without it, or while a box is being drawn, an inert mark (a display-only copy in the Lightbox). Omitted: none.
   */
  spots?: { id: string; x: number; y: number; label: string; onPress?: () => void }[];
};

/** 0..1 → 0..100, held inside the image; a missing or non-finite coordinate reads as the edge. */
function toPercent(fraction: number | undefined): number {
  if (fraction === undefined || !Number.isFinite(fraction)) return 0;
  return Math.min(100, Math.max(0, fraction * 100));
}

/**
 * The box's `aspect-ratio`. It is the only thing that gives the root a height (every child is absolute), so a
 * size that is not a positive finite pair — an unmeasured or damaged view — would collapse the whole box,
 * neutral tile and badges with it; it reads as a square instead, which still shows the tile and the regions.
 */
function toAspectRatio(width: number, height: number): string {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? `${width} / ${height}` : '1 / 1';
}

/** The area of a region's `[x0, y0, x1, y1]` box in 0..1 of the image; a malformed box has none, and sorts last. */
function boxArea(box: number[]): number {
  const [x0, y0, x1, y1] = box;
  const area = (x1 - x0) * (y1 - y0);
  return Number.isFinite(area) ? Math.abs(area) : 0;
}

/** The `points` of a polygon, as stored; null when fewer than three usable points remain (nothing to draw). */
function toPoints(polygon: number[][]): string | null {
  const usable = polygon.filter((point) => point.length >= 2 && point.every(Number.isFinite));
  if (usable.length < 3) return null;
  return usable.map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * Used by the affected-areas module to draw a view's regions over the photo; the photo-match viewer is next.
 *
 * ONE `<svg viewBox="0 0 1 1" preserveAspectRatio="none">` covers the image's box, so a region's stored 0..1
 * polygon is drawn as it is stored and stretches with the box — there is no conversion to pixels to get wrong,
 * at any size, in the Lightbox or at any zoom. The edge keeps one weight everywhere (`vector-effect`), and the
 * paint — a translucent wash, a solid or dashed edge in the region's tone — is `.vv-region*` in `verve/media.css`.
 *
 * A numbered badge sits at each region's top-left corner, clamped inside the image; it and the outline both
 * select. Words never sit on the photo: the number is how the reader finds the region's row in the list beside it.
 * The badge is the one control for the keyboard and the screen reader (a tab stop each, named "{ordinal}. {label}");
 * the outline is the pointer's second way in, so it is hidden from the accessibility tree and takes no tab stop —
 * otherwise every region would be spoken twice, the second time by a button no key can reach.
 *
 * `focusId` is how the Mark screen shows the region under judgment: that region draws at full wash whatever wash it
 * was given, and every other one dims. `drawing` is how Missed one asks for a region the reader never drew: a
 * `RegionDrawLayer` covers the photo, and while it is there the regions are drawn and inert, so a press on one
 * starts a box instead of choosing it.
 *
 * `spots` is how the day-one sketch shows where each pano's camera stood on the plan's drawing: a round mark centred
 * on its point (`.vv-region-spot`, `verve/spots.css`), drawn after the badges and above them, a button named by its
 * label when it can be pressed. A spot carries no number and no word on the picture; its name is for the keyboard and
 * the screen reader.
 */
export function RegionImage({ src, alt, width, height, regions, selectedId = null, onSelect: onSelectRegion, drawing = null, focusId = null, spots = [] }: RegionImageProps) {
  // Region selection is off while a box is being drawn: with no handler, no outline is pressable and every badge is
  // an inert span, so the draw layer's press is the only thing a pointer on the photo can mean.
  const onSelect = drawing ? undefined : onSelectRegion;
  const focusing = focusId !== null && regions.some((region) => region.id === focusId);
  // Larger regions first, so a smaller one listed before its enclosing region is still drawn above it and its
  // outline stays reachable; the stacking is a property of the regions' sizes and never changes with the selection.
  // (`sort` is stable, so equal areas keep the caller's order.) Badges keep the caller's order: it is the tab order.
  const stackOrder = [...regions].sort((a, b) => boxArea(b.box) - boxArea(a.box));

  return (
    <div className="relative w-full" style={{ aspectRatio: toAspectRatio(width, height) }}>
      <PhotoFill src={src} alt={alt} fit="fill" />

      {/* The layer takes no pointer itself, so an empty part of the photo still passes the press to whatever is
          under it (the Lightbox's pan); a pressable outline takes its own (`.vv-region--pressable`), a display-only
          one stays inert. It is not clipped: an edge is centred on its path, so a region that reaches the photo's
          border would lose half its weight to a clip. */}
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {stackOrder.map((region) => {
          const points = toPoints(region.polygon);
          if (points === null) return null;
          const selected = region.id === selectedId;
          const focused = focusing && region.id === focusId;
          return (
            <polygon
              key={region.id}
              points={points}
              data-tone={region.tone}
              vectorEffect="non-scaling-stroke"
              // The name stays on the element (a query finds the outline by it); the badge is what is announced.
              aria-hidden="true"
              aria-label={`${region.ordinal}. ${region.label}`}
              onClick={onSelect ? () => onSelect(region.id) : undefined}
              className={cn(
                'vv-region',
                onSelect && 'vv-region--pressable',
                selected && 'vv-region--selected',
                region.edge === 'dashed' && 'vv-region--dashed',
                // The focused region is at full wash whatever it was given: the default fill is the full one.
                !focused && region.wash === 'light' && 'vv-region--wash-light',
                !focused && region.wash === 'none' && 'vv-region--wash-none',
                focusing && !focused && 'vv-region--dim',
              )}
            />
          );
        })}
      </svg>

      {regions.map((region) => {
        const selected = region.id === selectedId;
        // At the box's top-left, kept wholly inside the image: the percentage is clamped to 0..100 and `min()`
        // pulls a badge near the right or bottom edge back by its own on-screen size (a custom property
        // `.vv-region-badge` declares), so a region in a corner never has its number cut off.
        const place = {
          left: `min(${toPercent(region.box[0])}%, calc(100% - var(--vv-region-badge-extent)))`,
          top: `min(${toPercent(region.box[1])}%, calc(100% - var(--vv-region-badge-extent)))`,
        };
        return onSelect ? (
          <button
            key={region.id}
            type="button"
            data-tone={region.tone}
            style={place}
            aria-label={`${region.ordinal}. ${region.label}`}
            aria-pressed={selected}
            onClick={() => onSelect(region.id)}
            className={cn('vv-region-badge absolute', focusing && region.id !== focusId && 'vv-region--dim')}
          >
            {region.ordinal}
          </button>
        ) : (
          <span
            key={region.id}
            data-tone={region.tone}
            style={place}
            className={cn('vv-region-badge absolute', focusing && region.id !== focusId && 'vv-region--dim')}
          >
            {region.ordinal}
          </span>
        );
      })}

      {spots.map((spot) => {
        // Centred on its point by its paint's translate; the point is held inside the image as a badge's corner is.
        const place = { left: `${toPercent(spot.x)}%`, top: `${toPercent(spot.y)}%` };
        return spot.onPress && !drawing ? (
          <button key={spot.id} type="button" style={place} aria-label={spot.label} onClick={spot.onPress} className="vv-region-spot absolute" />
        ) : (
          <span key={spot.id} style={place} aria-hidden="true" className="vv-region-spot absolute" />
        );
      })}

      {drawing && <RegionDrawLayer onDrawn={drawing.onDrawn} onCancel={drawing.onCancel} />}
    </div>
  );
}
