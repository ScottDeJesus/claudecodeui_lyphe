import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { HEAD_ROW } from '@/shared/constants';
import { cn } from '@/shared/utils';

type PlacesCornerProps = {
  /**
   * The page's block at its widest, in px: where the window is wider, the row keeps to the block, in the middle of the window, so the
   * menu stands over the block's end. Left off, the window's width.
   */
  frame?: number;
};

/**
 * THE MENU'S CORNER on a page with no head of its own: every head's row (`HEAD_ROW`) laid over the page's top, empty but for the menu
 * (`PlacesMenu`) at its end. Over a page that stands in a block of its own in the middle of a wide window (the station's companion and
 * panel), it keeps to that block (`frame`), so the menu stands over the block's end and not at the window's corner. The row itself
 * takes no press; only the menu does.
 *
 * Exported for the station module's `StationShell`, which lays it over the station's scene.
 */
export function PlacesCorner({ frame }: PlacesCornerProps) {
  return (
    <div
      data-places-corner=""
      className={cn(HEAD_ROW, 'pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto justify-end')}
      style={frame === undefined ? undefined : { maxWidth: frame }}
    >
      <div className="pointer-events-auto flex">
        <PlacesMenu />
      </div>
    </div>
  );
}
