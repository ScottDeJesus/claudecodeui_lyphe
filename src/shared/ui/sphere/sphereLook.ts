import type { SphereLook } from '@/shared/types';

/** The widest and the narrowest field of view the sphere allows, in degrees: the viewer's `maxFov` and `minFov`. */
export const MAX_FOV_DEG = 110;
export const MIN_FOV_DEG = 30;

/** Two looks closer than these are one look: float noise and a parent's rounding must never turn the sphere. */
const ANGLE_TOLERANCE_DEG = 0.1;

/** Degrees to the radians the viewer and its markers take. */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Radians to degrees. */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * The viewer's zoom level (0 widest, 100 closest) for a field of view: the library places the level linearly
 * between `maxFov` and `minFov`, so a 90° field opens at level 25. Held inside 0..100.
 */
export function zoomLevelOfFov(fovDeg: number): number {
  const level = ((MAX_FOV_DEG - fovDeg) / (MAX_FOV_DEG - MIN_FOV_DEG)) * 100;
  return Math.min(100, Math.max(0, level));
}

/** The field of view a zoom level shows, in degrees: `110 − 0.8 × level`. The inverse of `zoomLevelOfFov`. */
export function fovOfZoomLevel(level: number): number {
  return MAX_FOV_DEG - (level / 100) * (MAX_FOV_DEG - MIN_FOV_DEG);
}

/** A yaw folded into (−180, 180], the range the engine's frame has: 180 stays 180, 190 becomes −170, −180 becomes 180. */
export function foldYaw(yawDeg: number): number {
  const turned = ((yawDeg % 360) + 360) % 360;
  return turned > 180 ? turned - 360 : turned;
}

/** Whether two looks are the same view, yaw compared around the circle so 179.99° and −179.99° agree. */
export function sameLook(a: SphereLook, b: SphereLook): boolean {
  const yawGap = Math.abs(foldYaw(a.yawDeg - b.yawDeg));
  return yawGap <= ANGLE_TOLERANCE_DEG
    && Math.abs(a.pitchDeg - b.pitchDeg) <= ANGLE_TOLERANCE_DEG
    && Math.abs(a.fovDeg - b.fovDeg) <= ANGLE_TOLERANCE_DEG;
}
