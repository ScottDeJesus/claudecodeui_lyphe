import type { MarkerConfig } from '@photo-sphere-viewer/markers-plugin';

import type { SphereShape } from '@/shared/types';
import { toRadians } from '@/shared/ui/sphere/sphereLook';
import { cn } from '@/shared/utils';

/** What a badge's marker id adds to its area's id, so one press on either hands the same id to the caller. */
const BADGE_SUFFIX = '~badge';

/** The area an outline or badge marker belongs to: its marker id with the badge's suffix dropped. */
export function regionIdOfMarker(markerId: string): string {
  return markerId.endsWith(BADGE_SUFFIX) ? markerId.slice(0, -BADGE_SUFFIX.length) : markerId;
}

/** Whether a vertex is a pair of finite numbers; a malformed one would put NaN into the viewer's maths. */
function isVertex(vertex: readonly number[]): boolean {
  return vertex.length >= 2 && Number.isFinite(vertex[0]) && Number.isFinite(vertex[1]);
}

/** An area the sphere can draw: three vertices or more, and a corner for its number. */
function isDrawable(shape: SphereShape): boolean {
  return shape.polygon.length >= 3 && shape.polygon.every(isVertex) && isVertex(shape.badgeAt);
}

/**
 * The badge's markup, from the tone word and the integer alone, so that no text of a model's or an operator's can ever
 * become markup: the tone keeps its letters, the number is truncated to an integer. The library sets a marker's `html`
 * as innerHTML, which is why this is the one place a string is built by hand.
 */
function badgeHtml(shape: SphereShape): string {
  const tone = shape.tone.replace(/[^a-z]/g, '');
  const number = Number.isFinite(shape.ordinal) ? Math.trunc(shape.ordinal) : 0;
  return `<span class="vv-region-badge" data-tone="${tone}">${number}</span>`;
}

/** The outline: a polygon marker on the sphere, wearing the same `.vv-region*` rules RegionImage's outline does. */
function outlineOf(shape: SphereShape, selected: boolean): MarkerConfig {
  return {
    id: shape.id,
    polygon: shape.polygon.map(([yawDeg, pitchDeg]): [number, number] => [toRadians(yawDeg), toRadians(pitchDeg)]),
    className: cn(
      'vv-region vv-region--pressable',
      shape.edge === 'dashed' && 'vv-region--dashed',
      shape.wash === 'light' && 'vv-region--wash-light',
      shape.wash === 'none' && 'vv-region--wash-none',
      selected && 'vv-region--selected',
    ),
    // The library writes each svgStyle entry as an attribute, dasherised: `data-tone`, which hands the outline its tone.
    svgStyle: { dataTone: shape.tone },
  };
}

/** The numbered badge: an html marker centred on the corner the caller chose. The chosen one is lifted over its neighbours. */
function badgeOf(shape: SphereShape, selected: boolean): MarkerConfig {
  return {
    id: shape.id + BADGE_SUFFIX,
    position: { yaw: toRadians(shape.badgeAt[0]), pitch: toRadians(shape.badgeAt[1]) },
    html: badgeHtml(shape),
    anchor: 'center center',
    zIndex: selected ? 3 : 2,
  };
}

/**
 * The markers for a set of areas, in the order they must be added.
 *
 * The plugin appends every polygon to one `<svg>` in the order added, and a polygon's `zIndex` lands as the CSS
 * `z-index` of an SVG path, which lifts nothing. So the stacking is the ORDER: the outlines go in the order given and
 * the chosen one last, which draws it over the rest. A badge is html and its `zIndex` does lift, so that is what the
 * chosen badge uses. An area that cannot be drawn (fewer than three vertices, a non-finite angle) is left out.
 */
export function markerConfigsOf(shapes: SphereShape[], selectedId: string | null): MarkerConfig[] {
  const drawable = shapes.filter(isDrawable);
  const outlines = [
    ...drawable.filter((shape) => shape.id !== selectedId),
    ...drawable.filter((shape) => shape.id === selectedId),
  ].map((shape) => outlineOf(shape, shape.id === selectedId));
  const badges = drawable.map((shape) => badgeOf(shape, shape.id === selectedId));
  return [...outlines, ...badges];
}
