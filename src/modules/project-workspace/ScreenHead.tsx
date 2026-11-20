import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { HOLDS_TRAIL } from '@/shared/constants';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { Button } from '@/shared/ui';
import { WAY_BACK } from '@/shared/ui/overlayEscape';

/** A drawn control that still catches a finger at 44 px: a transparent area grown past its box (the touch law's own way). */
const FINGER_PRESS = "relative size-9 flex-none finger:size-7 finger:before:absolute finger:before:-inset-2 finger:before:content-['']";

type ScreenHeadProps = {
  /** The screen's name, as the wheel and the palette give it. */
  name: string;
};

/**
 * THE HEAD OF A SCREEN THAT HAS NONE OF ITS OWN, drawn as the chat's and the Bugs screen's are: the way back at the start (Kaylee
 * Station when the screen was reached from there, else the sessions home; Escape presses it, `WAY_BACK`; held, it opens the trail
 * of places, `HOLDS_TRAIL`), the screen's name, and the menu to every other place at the end. Nothing else: what a screen shows
 * and does is its own.
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
  const back = doors.cameFrom() === 'station' ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });

  return (
    <header data-screen-head="" className="pwa-header-safe flex flex-none items-center gap-3 px-4 py-3 finger:gap-2 finger:px-3 finger:!pb-1 finger:!pt-1">
      <Button
        data-screen-head-back=""
        {...WAY_BACK}
        {...HOLDS_TRAIL}
        variant="outline"
        size="icon"
        className={FINGER_PRESS}
        aria-label={back}
        title={back}
        onClick={() => (doors.cameFrom() === 'station' ? openStation(doors.navigate) : openHome(doors.navigate))}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {/* `min-w-0` lets a long name end in an ellipsis rather than push the menu off a phone. */}
      <h1 className="min-w-0 flex-1 truncate text-xl font-normal leading-tight text-foreground finger:text-sm">{name}</h1>
      <PlacesMenu triggerClassName={FINGER_PRESS} />
    </header>
  );
}
