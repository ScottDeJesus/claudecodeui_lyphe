import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { HEAD_BAND, HEAD_FRAMED_ROW, HEAD_NAME, HEAD_PRESS, HEAD_ROW, HOLDS_TRAIL, SCREEN_FRAME } from '@/shared/constants';
import { useHeadBack } from '@/shared/context/HeadBackContext';
import { HeadToolsPlace } from '@/shared/context/HeadToolsContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { Button } from '@/shared/ui';
import { WAY_BACK } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

type ScreenHeadProps = {
  /** The screen's name, as the wheel and the palette give it. */
  name: string;
  /** A page that is read: the head stands over the page's frame (`SCREEN_FRAME`) instead of across the window. */
  framed?: boolean;
};

/**
 * THE HEAD OF A SCREEN THAT HAS NONE OF ITS OWN, drawn as the chat's and the Bugs screen's are (`HEAD_ROW`): the way back at the
 * start, the screen's name, and the menu to every other place at the end. Nothing else of its own: what a screen shows and does is
 * the screen's, and a screen with a press for the head draws it into the head's place for one, just before the menu (`HeadTools`:
 * Cerberus's switch between its fleet's hoop and its list, R&D's Scout now and its settings, the Schedules' Refresh).
 *
 * IT STANDS OVER WHAT IT HEADS. Over a page that is read (`framed`: R&D, Analytics, the Inbox and the rest `WorkspaceMain` names) it
 * keeps to the page's frame (`HEAD_BAND`, `HEAD_FRAMED_ROW`, `SCREEN_FRAME`, as the Bugs screen's head does), so at a wide desk the
 * arrow stands over the page's first word and the Menu over its last press, never at the window's corners with the page between them.
 * Over an instrument that fills the window (the sky, a terminal, the files) it runs the window's width, as the instrument does. Under
 * 80rem the two are the same row.
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
export function ScreenHead({ name, framed = false }: ScreenHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const claim = useHeadBack();
  const home = doors.cameFrom() === 'station' ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });
  const back = claim?.label ?? home;
  const eyebrow = claim === null ? null : [name, ...(claim.within ?? [])].join(' · ');
  const title = claim?.title ?? name;

  const row = (
    <>
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
      <HeadToolsPlace />
      <PlacesMenu />
    </>
  );

  return framed ? (
    <header data-screen-head="" data-screen-head-framed="" className={HEAD_BAND}>
      <div className={cn(SCREEN_FRAME, HEAD_FRAMED_ROW)}>{row}</div>
    </header>
  ) : (
    <header data-screen-head="" className={HEAD_ROW}>
      {row}
    </header>
  );
}
