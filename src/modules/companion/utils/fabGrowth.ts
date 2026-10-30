import { FAB_SIZE_PX } from '@/shared/constants';
import type { DockableFabPosition } from '@/shared/ui';

/**
 * Where a rest stands for a disc of `size`, given the rest as it is stored: a docked rest stays docked (the kit centres the disc
 * on its cell at any size), and a point, stored as the top-left of the 28 px disc, is shifted back by half the growth on each
 * axis, so the larger disc grows about the centre the 28 px one has. Used by CompanionFab's view, for the position it hands the
 * kit and for her phone corner.
 */
export function restFor(position: DockableFabPosition, size: number): DockableFabPosition {
  if (position.docked) return position;
  const shift = (size - FAB_SIZE_PX) / 2;
  return { docked: false, x: position.x - shift, y: position.y - shift };
}

/**
 * The inverse, for a release: a drop is reported as the top-left of the disc as large as it was drawn, and what is stored is the
 * top-left of the 28 px disc about the same centre, so a stored rest never depends on how big she was when it was left.
 */
export function storedFrom(position: DockableFabPosition, size: number): DockableFabPosition {
  if (position.docked) return position;
  const shift = (size - FAB_SIZE_PX) / 2;
  return { docked: false, x: position.x + shift, y: position.y + shift };
}
