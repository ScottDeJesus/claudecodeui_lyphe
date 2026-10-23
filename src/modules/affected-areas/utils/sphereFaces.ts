import type { Face, Region, ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import type { CubeFaces, RegionLayer, SphereLook, SphereShape } from '@/shared/types';

/*
 * THE 360° VIEW'S PURE MODEL: how a pano's six flat views become the cube the kit's `SphereView` stitches, and how its
 * areas become outlines on that sphere. Nothing here fetches, holds state or draws, and nothing computes a yaw or a
 * pitch: the engine sends every area's `sphere` (`geometry.py` is its one home), and the browser draws it as sent.
 */

/**
 * Which cube face each of the pano's views is. The frame, from the cubemap adapter's `textureCoordsToSphericalCoords`
 * (`@photo-sphere-viewer/cubemap-adapter`), in which a direction is (x ahead, y right, z DOWN), yaw = atan2(y, x) and
 * pitch = −asin(z):
 *  - `front` is centred at yaw 0 and pitch 0, and yaw grows turning right and pitch up, exactly as the engine's views have
 *    them (`yawDeg` 0, 90, 180, −90 for Ahead, Right, Behind, Left; `pitchDeg` +90 for Ceiling, −90 for Floor);
 *  - the sides are centred at +90 (`right`), 180 (`back`) and −90 (`left`), so they meet at ±45° and ±135°, with a texture's
 *    x growing toward larger yaw;
 *  - the adapter's DEFAULT `top` and `bottom` are the ceiling and floor views turned 180° (its `top` has its upper edge toward
 *    the front, where the engine's Ceiling view, looked up at from Ahead, has it toward the back), which is what the
 *    viewer's `flipTopBottom` turns back, and `SphereView` always sets it.
 * It is names only: the six photos need no resampling and the browser does no maths on them.
 */
export const CUBE_OF: Record<Face, keyof CubeFaces> = {
  ahead: 'front',
  right: 'right',
  behind: 'back',
  left: 'left',
  ceiling: 'top',
  floor: 'bottom',
};

/**
 * The cube a pano's views make, from the object URLs of their photos (by sha, as `useImageUrls` hands them out); null
 * until all six faces have one. A cube is whole or not drawn: the adapter reads the face size off its first face (`left`), and
 * a missing face would be a hole in the sphere. A pano with fewer than six views, or a photo that did not arrive, is null.
 */
export function cubeFaces(views: ViewEntry[], photos: Record<string, string | null>): CubeFaces | null {
  const cube: Partial<CubeFaces> = {};
  for (const view of views) {
    const url = photos[view.sha256];
    if (typeof url === 'string' && url !== '') cube[CUBE_OF[view.face]] = url;
  }
  const { left, front, right, back, top, bottom } = cube;
  if (left === undefined || front === undefined || right === undefined || back === undefined || top === undefined || bottom === undefined) return null;
  return { left, front, right, back, top, bottom };
}

/** The area of a region's `[x0, y0, x1, y1]` box in 0..1 of its view; a malformed box has none, and sorts last. */
function boxArea(box: number[]): number {
  const area = (box[2] - box[0]) * (box[3] - box[1]);
  return Number.isFinite(area) ? Math.abs(area) : 0;
}

/**
 * The index of the polygon vertex nearest to the box's top-left corner, `[box[0], box[1]]`: the corner the flat view puts the
 * badge on, found among the vertices because the sphere is only known AT the vertices. Ties go to the earlier vertex.
 */
function badgeVertex(region: Region): number {
  const [cornerX, cornerY] = region.box;
  let nearest = 0;
  let nearestGap = Infinity;
  region.polygon.forEach(([x, y], index) => {
    const gap = Math.hypot(x - cornerX, y - cornerY);
    if (gap < nearestGap) {
      nearest = index;
      nearestGap = gap;
    }
  });
  return nearest;
}

/** Whether the sphere can draw a region: three vertices or more on the sphere, one for each vertex the flat view has. */
function isDrawable(region: Region): boolean {
  return region.sphere.length >= 3 && region.sphere.length === region.polygon.length;
}

/**
 * Every area of the pano's views as an outline on the sphere, in its look. The polygon is the region's `sphere` as the
 * engine sent it; the badge sits at the `sphere` vertex whose index is that of the flat view's badge corner. The look is
 * `REGION_LOOK[regionState(region)]`, the one table the flat view reads too (tone by judgment, never by kind).
 *
 * The layer rule is the face's: on Standing a region draws if the engine does not say it fails to stand
 * (`standing !== false`) or if it is the chosen one, so an area chosen in the list is never judged unseen. A region the sphere
 * cannot draw (fewer than three vertices) is left off.
 *
 * Larger boxes come first, as RegionImage stacks them: later outlines draw over earlier ones, so a small area inside a large
 * one stays pressable. (`sort` is stable, so equal areas keep the order of the views and of the regions in each.)
 */
export function sphereShapes(views: ViewDetail[], layer: RegionLayer, selectedId: string | null): SphereShape[] {
  const drawn = views
    .flatMap((view) => view.regions)
    .filter((region) => isDrawable(region) && (layer !== 'standing' || region.standing !== false || region.regionId === selectedId));
  return drawn
    .sort((a, b) => boxArea(b.box) - boxArea(a.box))
    .map((region) => {
      const look = REGION_LOOK[regionState(region)];
      const [badgeYaw, badgePitch] = region.sphere[badgeVertex(region)];
      return {
        id: region.regionId,
        ordinal: region.ordinal,
        polygon: region.sphere.map(([yawDeg, pitchDeg]): [number, number] => [yawDeg, pitchDeg]),
        badgeAt: [badgeYaw, badgePitch],
        tone: look.tone,
        edge: look.edge,
        wash: look.wash,
      };
    });
}

/** Where a view looks on the sphere: its own yaw, pitch and field of view, as the engine cut it. */
export function lookOf(view: ViewEntry): SphereLook {
  return { yawDeg: view.yawDeg, pitchDeg: view.pitchDeg, fovDeg: view.fovDeg };
}
