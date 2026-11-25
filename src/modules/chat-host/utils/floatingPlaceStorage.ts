import type { PanelArm } from '@/modules/chat-host/utils/panelGeometry';

/**
 * Where the reader left the floating chat: the button's point and the panel's hold on it, kept in localStorage so the pair comes
 * back there on the next load. Whether the chat floats is never stored (every load opens with the chat home); only where it
 * stands when it does.
 *
 * A record is trusted field by field: a point or a hold that is missing, not a number or not a corner reads as none, and the
 * panel then rests in the kit's corner by its own rule. A browser that refuses storage (private mode, a hardened profile) is a
 * place that was not kept, never a drag that failed.
 */
const STORAGE_KEY = 'chat-host-place';

const GRIPS: readonly string[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export type FloatingPlace = {
  /** The button's top-left, or null while the reader has never moved the pair. */
  point: { x: number; y: number } | null;
  /** The panel's hold on the button, or null while no drag has formed the pair. */
  arm: PanelArm | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Used by `useFloatingPanel` as the pair's first place. */
export function readFloatingPlace(): FloatingPlace {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!isRecord(stored)) return { point: null, arm: null };
    const { point, arm } = stored;
    return {
      point: isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y) ? { x: point.x, y: point.y } : null,
      arm: isRecord(arm) && isFiniteNumber(arm.dx) && isFiniteNumber(arm.dy) && typeof arm.grip === 'string' && GRIPS.includes(arm.grip)
        ? { dx: arm.dx, dy: arm.dy, grip: arm.grip as PanelArm['grip'] }
        : null,
    };
  } catch {
    return { point: null, arm: null };
  }
}

/** Used by `useFloatingPanel` once per drag, at its release. */
export function writeFloatingPlace(place: FloatingPlace): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
  } catch {
    // The place was not kept; the pair still stands where it was dropped for the life of this page.
  }
}
