import { Ellipsis } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionStatus } from '@/modules/companion';
import { STATION_SIDEWAYS_CATCH } from '@/shared/constants';
import type { CompanionPresence, StationHeadRow } from '@/shared/types';
import { AppLogo, Button, buttonVariants, Menu } from '@/shared/ui';
import { cn } from '@/shared/utils';

type HeadRowProps = {
  /** What the phone's arrangement asks of her head: its sideways step, its `trail` and the way back. */
  row: StationHeadRow;
  /** Her face's box, drawn by `StationHeadView` at the row's size (44 px, 32 on its side). */
  face: ReactNode;
  /** Her name as he set it; `nameId` is its heading's id, which names the whole head. */
  name: string;
  nameId: string;
  /** What she is doing on this page, for her state's words. */
  presence: CompanionPresence;
  /** Her controls' line (`CompanionControls`, `line`, aligned to its start), drawn in her menu's panel while it is open. */
  controls: ReactNode;
  /** The most her menu's panel takes, in px: her head's own at compact. */
  panelWidth: number;
  /** A failed process's banner, under the row at its whole width; false while she runs. */
  banner: ReactNode;
};

/**
 * HER HEAD AS THE PHONE'S TOP ROW, the bar and her head in one under the status bar: drawn by `StationHeadView` (this module)
 * whenever the phone's arrangement hands her head its `row`. Left to right:
 *
 * - her face, 44 px (32 px on its side, where the row is 40 px);
 * - her name and her state on one line: her name keeps its width up to 40% of the line, her state takes the rest and gives way by
 *   its own rule (a chat's name cut, "· item 4 of 15" kept; words with no subject wrap rather than lose their end);
 * - the arrangement's `trail`: the count of what needs him and, on its side, the strip's line;
 * - her ONE menu at the row's end, the glyph alone (a row this narrow has no room for its words; they are its name, "Her controls
 *   and CloudCLI"): its panel is her controls' line over "CloudCLI", the shell's way back, the bar's own press. The panel hangs
 *   under the row, so it never covers her face, and the kit's edge shift keeps it inside the window.
 *
 * Every press is a 44 px catch: upright by its size, on its side by a catch grown past the 40 px row (`STATION_SIDEWAYS_CATCH`).
 * A failed process's banner stands under the row at its whole width. `data-station-head="row"` reads the form.
 */
export function HeadRow({ row, face, name, nameId, presence, controls, panelWidth, banner }: HeadRowProps) {
  const { t } = useTranslation();
  const menuLabel = t('station.head.menu', { defaultValue: 'Her controls and CloudCLI' });

  return (
    <section data-station-head="row" data-station-head-sideways={row.sideways ? '' : undefined} aria-labelledby={nameId} className="flex min-w-0 flex-col px-3">
      <div className={cn('flex min-w-0 items-center gap-2.5', row.sideways ? 'h-10' : 'min-h-14 py-1.5')}>
        {face}
        <div className="flex min-w-0 flex-1 items-baseline gap-x-2">
          <h2 id={nameId} data-station-head-name="" className="max-w-[40%] shrink-0 truncate text-base font-semibold leading-6 text-foreground">
            {name}
          </h2>
          <CompanionStatus presence={presence} emphasis="station" />
        </div>
        {row.trail}
        <div className="shrink-0">
          <Menu
            width={panelWidth}
            label={menuLabel}
            panel={(
              <div className="flex min-w-0 flex-col gap-3">
                {controls}
                <div className="border-t border-border pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    data-station-back-to-cloudcli=""
                    aria-label={t('station.bar.backLabel', { defaultValue: 'Back to CloudCLI' })}
                    className="h-11 w-full justify-start"
                    onClick={row.onBackToCloudcli}
                  >
                    <AppLogo size={64} className="size-4 rounded-[25%]" />
                    {t('station.bar.back', { defaultValue: 'CloudCLI' })}
                  </Button>
                </div>
              </div>
            )}
            trigger={(
              <span
                data-station-head-controls=""
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative', row.sideways ? cn(STATION_SIDEWAYS_CATCH, 'w-11') : 'size-11')}
              >
                <Ellipsis aria-hidden="true" />
                <span className="sr-only">{menuLabel}</span>
              </span>
            )}
          />
        </div>
      </div>
      {banner !== false && <div className="pb-2">{banner}</div>}
    </section>
  );
}
