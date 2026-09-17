import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * THE VIEW TRANSFORM — the camera's shape, the zoom bounds, and the one mapping between world units
 * and canvas pixels, in both directions.
 *
 * ONE MAPPING, AND IT LIVES IN ONE PLACE. `worldToScreen` and `screenToWorld` are exact inverses of
 * each other — same centre, same zoom, opposite order — so the star the renderer draws in a pixel is
 * the star a click in that pixel selects, at any zoom and any pan. The renderer projects with the
 * first; the camera's motion and the pointer's hit test take their answers from the second. Nothing
 * else in the lane is allowed to do the arithmetic.
 *
 * THE PADDED BOUNDS ARE THIS FILE'S TOO, AND ONLY THIS FILE'S. `Viewport` is the camera's geometry
 * as every per-frame caller hands it in, and `viewportBounds` is the world rectangle that geometry
 * sees — the half-extents `w / 2z` and `h / 2z` about the centre, plus `SCREEN_PAD` world units on
 * every side, so a glow or a label may spill in from the edge instead of popping. Every caller —
 * the regimes that build the active list, and the frame builder every draw pass reads its
 * `visible()` from — reads it from here, so the star a pass draws and the star the active list
 * carries are measured against one rectangle and cannot drift apart.
 *
 * THE VOCABULARY IS ALSO HERE. `UniverseCamera` is the shape three files agree on, and it is the
 * only thing they need to share: the machinery that eases it (`universeCamera`) and the DOM events
 * that steer it (`universePointer`) both depend on this file, and this file depends on neither. Cut
 * this way the lane has no import cycle anywhere — which matters beyond tidiness: a cycle hands the
 * page two copies of a module on an edit, which is how a hot reload breaks an app.
 *
 * WHAT THE CAMERA REFUSES TO KNOW. Nothing here knows about nodes, the layout or React. `hitTest` is
 * the owner's answer to "which node is under this world point" and `mayDrag` to "may a drag move
 * it", and both are seams that keep the camera out of the map. They are two questions because they
 * have two different answers: the sun is hit like any other body — the card describes it — and it
 * may not be dragged, because the layout pins it and a drag would carry off the anchor the whole sky
 * hangs from.
 *
 * NO ZOOM LABEL. The export also pushed its zoom into React state for a control that was cut before
 * the export was handed over. Dead here, not ported.
 */

/** A point in world units, or on the canvas in CSS pixels — the function's name says which. */
export type UniversePoint = { x: number; y: number };

/** Where the camera is heading: the live view eases toward this, never jumping. */
export type CameraTarget = { x: number; y: number; z: number };

/** The owner's answer to which node sits under a world point at a zoom, or `null` for none. */
export type CameraHitTest = (worldX: number, worldY: number, zoom: number) => number | null;

/** The owner's answer to whether a drag may move a node: `false` for one the layout holds in place. */
export type CameraMayDrag = (id: number) => boolean;

/** What the frame hands the camera so it can pick its own target. */
export type CameraTrackInput = {
  tweaks: Pick<UniverseTweaks, 'drift'>;
  /** The followed node's live world position, or `null` when nothing is followed. */
  followAt: UniversePoint | null;
  /** A node is selected: the drift stays off while the camera holds a choice. */
  selected: boolean;
};

export type UniverseCamera = {
  /** The live view: the world point at the centre of the canvas, and the zoom. */
  x: number;
  y: number;
  z: number;
  /** The target the live view eases toward. */
  tx: number;
  ty: number;
  tz: number;
  /** The zoom that fits the galaxy between the chrome on the current viewport. */
  baseZ: number;
  /** The canvas geometry in CSS pixels, and the device pixel ratio it is rendered at. */
  w: number;
  h: number;
  dpr: number;
  /** The node being followed, or `null`. The caller supplies its position each frame. */
  follow: number | null;
  /** How far above the followed node the camera holds it, in CSS pixels. */
  followOff: number;
  /** The node the hand is dragging, or `null` — the frame reheats the layout while it is set. */
  dragging: number | null;
  /** The node under the pointer, or `null`. */
  hovering: number | null;
  /** The hand is panning the view. */
  panning: boolean;
  /** The pointer in world units while a node is dragged, or `null`. */
  pointer: UniversePoint | null;
  /** The owner's hit test. `null` until the owner sets it: with none, nothing is ever hit. */
  hitTest: CameraHitTest | null;
  /** The owner's answer on whether a drag may move a node. `null` until the owner sets it: with
   *  none, everything the hand lands on is dragged. A press that is refused pans the view instead —
   *  the export's own guard (`n.kind !== 'core'`), and what makes the centre of a fitted view, where
   *  the sun sits, grabbable. */
  mayDrag: CameraMayDrag | null;
  /** Ease the live view toward a target, at the same rate whatever the frame time. */
  easeToward(target: CameraTarget, dtMs: number): void;
  /** Pick this frame's target — the followed node, the drift, or the target held — and ease. */
  track(now: number, dtMs: number, input: CameraTrackInput): void;
  /** Hold a node, keeping it readable. `isFile` picks the closer of the two zooms. */
  focusOn(id: number, at: UniversePoint, isFile: boolean): void;
  /** Drop the follow and return to the fitted view. */
  recenter(): void;
  /** Adopt a newly fitted zoom, unless the user has zoomed away from the one it replaces. */
  refit(zoom: number): void;
};

/**
 * The camera's geometry as a frame is handed it: where the view is centred in world units, how far
 * in it is zoomed, and the canvas box in CSS pixels. A caller passes a viewport rather than the
 * camera itself because that is the whole of what a frame reads off it — and because the layout and
 * the regimes must be callable with a literal from a Node script, where there is no camera at all.
 */
export type Viewport = { x: number; y: number; z: number; w: number; h: number };

/** How far outside the viewport, in world units, a node still counts as visible — enough for the
 *  largest glow or label to spill in from the edge instead of popping. The one pad the regimes and
 *  every draw pass share. */
export const SCREEN_PAD = 160;

/**
 * The world rectangle a viewport sees, padded by `pad` world units on every side — deliberately in
 * WORLD units, not screen pixels: the pad is what a glow needs on screen, and the same world reach
 * at any zoom is not the same screen reach, which is why every caller reads this rather than
 * scaling the pad itself.
 */
export function viewportBounds(
  view: Viewport,
  pad: number = SCREEN_PAD,
): { x0: number; y0: number; x1: number; y1: number } {
  const halfW = view.w / (2 * view.z);
  const halfH = view.h / (2 * view.z);
  return {
    x0: view.x - halfW - pad,
    y0: view.y - halfH - pad,
    x1: view.x + halfW + pad,
    y1: view.y + halfH + pad,
  };
}

export const MIN_ZOOM = 0.06;
export const MAX_ZOOM = 5;
/** Below this the chrome takes a third of the height, and the fit has to allow for it. */
export const NARROW_WIDTH = 720;

export const clampZoom = (zoom: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

/** A world point in canvas CSS pixels. */
export function worldToScreen(
  camera: UniverseCamera,
  point: UniversePoint,
  w: number,
  h: number,
): UniversePoint {
  return { x: (point.x - camera.x) * camera.z + w / 2, y: (point.y - camera.y) * camera.z + h / 2 };
}

/** A canvas CSS pixel in world units — the exact inverse of `worldToScreen`. */
export function screenToWorld(
  camera: UniverseCamera,
  point: UniversePoint,
  w: number,
  h: number,
): UniversePoint {
  return { x: (point.x - w / 2) / camera.z + camera.x, y: (point.y - h / 2) / camera.z + camera.y };
}

/**
 * The zoom that fits the whole galaxy between the header and the bottom bar, whatever the screen.
 * `scale` and `radius` are the layout's own (`graph.scale`, `graph.radius`); the caller hands them
 * in per frame and adopts the answer through `refit`, so a resized window re-fits itself.
 */
export function fitZoom(w: number, h: number, scale: number, radius: number): number {
  const availableW = w - 32;
  const availableH = h - (w < NARROW_WIDTH ? 270 : 170);
  const fit = Math.min(availableW, availableH) / (2 * ((radius || 290) + 190));
  return Math.max(MIN_ZOOM, Math.min(0.85 / (scale || 1), fit));
}
