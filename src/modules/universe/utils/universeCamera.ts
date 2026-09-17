import { NARROW_WIDTH } from '@/modules/universe/utils/universeView';
import type { CameraTarget, UniverseCamera } from '@/modules/universe/utils/universeView';

// The lane asks THIS file for the camera — for its transform, for the machinery that moves it, and
// for the hand that steers it — and the three files behind the name are cut by cohesion: the
// transform and the vocabulary in `universeView`, the events in `universePointer`, the motion here.
export { attachPointerHandlers } from '@/modules/universe/utils/universePointer';
export {
  MIN_ZOOM,
  MAX_ZOOM,
  NARROW_WIDTH,
  clampZoom,
  fitZoom,
  screenToWorld,
  worldToScreen,
} from '@/modules/universe/utils/universeView';
export type {
  CameraHitTest,
  CameraMayDrag,
  CameraTarget,
  CameraTrackInput,
  UniverseCamera,
  UniversePoint,
} from '@/modules/universe/utils/universeView';

/**
 * THE CAMERA'S MOTION — the port of the export's `select()` move, `fitZoom()`, `recenter()` and its
 * per-frame easing. One live view, one target it eases toward, and the three ways a target is chosen.
 */

/** The fraction of the remaining distance the view covers in one 60 Hz frame. The export eased at a
 *  fifth of this for its first 6.5 seconds, while its birth stagger was still arriving; the map
 *  arrives whole here, so there is no warm-up to ease past and this is the settled rate throughout. */
const EASE_RATE = 0.07;
const FRAME_MS = 16.7;
/** How long the pointer must be still before the view drifts on its own. */
const DRIFT_DELAY_MS = 7000;
const DRIFT_X = 26;
const DRIFT_Y = 20;
/** The zoom a held node is brought to: closer for a file, which has more to read. */
const FILE_ZOOM = 2.2;
const HUB_ZOOM = 1.4;

export function createCamera(zoom = 1): UniverseCamera {
  return {
    x: 0, y: 0, z: zoom, tx: 0, ty: 0, tz: zoom, baseZ: zoom,
    w: 0, h: 0, dpr: 1,
    follow: null, followOff: 0, dragging: null, hovering: null, panning: false, pointer: null,
    hitTest: null, mayDrag: null,

    easeToward(target, dtMs) {
      this.tx = target.x;
      this.ty = target.y;
      this.tz = target.z;
      // The export eased by a fixed fraction per FRAME, which ties the feel to the refresh rate.
      // The same fraction per elapsed frame time is the same motion on any display.
      const rate = 1 - Math.pow(1 - EASE_RATE, Math.max(0, dtMs) / FRAME_MS);
      this.x += (target.x - this.x) * rate;
      this.y += (target.y - this.y) * rate;
      this.z += (target.z - this.z) * rate;
    },

    track(now, dtMs, input) {
      const target: CameraTarget = { x: this.tx, y: this.ty, z: this.tz };
      if (this.follow !== null && input.followAt !== null) {
        target.x = input.followAt.x;
        target.y = input.followAt.y - this.followOff / this.tz;
      } else if (
        input.tweaks.drift &&
        !this.panning &&
        !input.selected &&
        now > DRIFT_DELAY_MS &&
        Math.abs(this.tz - this.baseZ) < 0.001
      ) {
        target.x = DRIFT_X * Math.sin(now / 11000);
        target.y = DRIFT_Y * Math.cos(now / 9000);
      }
      this.easeToward(target, dtMs);
    },

    focusOn(id, at, isFile) {
      const zoom = Math.max(this.z, isFile ? FILE_ZOOM : HUB_ZOOM);
      this.follow = id;
      // On a narrow screen the bottom sheet covers the centre, so the node is held above it.
      this.followOff = this.w < NARROW_WIDTH ? 0.16 * this.h : 0;
      this.tx = at.x;
      this.ty = at.y - this.followOff / zoom;
      this.tz = zoom;
    },

    recenter() {
      this.follow = null;
      this.followOff = 0;
      this.tx = 0;
      this.ty = 0;
      this.tz = this.baseZ;
    },

    refit(zoom) {
      if (Math.abs(this.tz - this.baseZ) < 1e-6) this.tz = zoom;
      this.baseZ = zoom;
    },
  };
}
