import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { HEAD_NAME, HEAD_PRESS, HEAD_ROW, HOLDS_TRAIL } from '@/shared/constants';
import { useHeadBack } from '@/shared/context/HeadBackContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { Button } from '@/shared/ui';
import { WAY_BACK } from '@/shared/ui/overlayEscape';

type ScreenHeadProps = {
  /** The screen's name, as the wheel and the palette give it. */
  name: string;
};

/**
 * THE HEAD OF A SCREEN THAT HAS NONE OF ITS OWN, drawn as the chat's and the Bugs screen's are (`HEAD_ROW`): the way back at the
 * start, the screen's name, and the menu to every other place at the end. Nothing else: what a screen shows and does is its own.
 *
 * ONE WAY BACK PER SCREEN. The arrow goes to Kaylee Station when the screen was reached from there, else the sessions home; but while
 * a page inside the screen stands (a carrier's pages, a bulletin's page, a tour, a panorama) that page claims it (`useHeadBack`): the
 * arrow steps up one level to where the page says, and the head names the page under the screen and the levels it is inside
 * ("CERBERUS · BULLETINS" over "Allstate"). The page then draws no back of its own. Escape presses the arrow (`WAY_BACK`); held, it
 * opens the trail of places (`HOLDS_TRAIL`).
 *
 * It stands in place of the old sidebar, its rail and the phone's strip, which no screen draws now while no application is up.
 * Under a finger it is one line, the arrow drawn 28 px and still caught at 44, as the chat's head is.
 *
 * Drawn by `WorkspaceMain` over every view but the chat and the Bugs view, which carry heads of their own (`ChatHead`, the kanban
 * module's `BugHead`).
 */
export function ScreenHead({ name }: ScreenHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const claim = useHeadBack();
  const home = doors.cameFrom() === 'station' ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });
  const back = claim?.label ?? home;
  const eyebrow = claim === null ? null : [name, ...(claim.within ?? [])].join(' · ');
  const title = claim?.title ?? name;

  return (
    <header data-screen-head="" className={HEAD_ROW}>
      <Button
        data-screen-head-back=""
        {...WAY_BACK}
        {...HOLDS_TRAIL}
        variant="outline"
        size="icon"
        className={HEAD_PRESS}
        aria-label={back}
        title={back}
        onClick={() => {
          if (claim !== null) claim.onBack();
          else if (doors.cameFrom() === 'station') openStation(doors.navigate);
          else openHome(doors.navigate);
        }}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <div className={HEAD_NAME}>
        {/* `min-w-0` lets a long name end in an ellipsis rather than push the menu off a phone. The eyebrow and the name fill the
            press's height together at a desk (12 and 24 px) and stand on one line under a finger. */}
        <div className="min-w-0 finger:flex finger:items-baseline finger:gap-2">
          {eyebrow !== null && (
            <p className="truncate font-mono text-[10px] font-medium uppercase leading-3 tracking-[0.18em] text-muted-foreground finger:max-w-[45%] finger:shrink-0">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-xl font-normal leading-6 text-foreground finger:min-w-0 finger:text-sm" title={title}>{title}</h1>
        </div>
      </div>
      <PlacesMenu />
    </header>
  );
}
