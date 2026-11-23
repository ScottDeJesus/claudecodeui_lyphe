import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { HEAD_ROW } from '@/shared/constants';

/**
 * THE MENU'S CORNER on a page with no head of its own: every head's row (`HEAD_ROW`) laid over the page's top, empty but for the menu
 * (`PlacesMenu`) at its end, so the way to every other place stands on the same spot as on every screen that fills the window. The row
 * itself takes no press; only the menu does.
 *
 * Exported for the station module's `StationShell`, which lays it over the station's scene.
 */
export function PlacesCorner() {
  return (
    <div data-places-corner="" className={`${HEAD_ROW} pointer-events-none absolute inset-x-0 top-0 z-20 justify-end`}>
      <div className="pointer-events-auto flex">
        <PlacesMenu />
      </div>
    </div>
  );
}
