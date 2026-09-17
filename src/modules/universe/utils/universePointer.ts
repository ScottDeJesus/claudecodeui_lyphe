import { clampZoom, screenToWorld } from '@/modules/universe/utils/universeView';
import type { UniverseCamera } from '@/modules/universe/utils/universeView';

/**
 * EVERY WAY A HAND MOVES THE CAMERA — the export's `bind()`, bound to one canvas: pan, a node drag,
 * wheel zoom, pinch, double-click to recenter, and hover. Returns the detach, which removes every
 * listener the way the export's `unbind()` did.
 *
 * THE RETURNED FUNCTION IS THE WHOLE TEARDOWN, and it is not optional: a canvas unmounted without it
 * keeps swallowing wheel events on a node that no longer exists.
 *
 * WHAT IT WRITES, AND WHAT IT ONLY REPORTS. The camera's own fields — its position, its zoom, the
 * held target, which node the hand has, whether it is panning — are written here. WHERE a dragged
 * node then goes is not: the handlers leave the node's id in `camera.dragging` and the world point in
 * `camera.pointer`, and whoever owns the graph moves it while it draws, through `dragTo` in
 * `universeLayout` — the inverse of the parallax the frame puts on a node at depth. So this file
 * never touches a node, and the drag survives any frame rate.
 *
 * A TOUCH PANS. On a phone the finger is the only pointer there is, and a drag would move a star the
 * user cannot see under their own hand — so a touch drags the sky and a mouse drags the star.
 *
 * WHAT A DRAG MAY TAKE IS THE OWNER'S ANSWER. This file knows no kinds, so the press asks the
 * camera's `mayDrag` and a node the owner refuses is not dragged: the press pans the sky, which is
 * the export's own guard (`n.kind !== 'core'`) and what keeps the sun — the anchor the layout holds
 * at the centre of the fitted view, i.e. the spot a hand naturally grabs to pan — where it is.
 */

/** A pointer sample: the CSS pixel it is at, and the world point under it. */
type PointerSample = { mx: number; my: number; x: number; y: number };

/** The world's units per CSS pixel at most: the canvas is never rendered above this ratio. */
const MAX_DPR = 1.5;
/** How far a pointer must travel before a press stops counting as a click. */
const CLICK_SLOP = 6;
/** Wheel and pinch sensitivity — the export's own constants. */
const WHEEL_RATE = 0.0016;

export function attachPointerHandlers(
  canvas: HTMLCanvasElement,
  camera: UniverseCamera,
  onHover: (node: number | null) => void,
  onSelect: (node: number | null) => void,
): () => void {
  const pointers = new Map<number, PointerSample>();
  let down: { mx: number; my: number; moved: boolean; node: number | null } | null = null;
  let drag: number | null = null;
  let pan: { x: number; y: number } | null = null;
  let pinch: { d: number; cx: number; cy: number; z: number; camx: number; camy: number } | null = null;

  const toWorld = (event: PointerEvent | WheelEvent): PointerSample => {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const world = screenToWorld(camera, { x: mx, y: my }, camera.w, camera.h);
    return { mx, my, x: world.x, y: world.y };
  };

  const hit = (sample: PointerSample): number | null =>
    camera.hitTest === null ? null : camera.hitTest(sample.x, sample.y, camera.z);

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    camera.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    camera.w = rect.width;
    camera.h = rect.height;
    canvas.width = Math.max(1, rect.width * camera.dpr);
    canvas.height = Math.max(1, rect.height * camera.dpr);
  };

  /** A second finger takes the gesture away from whatever the first one was doing. */
  const startPinch = (): void => {
    const [a, b] = [...pointers.values()];
    drag = null;
    pan = null;
    camera.dragging = null;
    camera.panning = false;
    camera.follow = null;
    pinch = {
      d: Math.hypot(a.mx - b.mx, a.my - b.my),
      cx: (a.mx + b.mx) / 2,
      cy: (a.my + b.my) / 2,
      z: camera.z,
      camx: camera.x,
      camy: camera.y,
    };
    if (down) down.moved = true;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const sample = toWorld(event);
    pointers.set(event.pointerId, sample);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    const node = hit(sample);
    down = { mx: sample.mx, my: sample.my, moved: false, node };
    // A press on a node the owner refuses to have moved — the sun — is a pan, and everything else
    // about the press is unchanged: a release that never travelled still selects it, so the node the
    // layout pins stays as choosable and as describable as any other.
    const mayDrag = node !== null && (camera.mayDrag === null || camera.mayDrag(node));
    if (mayDrag && event.pointerType !== 'touch') drag = node;
    else pan = { x: camera.x, y: camera.y };
    camera.dragging = drag;
    camera.panning = pan !== null;
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (event: PointerEvent): void => {
    const sample = toWorld(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, sample);

    if (pinch !== null && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const { d, cx, cy, z, camx, camy } = pinch;
      const zoom = clampZoom((z * Math.hypot(a.mx - b.mx, a.my - b.my)) / Math.max(1, d));
      // The world point under the pinch centre is the one thing that must not move.
      const worldX = (cx - camera.w / 2) / z + camx;
      const worldY = (cy - camera.h / 2) / z + camy;
      camera.z = zoom;
      camera.x = worldX - (cx - camera.w / 2) / zoom;
      camera.y = worldY - (cy - camera.h / 2) / zoom;
      camera.tx = camera.x;
      camera.ty = camera.y;
      camera.tz = zoom;
      return;
    }

    if (down !== null && Math.hypot(sample.mx - down.mx, sample.my - down.my) > CLICK_SLOP) {
      down.moved = true;
    }

    if (drag !== null) {
      camera.pointer = { x: sample.x, y: sample.y };
      return;
    }

    if (pan !== null && down !== null) {
      camera.follow = null;
      camera.x = pan.x - (sample.mx - down.mx) / camera.z;
      camera.y = pan.y - (sample.my - down.my) / camera.z;
      camera.tx = camera.x;
      camera.ty = camera.y;
      return;
    }

    if (event.pointerType === 'touch') return;
    const node = hit(sample);
    if (node !== camera.hovering) {
      camera.hovering = node;
      onHover(node);
      canvas.style.cursor = node === null ? 'grab' : 'pointer';
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (pinch !== null) {
      if (pointers.size < 2) {
        pinch = null;
        down = null;
        pan = null;
        camera.panning = false;
      }
      return;
    }
    // A press that never travelled is a choice, not a drag.
    if (down !== null && !down.moved) onSelect(down.node);
    down = null;
    drag = null;
    pan = null;
    camera.dragging = null;
    camera.panning = false;
    canvas.style.cursor = camera.hovering === null ? 'grab' : 'pointer';
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const sample = toWorld(event);
    const zoom = clampZoom(camera.z * Math.exp(-event.deltaY * WHEEL_RATE));
    // Zoom about the pointer: the world point under it stays put, so the wheel steers the sky.
    camera.x = sample.x - (sample.mx - camera.w / 2) / zoom;
    camera.y = sample.y - (sample.my - camera.h / 2) / zoom;
    camera.z = zoom;
    camera.tx = camera.x;
    camera.ty = camera.y;
    camera.tz = zoom;
    camera.follow = null;
  };

  const onDoubleClick = (): void => camera.recenter();

  const onPointerLeave = (): void => {
    if (camera.hovering === null) return;
    camera.hovering = null;
    onHover(null);
  };

  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('pointerleave', onPointerLeave);

  return () => {
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('dblclick', onDoubleClick);
    canvas.removeEventListener('pointerleave', onPointerLeave);
  };
}
